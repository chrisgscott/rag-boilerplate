# Phase 2.5: Docling Ingestion Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the TypeScript ingestion pipeline with a Python/FastAPI service using Docling for document parsing, backed by Supabase Queues (pgmq) for reliable job processing with automatic retries.

**Architecture:** Next.js uploads files to Supabase Storage and enqueues ingestion jobs via pgmq. A Python/FastAPI service on Render polls the queue, processes documents through Docling (parse) → recursive chunker → OpenAI embeddings → Supabase Postgres upsert. No direct communication between Next.js and Python — Supabase is the sole integration point.

**Tech Stack:** Python 3.12, FastAPI, Docling, OpenAI Python SDK, supabase-py, pgmq (Supabase Queues), pg_cron, pytest

---

## Architecture Overview

```
Next.js (Vercel)              Supabase                    Python Service (Render)
────────────────              ────────                    ───────────────────────
Upload file ──────────▶ Storage (files)
Create doc (pending) ─▶ Postgres (documents)
enqueue_ingestion() ──▶ pgmq: ingestion_jobs
                                                         Worker loop (every 5s)
                        pgmq.read() ◀───────────────── poll queue
                                                         Download from Storage
                                                         Docling parse
                                                         Chunk text
                                                         Embed via OpenAI
                        Postgres ◀──────────────────── INSERT chunks + vectors
                        (document_chunks)
                        Postgres ◀──────────────────── UPDATE status → complete
                        (documents)
                        pgmq.archive() ◀────────────── acknowledge message
UI polls ◀────────────── SELECT status
```

## What Changes vs Phase 2

| Component | Phase 2 (current) | Phase 2.5 (new) |
|-----------|-------------------|------------------|
| Parser | `unpdf` (TypeScript) | Docling (Python) |
| Pipeline orchestrator | `lib/rag/pipeline.ts` | Python worker service |
| Chunker | `lib/rag/chunker.ts` | Python port (same algorithm) |
| Embedder (ingestion) | `lib/rag/embedder.ts` | Python OpenAI SDK |
| Embedder (query-time) | `lib/rag/embedder.ts` | **Stays in TypeScript** |
| Job trigger | Fire-and-forget HTTP to `/api/ingest` | pgmq queue via RPC |
| Retry/resilience | None | pgmq visibility timeout + DLQ |
| Supported formats | PDF, Markdown, Plain text | PDF, Markdown, Plain text, DOCX, HTML |

## What Stays Unchanged

- `document_chunks` table schema, indexes, and RLS policies
- `documents` table and status field contract (pending/processing/complete/error)
- Upload UI pattern (server action → storage → trigger ingestion)
- Document list with status polling (every 3s)
- Delete with processing guard
- Content hash (SHA-256) for delta processing
- `embedQuery()` in TypeScript for search/chat (query-time embedding stays in Next.js)
- All existing Supabase migrations (00001–00007)

---

## Task 2.5.1: Supabase Queue Infrastructure

**Files:**
- Create: `supabase/migrations/00008_ingestion_queue.sql`

**Step 1: Write the migration**

Create a migration that enables pgmq, creates the ingestion queue, creates the enqueue RPC function, and sets up pg_cron housekeeping.

```sql
-- Enable pgmq extension
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create the ingestion queue
SELECT pgmq.create('ingestion_jobs');

-- Create a dead letter queue for permanently failed jobs
SELECT pgmq.create('ingestion_jobs_dlq');

-- RPC wrapper: enqueue an ingestion job (called from Next.js via supabase.rpc())
-- Uses SECURITY INVOKER so RLS on documents table applies
CREATE OR REPLACE FUNCTION public.enqueue_ingestion(p_document_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_msg_id bigint;
BEGIN
  -- Verify calling user has access to this document (RLS enforced)
  SELECT organization_id INTO v_org_id
  FROM public.documents
  WHERE id = p_document_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Document not found or access denied';
  END IF;

  -- Enqueue the job
  SELECT * INTO v_msg_id
  FROM pgmq.send(
    queue_name := 'ingestion_jobs',
    msg := jsonb_build_object(
      'document_id', p_document_id,
      'organization_id', v_org_id,
      'requested_at', now()
    )
  );

  RETURN v_msg_id;
END;
$$;

-- Grant to authenticated users
GRANT EXECUTE ON FUNCTION public.enqueue_ingestion(uuid) TO authenticated;
```

**Step 2: Apply the migration locally**

Run: `supabase db reset` (from project root, NOT the worktree)
Expected: All 8 migrations apply cleanly, pgmq extension enabled

**Step 3: Verify the queue works**

```bash
# Connect to local Supabase Postgres
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
  SELECT * FROM pgmq.send('ingestion_jobs', '{\"test\": true}'::jsonb);
  SELECT * FROM pgmq.read('ingestion_jobs', 10, 1);
"
```

Expected: Message sent and read successfully

**Step 4: Commit**

```bash
git add supabase/migrations/00008_ingestion_queue.sql
git commit -m "feat: add pgmq ingestion queue with enqueue RPC function"
```

---

## Task 2.5.2: pg_cron Housekeeping Jobs

**Files:**
- Create: `supabase/migrations/00009_ingestion_cron.sql`

**Step 1: Write the migration**

```sql
-- Enable pg_cron (pre-installed on Supabase hosted)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Housekeeping function: mark stale documents as error
-- Documents stuck in "processing" for > 10 minutes are likely failed
CREATE OR REPLACE FUNCTION public.cleanup_stale_ingestion_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.documents
  SET status = 'error',
      error_message = 'Processing timed out after 10 minutes'
  WHERE status = 'processing'
    AND updated_at < now() - interval '10 minutes';
END;
$$;

-- Schedule: run every 5 minutes
SELECT cron.schedule(
  'cleanup-stale-ingestion',
  '*/5 * * * *',
  'SELECT public.cleanup_stale_ingestion_jobs()'
);
```

Note: This migration requires an `updated_at` column on the `documents` table. Check if it exists; if not, we'll add it in this migration.

**Step 2: Check if documents table has updated_at**

Read the documents migration (`00005_documents.sql`) to check. If `updated_at` is missing, prepend to this migration:

```sql
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

**Step 3: Apply and verify**

Run: `supabase db reset`
Expected: All 9 migrations apply cleanly, cron job visible in `cron.job`

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT * FROM cron.job;"
```

**Step 4: Commit**

```bash
git add supabase/migrations/00009_ingestion_cron.sql
git commit -m "feat: add pg_cron stale ingestion cleanup (every 5 min)"
```

---

## Task 2.5.3: Update Next.js to Use Queue Instead of Fire-and-Forget

**Files:**
- Modify: `components/documents/upload-form.tsx`
- Modify: `app/(dashboard)/documents/actions.ts`
- Delete (or keep as dead code): `app/api/ingest/route.ts`
- Delete (or keep as dead code): `lib/rag/pipeline.ts`

**Step 1: Update uploadDocument server action to enqueue**

In `app/(dashboard)/documents/actions.ts`, after the successful document insert, add the queue call:

```typescript
// After successful document insert, enqueue ingestion job
const { error: queueError } = await supabase.rpc('enqueue_ingestion', {
  p_document_id: documentId,
});

if (queueError) {
  console.error("Failed to enqueue ingestion:", queueError);
  // Don't fail the upload — document is saved, just not queued
  // The pg_cron retry job will pick it up
}
```

**Step 2: Remove fire-and-forget fetch from upload-form.tsx**

Remove the `fetch("/api/ingest", ...)` block from the upload form. The server action now handles enqueuing directly.

**Step 3: Remove or deprecate the /api/ingest route**

Delete `app/api/ingest/route.ts` — it's no longer needed since enqueuing happens in the server action.

**Step 4: Keep lib/rag/embedder.ts embedQuery function**

The `embedQuery()` function stays — it's used at query-time by the search/chat flow. Only the ingestion-time `embedTexts()` moves to Python. Leave this file as-is for now.

**Step 5: Verify build**

Run: `pnpm build` (from worktree)
Expected: Clean build with no errors

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: switch ingestion trigger from fire-and-forget to pgmq queue"
```

---

## Task 2.5.4: Python Service Scaffold

**Files:**
- Create: `services/ingestion/pyproject.toml`
- Create: `services/ingestion/README.md`
- Create: `services/ingestion/.env.example`
- Create: `services/ingestion/.python-version`
- Create: `services/ingestion/src/__init__.py`
- Create: `services/ingestion/src/config.py`
- Create: `services/ingestion/src/main.py`
- Create: `services/ingestion/Dockerfile`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "rag-ingestion-service"
version = "0.1.0"
description = "Document ingestion service using Docling + pgmq"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "docling>=2.70.0",
    "openai>=1.60.0",
    "supabase>=2.11.0",
    "pgmq>=0.8.0",
    "pydantic>=2.10.0",
    "pydantic-settings>=2.7.0",
    "python-multipart>=0.0.18",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.8.0",
]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

**Step 2: Create .python-version**

```
3.12
```

**Step 3: Create .env.example**

```env
# Supabase
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Supabase Direct DB (for pgmq polling)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# OpenAI
OPENAI_API_KEY=sk-your-key

# Queue settings
QUEUE_POLL_INTERVAL=5
QUEUE_VISIBILITY_TIMEOUT=300
QUEUE_MAX_RETRIES=3

# Embedding
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_BATCH_SIZE=100
EMBEDDING_DIMENSIONS=1536

# Chunking
CHUNK_MAX_TOKENS=512
CHUNK_OVERLAP=0.15
```

**Step 4: Create src/config.py**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    database_url: str

    # OpenAI
    openai_api_key: str

    # Queue
    queue_poll_interval: int = 5
    queue_visibility_timeout: int = 300
    queue_max_retries: int = 3

    # Embedding
    embedding_model: str = "text-embedding-3-small"
    embedding_batch_size: int = 100
    embedding_dimensions: int = 1536

    # Chunking
    chunk_max_tokens: int = 512
    chunk_overlap: float = 0.15

    model_config = {"env_file": ".env"}


settings = Settings()
```

**Step 5: Create src/main.py (FastAPI app with health endpoint)**

```python
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.config import settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

worker_task: asyncio.Task | None = None


async def poll_queue():
    """Main worker loop — polls pgmq for ingestion jobs."""
    from src.worker import process_next_job

    while True:
        try:
            processed = await process_next_job()
            if not processed:
                await asyncio.sleep(settings.queue_poll_interval)
        except Exception as e:
            logger.error(f"Worker error: {e}")
            await asyncio.sleep(settings.queue_poll_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker_task
    logger.info("Starting ingestion worker...")
    worker_task = asyncio.create_task(poll_queue())
    yield
    logger.info("Shutting down ingestion worker...")
    if worker_task:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="RAG Ingestion Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "queue": "ingestion_jobs"}
```

**Step 6: Create Dockerfile**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for Docling
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY src/ ./src/

# Pre-download Docling models at build time (avoids first-run delay)
RUN python -c "from docling.document_converter import DocumentConverter; DocumentConverter()"

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Step 7: Install dependencies locally and verify**

```bash
cd services/ingestion
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Expected: All dependencies install, including Docling (may take a few minutes for model downloads)

**Step 8: Verify FastAPI starts**

```bash
cd services/ingestion
uvicorn src.main:app --reload --port 8000
# Then: curl http://localhost:8000/health
```

Expected: `{"status":"ok","queue":"ingestion_jobs"}`

**Step 9: Commit**

```bash
git add services/ingestion/
git commit -m "feat: scaffold Python ingestion service with FastAPI + Docling"
```

---

## Task 2.5.5: Docling Document Parser

**Files:**
- Create: `services/ingestion/src/parser.py`
- Create: `services/ingestion/tests/__init__.py`
- Create: `services/ingestion/tests/test_parser.py`
- Create: `services/ingestion/tests/fixtures/` (test PDF and markdown files)

**Step 1: Write failing tests**

```python
# tests/test_parser.py
import pytest
from pathlib import Path

from src.parser import parse_document, ParseResult

FIXTURES = Path(__file__).parent / "fixtures"


class TestPdfParsing:
    def test_extracts_text_from_pdf(self):
        pdf_path = FIXTURES / "sample.pdf"
        result = parse_document(pdf_path, "application/pdf")
        assert isinstance(result, ParseResult)
        assert len(result.text) > 0

    def test_extracts_sections_from_pdf(self):
        pdf_path = FIXTURES / "sample.pdf"
        result = parse_document(pdf_path, "application/pdf")
        assert len(result.sections) > 0
        # Each section has content and headers
        for section in result.sections:
            assert len(section.content) > 0

    def test_extracts_tables_as_markdown(self):
        pdf_path = FIXTURES / "sample-with-table.pdf"
        result = parse_document(pdf_path, "application/pdf")
        # Tables should appear in the text as markdown tables
        assert "|" in result.text


class TestMarkdownParsing:
    def test_extracts_text_from_markdown(self):
        md_path = FIXTURES / "sample.md"
        result = parse_document(md_path, "text/markdown")
        assert len(result.text) > 0

    def test_extracts_sections_with_headers(self):
        md_path = FIXTURES / "sample.md"
        result = parse_document(md_path, "text/markdown")
        assert len(result.sections) > 0
        # At least one section should have headers
        has_headers = any(len(s.headers) > 0 for s in result.sections)
        assert has_headers


class TestPlainTextParsing:
    def test_extracts_text_from_plain(self):
        txt_path = FIXTURES / "sample.txt"
        result = parse_document(txt_path, "text/plain")
        assert len(result.text) > 0
        assert len(result.sections) >= 1


class TestUnsupportedFormat:
    def test_raises_on_unsupported_mime_type(self):
        with pytest.raises(ValueError, match="Unsupported"):
            parse_document(Path("fake.xyz"), "application/octet-stream")
```

**Step 2: Create test fixtures**

Create minimal test files:
- `tests/fixtures/sample.pdf` — A simple 1-page PDF with a title and two paragraphs (generate with reportlab or use a real sample)
- `tests/fixtures/sample-with-table.pdf` — A PDF with at least one table
- `tests/fixtures/sample.md` — Markdown with H1, H2, paragraphs
- `tests/fixtures/sample.txt` — Plain text file

For the markdown fixture:
```markdown
# Lease Agreement

This document outlines the terms of the lease.

## Section 1: Term

The lease term begins on January 1, 2026 and ends on December 31, 2026.

## Section 2: Rent

Monthly rent is $2,500 due on the first of each month.

### Late Fees

A late fee of $100 applies after the 5th of each month.
```

**Step 3: Run tests to verify they fail**

```bash
cd services/ingestion
pytest tests/test_parser.py -v
```

Expected: FAIL — `src.parser` module does not exist

**Step 4: Implement the parser**

```python
# src/parser.py
import tempfile
import logging
from dataclasses import dataclass, field
from pathlib import Path

from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling_core.types.doc.labels import DocItemLabel

logger = logging.getLogger(__name__)

# Initialize converter once (loads AI models into memory)
_converter: DocumentConverter | None = None


def get_converter() -> DocumentConverter:
    global _converter
    if _converter is None:
        _converter = DocumentConverter(
            allowed_formats=[
                InputFormat.PDF,
                InputFormat.MD,
                InputFormat.HTML,
                InputFormat.DOCX,
            ]
        )
    return _converter


@dataclass
class Section:
    content: str
    headers: list[str] = field(default_factory=list)
    level: int = 0


@dataclass
class ParseResult:
    text: str
    sections: list[Section]
    page_count: int = 1


SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "text/markdown",
    "text/plain",
    "text/html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def parse_document(file_path: Path, mime_type: str) -> ParseResult:
    """Parse a document using Docling and return structured text with sections."""
    if mime_type not in SUPPORTED_MIME_TYPES:
        raise ValueError(f"Unsupported MIME type: {mime_type}")

    if mime_type == "text/plain":
        return _parse_plain_text(file_path)

    converter = get_converter()
    result = converter.convert(str(file_path))
    doc = result.document

    # Get full text as markdown (preserves structure, tables, etc.)
    text = doc.export_to_markdown()

    # Extract sections with header hierarchy
    sections = _extract_sections(doc)

    # Get page count
    page_count = len(doc.pages) if hasattr(doc, "pages") and doc.pages else 1

    return ParseResult(text=text, sections=sections, page_count=page_count)


def _extract_sections(doc) -> list[Section]:
    """Walk Docling's document tree and extract sections with header breadcrumbs."""
    sections: list[Section] = []
    header_stack: list[str] = []
    current_content: list[str] = []
    current_level = 0

    for item, level in doc.iterate_items():
        label = getattr(item, "label", None)
        text = getattr(item, "text", "").strip()

        if not text:
            # Check for tables
            if label == DocItemLabel.TABLE and hasattr(item, "export_to_markdown"):
                table_md = item.export_to_markdown()
                if table_md:
                    current_content.append(table_md)
            continue

        if label == DocItemLabel.SECTION_HEADER:
            # Flush current section
            _flush_section(sections, current_content, header_stack, current_level)
            current_content = []

            # Update header stack
            h_level = getattr(item, "level", 1)
            # Trim stack to parent level, then set current
            header_stack = header_stack[: h_level - 1]
            while len(header_stack) < h_level:
                header_stack.append("")
            header_stack[h_level - 1] = text
            current_level = h_level

        elif label == DocItemLabel.TITLE:
            _flush_section(sections, current_content, header_stack, current_level)
            current_content = []
            header_stack = [text]
            current_level = 1

        elif label == DocItemLabel.TABLE and hasattr(item, "export_to_markdown"):
            table_md = item.export_to_markdown()
            if table_md:
                current_content.append(table_md)

        else:
            current_content.append(text)

    # Flush final section
    _flush_section(sections, current_content, header_stack, current_level)

    # If no sections found, return entire text as one section
    if not sections:
        converter = get_converter()
        full_text = doc.export_to_text() if hasattr(doc, "export_to_text") else ""
        if full_text.strip():
            sections.append(Section(content=full_text.strip(), headers=[], level=0))

    return sections


def _flush_section(
    sections: list[Section],
    content_lines: list[str],
    headers: list[str],
    level: int,
):
    content = "\n\n".join(line for line in content_lines if line.strip())
    if content:
        # Filter empty header slots
        clean_headers = [h for h in headers if h]
        sections.append(Section(content=content, headers=list(clean_headers), level=level))


def _parse_plain_text(file_path: Path) -> ParseResult:
    """Simple fallback for plain text files."""
    text = file_path.read_text(encoding="utf-8").strip()
    return ParseResult(
        text=text,
        sections=[Section(content=text, headers=[], level=0)] if text else [],
        page_count=1,
    )
```

**Step 5: Run tests to verify they pass**

```bash
cd services/ingestion
pytest tests/test_parser.py -v
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add services/ingestion/src/parser.py services/ingestion/tests/
git commit -m "feat: Docling document parser with section extraction"
```

---

## Task 2.5.6: Python Recursive Chunker

**Files:**
- Create: `services/ingestion/src/chunker.py`
- Create: `services/ingestion/tests/test_chunker.py`

Port the TypeScript chunker logic 1:1. Same algorithm: paragraph → sentence → word splitting, 15% overlap, header context prefix. Same test cases.

**Step 1: Write failing tests**

Port the 11 TypeScript tests from `tests/unit/chunker.test.ts`:

```python
# tests/test_chunker.py
import pytest

from src.chunker import chunk_text, estimate_tokens, ChunkOptions


class TestChunkText:
    def test_returns_single_chunk_for_short_text(self):
        chunks = chunk_text("Hello world", ChunkOptions(max_tokens=100, overlap=0.15))
        assert len(chunks) == 1
        assert chunks[0].content == "Hello world"

    def test_splits_long_text_into_multiple_chunks(self):
        text = " ".join(["word"] * 200)  # ~50 tokens
        chunks = chunk_text(text, ChunkOptions(max_tokens=20, overlap=0.0))
        assert len(chunks) > 1

    def test_respects_max_tokens_limit(self):
        text = " ".join(["word"] * 400)
        chunks = chunk_text(text, ChunkOptions(max_tokens=30, overlap=0.15))
        for chunk in chunks:
            # 10% tolerance for boundary effects
            assert chunk.token_count <= 30 * 1.1

    def test_applies_overlap_between_chunks(self):
        text = " ".join(["word"] * 200)
        chunks = chunk_text(text, ChunkOptions(max_tokens=30, overlap=0.15))
        if len(chunks) >= 2:
            first_words = set(chunks[0].content.split())
            second_words = set(chunks[1].content.split())
            overlap = first_words & second_words
            assert len(overlap) > 0

    def test_assigns_sequential_indexes(self):
        text = " ".join(["word"] * 200)
        chunks = chunk_text(text, ChunkOptions(max_tokens=30, overlap=0.0))
        for i, chunk in enumerate(chunks):
            assert chunk.index == i

    def test_splits_on_paragraph_boundaries(self):
        # Make paragraphs long enough to exceed max_tokens
        para = " ".join(["word"] * 30)  # ~7.5 tokens each
        text = f"{para}\n\n{para}\n\n{para}"
        chunks = chunk_text(text, ChunkOptions(max_tokens=10, overlap=0.0))
        assert len(chunks) >= 2

    def test_splits_on_sentence_boundaries(self):
        text = "First sentence here. Second sentence here. Third sentence here. Fourth one."
        chunks = chunk_text(text, ChunkOptions(max_tokens=8, overlap=0.0))
        assert len(chunks) >= 2

    def test_returns_empty_for_empty_text(self):
        assert chunk_text("", ChunkOptions(max_tokens=100, overlap=0.0)) == []

    def test_returns_empty_for_whitespace(self):
        assert chunk_text("   \n\n  ", ChunkOptions(max_tokens=100, overlap=0.0)) == []

    def test_prepends_context_prefix(self):
        chunks = chunk_text(
            "Some content here",
            ChunkOptions(
                max_tokens=100,
                overlap=0.0,
                document_title="My Doc",
                section_header="Chapter 1",
            ),
        )
        assert chunks[0].content.startswith("My Doc > Chapter 1\n\n")

    def test_token_count_matches_estimate(self):
        chunks = chunk_text("Hello world foo bar", ChunkOptions(max_tokens=100, overlap=0.0))
        for chunk in chunks:
            assert chunk.token_count == estimate_tokens(chunk.content)
```

**Step 2: Run tests to verify they fail**

```bash
pytest tests/test_chunker.py -v
```

Expected: FAIL — module not found

**Step 3: Implement the chunker**

```python
# src/chunker.py
import math
import re
from dataclasses import dataclass


@dataclass
class Chunk:
    content: str
    index: int
    token_count: int


@dataclass
class ChunkOptions:
    max_tokens: int
    overlap: float
    document_title: str | None = None
    section_header: str | None = None


def estimate_tokens(text: str) -> int:
    """Approximate token count: ~4 chars per token."""
    return math.ceil(len(text) / 4)


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\n+", text) if p.strip()]


def _split_sentences(text: str) -> list[str]:
    sentences = re.findall(r"[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$", text)
    if not sentences:
        return [text]
    return [s.strip() for s in sentences if s.strip()]


def _merge_segments(segments: list[str], max_tokens: int) -> list[str]:
    result: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for segment in segments:
        seg_tokens = estimate_tokens(segment)
        if seg_tokens > max_tokens:
            if current:
                result.append(" ".join(current))
                current = []
                current_tokens = 0
            result.extend(_split_segment(segment, max_tokens))
            continue
        if current_tokens + seg_tokens > max_tokens and current:
            result.append(" ".join(current))
            current = []
            current_tokens = 0
        current.append(segment)
        current_tokens += seg_tokens

    if current:
        result.append(" ".join(current))
    return result


def _split_segment(text: str, max_tokens: int) -> list[str]:
    if estimate_tokens(text) <= max_tokens:
        return [text]

    paragraphs = _split_paragraphs(text)
    if len(paragraphs) > 1:
        return _merge_segments(paragraphs, max_tokens)

    sentences = _split_sentences(text)
    if len(sentences) > 1:
        return _merge_segments(sentences, max_tokens)

    words = text.split()
    return _merge_segments(words, max_tokens)


def _apply_overlap(chunks: list[str], overlap_ratio: float, max_tokens: int) -> list[str]:
    if len(chunks) <= 1 or overlap_ratio <= 0:
        return chunks

    overlap_tokens = int(max_tokens * overlap_ratio)
    result = [chunks[0]]

    for i in range(1, len(chunks)):
        prev_words = chunks[i - 1].split()
        overlap_words: list[str] = []

        for j in range(len(prev_words) - 1, -1, -1):
            candidate = [prev_words[j]] + overlap_words
            if estimate_tokens(" ".join(candidate)) > overlap_tokens:
                break
            overlap_words = candidate

        overlap_text = " ".join(overlap_words)
        if overlap_text:
            result.append(overlap_text + " " + chunks[i])
        else:
            result.append(chunks[i])

    return result


def _build_prefix(document_title: str | None, section_header: str | None) -> str:
    parts = [p for p in [document_title, section_header] if p]
    if not parts:
        return ""
    return " > ".join(parts) + "\n\n"


def chunk_text(text: str, options: ChunkOptions) -> list[Chunk]:
    trimmed = text.strip()
    if not trimmed:
        return []

    prefix = _build_prefix(options.document_title, options.section_header)
    prefix_tokens = estimate_tokens(prefix)
    content_max_tokens = options.max_tokens - prefix_tokens
    overlap_budget = int(content_max_tokens * options.overlap)
    split_target = content_max_tokens - overlap_budget

    raw_chunks = _split_segment(trimmed, split_target)
    raw_chunks = _apply_overlap(raw_chunks, options.overlap, content_max_tokens)

    return [
        Chunk(
            content=prefix + content,
            index=i,
            token_count=estimate_tokens(prefix + content),
        )
        for i, content in enumerate(raw_chunks)
    ]
```

**Step 4: Run tests**

```bash
pytest tests/test_chunker.py -v
```

Expected: All 11 tests PASS

**Step 5: Commit**

```bash
git add services/ingestion/src/chunker.py services/ingestion/tests/test_chunker.py
git commit -m "feat: Python recursive chunker (ported from TypeScript)"
```

---

## Task 2.5.7: Python Embedding Wrapper

**Files:**
- Create: `services/ingestion/src/embedder.py`
- Create: `services/ingestion/tests/test_embedder.py`

**Step 1: Write failing tests**

```python
# tests/test_embedder.py
import pytest

from src.embedder import embed_texts, EmbeddingResult, set_embedding_client


class MockEmbeddingClient:
    """Mock OpenAI client for testing."""

    def __init__(self):
        self.calls: list[dict] = []

    def create(self, *, model: str, input: list[str]) -> dict:
        self.calls.append({"model": model, "input": input})
        return {
            "data": [
                {"embedding": [0.1] * 1536, "index": i}
                for i in range(len(input))
            ],
            "usage": {"prompt_tokens": len(input) * 10, "total_tokens": len(input) * 10},
        }


@pytest.fixture(autouse=True)
def mock_client():
    client = MockEmbeddingClient()
    set_embedding_client(client)
    yield client
    set_embedding_client(None)


class TestEmbedTexts:
    def test_returns_embeddings_for_batch(self, mock_client):
        result = embed_texts(["hello", "world"])
        assert len(result.embeddings) == 2
        assert len(result.embeddings[0]) == 1536

    def test_uses_correct_model(self, mock_client):
        embed_texts(["test"])
        assert mock_client.calls[0]["model"] == "text-embedding-3-small"

    def test_splits_large_batches(self, mock_client):
        texts = [f"text {i}" for i in range(150)]
        result = embed_texts(texts)
        assert len(result.embeddings) == 150
        assert len(mock_client.calls) == 2  # 100 + 50

    def test_returns_empty_for_empty_input(self, mock_client):
        result = embed_texts([])
        assert result.embeddings == []
        assert result.token_count == 0
        assert len(mock_client.calls) == 0

    def test_tracks_token_count(self, mock_client):
        result = embed_texts(["hello", "world"])
        assert result.token_count == 20  # 2 texts * 10 tokens each

    def test_propagates_errors(self, mock_client):
        def raise_error(**kwargs):
            raise Exception("API error")

        mock_client.create = raise_error
        with pytest.raises(Exception, match="API error"):
            embed_texts(["hello"])
```

**Step 2: Run tests to verify they fail**

```bash
pytest tests/test_embedder.py -v
```

Expected: FAIL — module not found

**Step 3: Implement the embedder**

```python
# src/embedder.py
from dataclasses import dataclass, field

from src.config import settings

BATCH_SIZE = settings.embedding_batch_size
MODEL = settings.embedding_model


@dataclass
class EmbeddingResult:
    embeddings: list[list[float]] = field(default_factory=list)
    token_count: int = 0


_client = None


def get_embedding_client():
    global _client
    if _client is None:
        import openai

        _client = openai.OpenAI().embeddings
    return _client


def set_embedding_client(client) -> None:
    global _client
    _client = client


def embed_texts(texts: list[str]) -> EmbeddingResult:
    if not texts:
        return EmbeddingResult()

    client = get_embedding_client()
    all_embeddings: list[list[float]] = []
    total_tokens = 0

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        response = client.create(model=MODEL, input=batch)

        sorted_data = sorted(response["data"], key=lambda x: x["index"])
        for item in sorted_data:
            all_embeddings.append(item["embedding"])
        total_tokens += response["usage"]["prompt_tokens"]

    return EmbeddingResult(embeddings=all_embeddings, token_count=total_tokens)
```

**Step 4: Run tests**

```bash
pytest tests/test_embedder.py -v
```

Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add services/ingestion/src/embedder.py services/ingestion/tests/test_embedder.py
git commit -m "feat: Python embedding wrapper with batch support and DI"
```

---

## Task 2.5.8: Queue Worker (Pipeline Orchestrator)

**Files:**
- Create: `services/ingestion/src/worker.py`
- Create: `services/ingestion/tests/test_worker.py`

This is the main orchestrator that replaces `lib/rag/pipeline.ts`. It polls pgmq, processes documents, and handles retries/DLQ.

**Step 1: Write failing tests**

```python
# tests/test_worker.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.worker import process_message


class TestProcessMessage:
    @patch("src.worker.download_file")
    @patch("src.worker.parse_document")
    @patch("src.worker.chunk_sections")
    @patch("src.worker.embed_texts")
    @patch("src.worker.upsert_chunks")
    @patch("src.worker.update_document_status")
    def test_orchestrates_full_pipeline(
        self,
        mock_status,
        mock_upsert,
        mock_embed,
        mock_chunk,
        mock_parse,
        mock_download,
    ):
        mock_download.return_value = b"file content"
        mock_parse.return_value = MagicMock(
            sections=[MagicMock(content="text", headers=["H1"], level=1)],
            text="text",
        )
        mock_chunk.return_value = [MagicMock(content="chunk", index=0, token_count=5)]
        mock_embed.return_value = MagicMock(embeddings=[[0.1] * 1536], token_count=5)

        message = {
            "document_id": "doc-123",
            "organization_id": "org-456",
        }

        process_message(message)

        mock_download.assert_called_once()
        mock_parse.assert_called_once()
        mock_chunk.assert_called_once()
        mock_embed.assert_called_once()
        mock_upsert.assert_called_once()
        assert mock_status.call_count == 2  # processing + complete

    @patch("src.worker.download_file")
    @patch("src.worker.update_document_status")
    def test_sets_error_status_on_failure(self, mock_status, mock_download):
        mock_download.side_effect = Exception("Download failed")

        message = {
            "document_id": "doc-123",
            "organization_id": "org-456",
        }

        process_message(message)

        # Should have called with "processing" then "error"
        calls = [c[0] for c in mock_status.call_args_list]
        assert calls[-1][1] == "error"
```

**Step 2: Run tests to verify they fail**

```bash
pytest tests/test_worker.py -v
```

Expected: FAIL — module not found

**Step 3: Implement the worker**

```python
# src/worker.py
import json
import logging
import tempfile
from pathlib import Path

from pgmq import PGMQueue

from src.config import settings
from src.parser import parse_document, ParseResult
from src.chunker import chunk_text, ChunkOptions, Chunk
from src.embedder import embed_texts

logger = logging.getLogger(__name__)

_queue: PGMQueue | None = None


def get_queue() -> PGMQueue:
    global _queue
    if _queue is None:
        from urllib.parse import urlparse

        parsed = urlparse(settings.database_url)
        _queue = PGMQueue(
            host=parsed.hostname,
            port=str(parsed.port or 5432),
            username=parsed.username or "postgres",
            password=parsed.password or "postgres",
            database=parsed.path.lstrip("/") or "postgres",
        )
    return _queue


def _get_supabase():
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def update_document_status(
    document_id: str, status: str, error_message: str | None = None, chunk_count: int | None = None
):
    supabase = _get_supabase()
    update_data: dict = {"status": status}
    if error_message is not None:
        update_data["error_message"] = error_message
    if chunk_count is not None:
        update_data["chunk_count"] = chunk_count
    supabase.table("documents").update(update_data).eq("id", document_id).execute()


def download_file(storage_path: str) -> bytes:
    supabase = _get_supabase()
    response = supabase.storage.from_("documents").download(storage_path)
    return response


def chunk_sections(parse_result: ParseResult, doc_name: str) -> list[Chunk]:
    """Chunk each section separately with header context."""
    all_chunks: list[Chunk] = []
    for section in parse_result.sections:
        section_chunks = chunk_text(
            section.content,
            ChunkOptions(
                max_tokens=settings.chunk_max_tokens,
                overlap=settings.chunk_overlap,
                document_title=doc_name,
                section_header=" > ".join(section.headers) if section.headers else None,
            ),
        )
        all_chunks.extend(section_chunks)

    # Re-index sequentially
    for i, chunk in enumerate(all_chunks):
        chunk.index = i

    return all_chunks


def upsert_chunks(
    chunks: list[Chunk],
    embeddings: list[list[float]],
    document_id: str,
    organization_id: str,
    doc_name: str,
):
    supabase = _get_supabase()
    batch_size = 50

    rows = [
        {
            "document_id": document_id,
            "organization_id": organization_id,
            "content": chunk.content,
            "embedding": json.dumps(embeddings[i]),
            "chunk_index": chunk.index,
            "token_count": chunk.token_count,
            "metadata": {"document_name": doc_name},
        }
        for i, chunk in enumerate(chunks)
    ]

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        supabase.table("document_chunks").insert(batch).execute()


def process_message(message: dict) -> None:
    """Process a single ingestion job message."""
    document_id = message["document_id"]
    organization_id = message["organization_id"]

    # Set status to processing
    update_document_status(document_id, "processing")

    try:
        # Fetch document record
        supabase = _get_supabase()
        doc_response = (
            supabase.table("documents").select("*").eq("id", document_id).single().execute()
        )
        doc = doc_response.data

        # Download file from storage
        file_bytes = download_file(doc["storage_path"])

        # Write to temp file for Docling
        suffix = Path(doc["name"]).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        try:
            # Parse with Docling
            parse_result = parse_document(tmp_path, doc["mime_type"])

            # Chunk sections
            chunks = chunk_sections(parse_result, doc["name"])
            if not chunks:
                raise ValueError("No chunks generated from document")

            # Embed
            embedding_result = embed_texts([c.content for c in chunks])

            # Upsert to database
            upsert_chunks(
                chunks,
                embedding_result.embeddings,
                document_id,
                organization_id,
                doc["name"],
            )

            # Success
            update_document_status(
                document_id, "complete", error_message=None, chunk_count=len(chunks)
            )
            logger.info(
                f"Document {document_id} processed: {len(chunks)} chunks, "
                f"{embedding_result.token_count} tokens"
            )
        finally:
            tmp_path.unlink(missing_ok=True)

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Ingestion failed for {document_id}: {error_msg}")
        update_document_status(document_id, "error", error_message=error_msg)
        raise  # Re-raise so the queue handler knows it failed


async def process_next_job() -> bool:
    """Poll the queue for the next job. Returns True if a job was processed."""
    queue = get_queue()

    messages = queue.read(
        "ingestion_jobs",
        vt=settings.queue_visibility_timeout,
    )

    if not messages:
        return False

    msg = messages[0] if isinstance(messages, list) else messages
    msg_id = msg.msg_id
    message = msg.message
    read_count = msg.read_ct

    logger.info(f"Processing job {msg_id} (attempt {read_count}): {message}")

    # Check retry limit
    if read_count > settings.queue_max_retries:
        logger.warning(f"Message {msg_id} exceeded max retries ({read_count}), moving to DLQ")
        queue.send("ingestion_jobs_dlq", message)
        queue.delete("ingestion_jobs", msg_id)
        update_document_status(
            message["document_id"],
            "error",
            error_message=f"Failed after {settings.queue_max_retries} retries",
        )
        return True

    try:
        process_message(message)
        queue.archive("ingestion_jobs", msg_id)
        logger.info(f"Job {msg_id} completed and archived")
    except Exception as e:
        logger.error(f"Job {msg_id} failed: {e}")
        # Message will become visible again after visibility timeout

    return True
```

**Step 4: Run tests**

```bash
pytest tests/test_worker.py -v
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_worker.py
git commit -m "feat: queue worker orchestrating Docling parse → chunk → embed → upsert"
```

---

## Task 2.5.9: Expand Upload UI for Docling-Supported Formats

**Files:**
- Modify: `components/documents/upload-form.tsx`
- Modify: `app/(dashboard)/documents/actions.ts`
- Modify: `components/documents/document-list.tsx`

**Step 1: Update allowed MIME types in server action**

In `actions.ts`, expand the `allowedTypes` array:

```typescript
const allowedTypes = [
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
```

Update the error message accordingly.

**Step 2: Update upload form accepted types**

In `upload-form.tsx`, update the `accept` attribute and the `ACCEPTED_TYPES` constant:

```typescript
const ACCEPTED_TYPES = [
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// In the file input:
accept=".pdf,.md,.txt,.html,.docx"
```

**Step 3: Update document list type labels**

In `document-list.tsx`, add labels for new types:

```typescript
function fileTypeLabel(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime === "text/markdown") return "Markdown";
  if (mime === "text/plain") return "Text";
  if (mime === "text/html") return "HTML";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
  return mime;
}
```

**Step 4: Verify build**

Run: `pnpm build` (from worktree)
Expected: Clean build

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: expand upload UI to accept DOCX and HTML (Docling-supported formats)"
```

---

## Task 2.5.10: Clean Up Replaced TypeScript Code

**Files:**
- Delete: `lib/parsers/pdf.ts`
- Delete: `lib/parsers/markdown.ts`
- Modify: `lib/parsers/index.ts` (remove parser routing — no longer used for ingestion)
- Delete: `lib/rag/pipeline.ts`
- Delete: `lib/rag/chunker.ts`
- Delete: `app/api/ingest/route.ts`
- Delete: `tests/unit/pdf-parser.test.ts`
- Delete: `tests/unit/markdown-parser.test.ts`
- Delete: `tests/unit/chunker.test.ts`
- Keep: `lib/rag/embedder.ts` (still used for query-time embedding)
- Keep: `tests/unit/embedder.test.ts` (still valid for embedQuery tests)

**Step 1: Remove files**

```bash
rm lib/parsers/pdf.ts lib/parsers/markdown.ts
rm lib/rag/pipeline.ts lib/rag/chunker.ts
rm app/api/ingest/route.ts
rm tests/unit/pdf-parser.test.ts tests/unit/markdown-parser.test.ts tests/unit/chunker.test.ts
```

**Step 2: Simplify lib/parsers/index.ts**

This file is no longer needed for ingestion (Python handles parsing). But keep a minimal version if any TypeScript code still imports from it:

```typescript
// lib/parsers/index.ts
// Parsing is now handled by the Python ingestion service.
// This module is retained for potential future TypeScript-side parsing needs.
export type ParseResult = {
  text: string;
  pageCount: number;
};
```

**Step 3: Remove unpdf dependency**

```bash
pnpm remove unpdf
```

**Step 4: Verify remaining tests pass**

```bash
pnpm vitest run
```

Expected: Embedder tests (7) still pass. Total test count drops from 29 to 7.

**Step 5: Verify build**

```bash
pnpm build
```

Expected: Clean build (no broken imports)

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove TypeScript parsers/chunker/pipeline (replaced by Python service)"
```

---

## Task 2.5.11: Update Documentation and Configuration

**Files:**
- Modify: `PLAN.md`
- Modify: `specs/ARCHITECTURE.md`
- Modify: `.ai/INBOX.md` (triage the Docling decision)

**Step 1: Update PLAN.md**

Add Phase 2.5 section documenting what was done. Update the architecture decision about service count (now 3 services). Update the "Key Decisions" section.

**Step 2: Update ARCHITECTURE.md**

Update the system overview diagram to show 3 services. Add the Python ingestion service to the tech stack table. Update the document ingestion flow diagram to show pgmq.

**Step 3: Update INBOX.md**

Move "Docling" from open question to triaged (decision: adopted). Move "Supabase Realtime for status" to triaged (decision: deferred, polling works fine for now).

**Step 4: Commit**

```bash
git add PLAN.md specs/ARCHITECTURE.md .ai/INBOX.md
git commit -m "docs: update architecture docs for Docling + pgmq service"
```

---

## Task 2.5.12: Local Development Docker Compose (Optional)

**Files:**
- Create: `docker-compose.dev.yml`

For local development, the Python service can run alongside the Next.js dev server and local Supabase.

**Step 1: Create docker-compose.dev.yml**

```yaml
# Optional: run the ingestion service locally via Docker
# Supabase runs via `supabase start`, Next.js via `pnpm dev`
services:
  ingestion:
    build: ./services/ingestion
    ports:
      - "8000:8000"
    env_file:
      - ./services/ingestion/.env
    environment:
      - SUPABASE_URL=http://host.docker.internal:54321
      - DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**Step 2: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat: add Docker Compose for local ingestion service development"
```

---

## Execution Summary

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 2.5.1 | Supabase Queue Infrastructure (pgmq migration) | S |
| 2.5.2 | pg_cron Housekeeping Jobs | S |
| 2.5.3 | Update Next.js to Use Queue | M |
| 2.5.4 | Python Service Scaffold | M |
| 2.5.5 | Docling Document Parser (TDD) | L |
| 2.5.6 | Python Recursive Chunker (TDD) | M |
| 2.5.7 | Python Embedding Wrapper (TDD) | S |
| 2.5.8 | Queue Worker / Pipeline Orchestrator | L |
| 2.5.9 | Expand Upload UI for New Formats | S |
| 2.5.10 | Clean Up Replaced TypeScript Code | S |
| 2.5.11 | Update Documentation | S |
| 2.5.12 | Local Development Docker Compose | S |

**Total: 12 tasks** (4S + 4M + 2L + 2S = roughly 1-2 sessions)

---

## Review Checkpoint

After completing all tasks, verify:
- [ ] `supabase db reset` runs all 9 migrations cleanly
- [ ] Python tests pass: `cd services/ingestion && pytest -v`
- [ ] TypeScript tests pass: `pnpm vitest run` (7 embedder tests)
- [ ] Next.js build clean: `pnpm build`
- [ ] Python service starts: `uvicorn src.main:app`
- [ ] Health check: `curl localhost:8000/health`
- [ ] End-to-end: upload a PDF via UI → document status goes pending → processing → complete
