# Contextual Chunking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in LLM-generated per-chunk context (Anthropic's Contextual Retrieval) to improve embedding and BM25 search quality.

**Architecture:** New `contextualizer.py` module mirrors the VLM pattern — async concurrent GPT-4o-mini calls gated by a semaphore. Slots into the pipeline between chunking and embedding. New `context` column on `document_chunks` + updated `fts` generated column.

**Tech Stack:** Python (AsyncOpenAI, asyncio), Supabase (migration), GPT-4o-mini

**Design doc:** `docs/plans/2026-02-25-contextual-chunking-design.md`

---

### Task 1: Add `context` field to Chunk dataclass

**Files:**
- Modify: `services/ingestion/src/chunker.py:6-11`
- Test: `services/ingestion/tests/test_chunker.py`

**Step 1: Write the failing test**

Add to `services/ingestion/tests/test_chunker.py`:

```python
def test_chunk_has_context_field_defaulting_to_none(self):
    chunks = chunk_text("Hello world", ChunkOptions(max_tokens=100, overlap=0.0))
    assert chunks[0].context is None
```

**Step 2: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_chunker.py::TestChunkText::test_chunk_has_context_field_defaulting_to_none -v`
Expected: FAIL with `AttributeError: 'Chunk' object has no attribute 'context'`

**Step 3: Write minimal implementation**

In `services/ingestion/src/chunker.py`, update the `Chunk` dataclass:

```python
@dataclass
class Chunk:
    content: str
    index: int
    token_count: int
    metadata: dict = field(default_factory=dict)
    context: str | None = None
```

**Step 4: Run test to verify it passes**

Run: `cd services/ingestion && pytest tests/test_chunker.py::TestChunkText::test_chunk_has_context_field_defaulting_to_none -v`
Expected: PASS

**Step 5: Run full chunker test suite**

Run: `cd services/ingestion && pytest tests/test_chunker.py -v`
Expected: All tests PASS (existing tests unaffected since `context` defaults to `None`)

**Step 6: Commit**

```bash
git add services/ingestion/src/chunker.py services/ingestion/tests/test_chunker.py
git commit -m "feat: add context field to Chunk dataclass"
```

---

### Task 2: Add config settings for contextual chunking

**Files:**
- Modify: `services/ingestion/src/config.py:23-26`

**Step 1: Add settings**

In `services/ingestion/src/config.py`, add after the existing chunking settings (line ~26):

```python
    # Contextual chunking (optional — prepends LLM-generated context to chunks)
    contextual_chunking_enabled: bool = False
    contextual_model: str = "gpt-4o-mini"
    contextual_concurrency: int = 5
```

**Step 2: Verify settings load**

Run: `cd services/ingestion && python -c "from src.config import Settings; s = Settings(_env_file='/dev/null', supabase_url='x', supabase_service_role_key='x', database_url='x', openai_api_key='x'); print(s.contextual_chunking_enabled, s.contextual_model, s.contextual_concurrency)"`
Expected: `False gpt-4o-mini 5`

**Step 3: Commit**

```bash
git add services/ingestion/src/config.py
git commit -m "feat: add contextual chunking config settings"
```

---

### Task 3: Create contextualizer module with tests

**Files:**
- Create: `services/ingestion/src/contextualizer.py`
- Create: `services/ingestion/tests/test_contextualizer.py`

**Step 1: Write the test file**

Create `services/ingestion/tests/test_contextualizer.py`:

```python
import asyncio
import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from src.contextualizer import generate_chunk_context, contextualize_chunks, CONTEXT_PROMPT
from src.chunker import Chunk


class TestGenerateChunkContext:
    async def test_returns_context_string(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="This chunk is from the payment terms section of a residential lease agreement."))
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await generate_chunk_context(
            document_text="Full document text here...",
            chunk_content="The tenant shall pay rent monthly.",
            client=mock_client,
        )

        assert result == "This chunk is from the payment terms section of a residential lease agreement."
        mock_client.chat.completions.create.assert_called_once()

    async def test_sends_correct_prompt_structure(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Some context."))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        await generate_chunk_context(
            document_text="Doc text",
            chunk_content="Chunk text",
            client=mock_client,
        )

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        user_message = call_kwargs["messages"][0]["content"]
        assert "<document>" in user_message
        assert "Doc text" in user_message
        assert "<chunk>" in user_message
        assert "Chunk text" in user_message

    async def test_returns_none_on_failure(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API error"))

        result = await generate_chunk_context(
            document_text="Doc",
            chunk_content="Chunk",
            client=mock_client,
        )

        assert result is None

    async def test_strips_whitespace_from_response(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="  Some context.  \n"))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await generate_chunk_context(
            document_text="Doc",
            chunk_content="Chunk",
            client=mock_client,
        )

        assert result == "Some context."


class TestContextualizeChunks:
    @patch("src.contextualizer.AsyncOpenAI")
    async def test_populates_context_on_all_chunks(self, mock_openai_cls):
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Generated context."))]
        mock_openai_cls.return_value.chat.completions.create = AsyncMock(return_value=mock_response)

        chunks = [
            Chunk(content="Chunk one.", index=0, token_count=3),
            Chunk(content="Chunk two.", index=1, token_count=3),
        ]

        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 5

        result = await contextualize_chunks(chunks, "Full document text.", mock_config)

        assert len(result) == 2
        assert result[0].context == "Generated context."
        assert result[1].context == "Generated context."

    @patch("src.contextualizer.AsyncOpenAI")
    async def test_graceful_degradation_on_partial_failure(self, mock_openai_cls):
        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Rate limit")
            resp = MagicMock()
            resp.choices = [MagicMock(message=MagicMock(content="Context for chunk 2."))]
            return resp

        mock_openai_cls.return_value.chat.completions.create = AsyncMock(side_effect=side_effect)

        chunks = [
            Chunk(content="Chunk one.", index=0, token_count=3),
            Chunk(content="Chunk two.", index=1, token_count=3),
        ]

        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 1  # Sequential to control ordering

        result = await contextualize_chunks(chunks, "Doc text.", mock_config)

        assert result[0].context is None  # Failed gracefully
        assert result[1].context == "Context for chunk 2."  # Succeeded

    @patch("src.contextualizer.AsyncOpenAI")
    async def test_truncates_large_documents(self, mock_openai_cls):
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Context."))]
        mock_openai_cls.return_value.chat.completions.create = AsyncMock(return_value=mock_response)

        # Create a document that exceeds 120K tokens (~480K chars)
        large_doc = "x" * 500_000

        chunks = [Chunk(content="Small chunk.", index=0, token_count=3)]

        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 5

        await contextualize_chunks(chunks, large_doc, mock_config)

        call_kwargs = mock_openai_cls.return_value.chat.completions.create.call_args[1]
        user_message = call_kwargs["messages"][0]["content"]
        # Document should be truncated — the full message should be < 500K chars
        assert len(user_message) < 500_000

    @patch("src.contextualizer.AsyncOpenAI")
    async def test_returns_original_chunks_on_empty_list(self, mock_openai_cls):
        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 5

        result = await contextualize_chunks([], "Doc text.", mock_config)
        assert result == []
        mock_openai_cls.return_value.chat.completions.create.assert_not_called()
```

**Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_contextualizer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.contextualizer'`

**Step 3: Write the implementation**

Create `services/ingestion/src/contextualizer.py`:

```python
import asyncio
import logging

from openai import AsyncOpenAI

from src.chunker import Chunk, estimate_tokens
from src.config import Settings

logger = logging.getLogger(__name__)

MAX_DOCUMENT_TOKENS = 120_000

CONTEXT_PROMPT = """\
<document>
{document_text}
</document>
Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_content}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else."""


def _truncate_document(text: str, max_tokens: int = MAX_DOCUMENT_TOKENS) -> str:
    """Truncate document text to fit within the model's context window."""
    if estimate_tokens(text) <= max_tokens:
        return text
    # ~4 chars per token
    char_limit = max_tokens * 4
    return text[:char_limit]


async def generate_chunk_context(
    document_text: str,
    chunk_content: str,
    client: AsyncOpenAI,
    model: str = "gpt-4o-mini",
) -> str | None:
    """Generate contextual summary for a single chunk using LLM."""
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": CONTEXT_PROMPT.format(
                    document_text=document_text,
                    chunk_content=chunk_content,
                ),
            }],
            max_tokens=200,
        )
        text = (response.choices[0].message.content or "").strip()
        return text if text else None
    except Exception as e:
        logger.warning(f"Context generation failed for chunk: {e}")
        return None


async def contextualize_chunks(
    chunks: list[Chunk],
    document_text: str,
    config: Settings,
) -> list[Chunk]:
    """Generate context for all chunks concurrently. Mutates and returns chunks."""
    if not chunks:
        return chunks

    client = AsyncOpenAI(api_key=config.openai_api_key)
    semaphore = asyncio.Semaphore(config.contextual_concurrency)
    truncated_doc = _truncate_document(document_text)

    async def process_chunk(chunk: Chunk) -> None:
        async with semaphore:
            chunk.context = await generate_chunk_context(
                document_text=truncated_doc,
                chunk_content=chunk.content,
                client=client,
                model=config.contextual_model,
            )

    await asyncio.gather(*[process_chunk(c) for c in chunks])
    return chunks
```

**Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_contextualizer.py -v`
Expected: All tests PASS

**Step 5: Run full test suite**

Run: `cd services/ingestion && pytest -v`
Expected: All tests PASS (48 total now)

**Step 6: Commit**

```bash
git add services/ingestion/src/contextualizer.py services/ingestion/tests/test_contextualizer.py
git commit -m "feat: add contextualizer module for LLM-generated chunk context"
```

---

### Task 4: Integrate contextualizer into worker pipeline

**Files:**
- Modify: `services/ingestion/src/worker.py:1-13` (imports), `services/ingestion/src/worker.py:155-161` (embed step)
- Test: `services/ingestion/tests/test_worker.py`

**Step 1: Write the failing test**

Add to `services/ingestion/tests/test_worker.py`:

```python
class TestProcessMessageWithContextualChunking:
    @patch("src.worker._get_db_connection")
    @patch("src.worker.contextualize_chunks", new_callable=AsyncMock)
    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    async def test_calls_contextualizer_when_enabled(
        self,
        mock_embed,
        mock_parse,
        mock_supabase,
        mock_settings,
        mock_contextualize,
        mock_db_conn,
    ):
        mock_settings.vlm_enabled = False
        mock_settings.contextual_chunking_enabled = True
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "test.pdf",
            "storage_path": "org-456/doc-123/test.pdf",
            "mime_type": "application/pdf",
        }
        supabase.storage.from_.return_value.download.return_value = b"content"
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

        from src.parser import ParseResult, Section
        mock_parse.return_value = ParseResult(
            text="Document text here",
            sections=[Section(content="Section content", headers=["H1"], level=1)],
            page_count=1,
        )

        # Mock contextualizer to add context to chunks
        async def add_context(chunks, doc_text, config):
            for c in chunks:
                c.context = "Generated context."
            return chunks
        mock_contextualize.side_effect = add_context

        from src.embedder import EmbeddingResult
        mock_embed.return_value = EmbeddingResult(embeddings=[[0.1] * 1536], token_count=5)

        message = {"document_id": "doc-123", "organization_id": "org-456"}
        await process_message(message)

        mock_contextualize.assert_called_once()
        # Verify embed was called with context-prepended text
        embed_call_args = mock_embed.call_args[0][0]
        assert embed_call_args[0].startswith("Generated context.")

    @patch("src.worker._get_db_connection")
    @patch("src.worker.contextualize_chunks", new_callable=AsyncMock)
    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    async def test_skips_contextualizer_when_disabled(
        self,
        mock_embed,
        mock_parse,
        mock_supabase,
        mock_settings,
        mock_contextualize,
        mock_db_conn,
    ):
        mock_settings.vlm_enabled = False
        mock_settings.contextual_chunking_enabled = False
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "test.pdf",
            "storage_path": "org-456/doc-123/test.pdf",
            "mime_type": "application/pdf",
        }
        supabase.storage.from_.return_value.download.return_value = b"content"
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

        from src.parser import ParseResult, Section
        mock_parse.return_value = ParseResult(
            text="Document text",
            sections=[Section(content="Content", headers=[], level=0)],
            page_count=1,
        )

        from src.embedder import EmbeddingResult
        mock_embed.return_value = EmbeddingResult(embeddings=[[0.1] * 1536], token_count=5)

        message = {"document_id": "doc-123", "organization_id": "org-456"}
        await process_message(message)

        mock_contextualize.assert_not_called()
```

**Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_worker.py::TestProcessMessageWithContextualChunking -v`
Expected: FAIL (import error or missing mock target)

**Step 3: Modify worker.py**

Add import at top of `services/ingestion/src/worker.py` (after line 12):

```python
from src.contextualizer import contextualize_chunks
```

Add helper function (after `chunk_sections`, before `upsert_chunks`):

```python
def get_embedding_text(chunk: Chunk) -> str:
    """Build the text string used for embedding. Prepends context if available."""
    if chunk.context:
        return f"{chunk.context}\n\n{chunk.content}"
    return chunk.content
```

In `process_message`, after `chunk_sections` call (line ~156) and before `embed_texts` (line ~161), add:

```python
            # Contextual chunking (optional — adds LLM-generated context per chunk)
            if settings.contextual_chunking_enabled:
                chunks = await contextualize_chunks(chunks, parse_result.text, settings)
```

Change the embed call from:

```python
            embedding_result = embed_texts([c.content for c in chunks])
```

to:

```python
            embedding_result = embed_texts([get_embedding_text(c) for c in chunks])
```

**Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_worker.py -v`
Expected: All tests PASS (existing + new)

**Step 5: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_worker.py
git commit -m "feat: integrate contextualizer into ingestion pipeline"
```

---

### Task 5: Add `context` column to upsert

**Files:**
- Modify: `services/ingestion/src/worker.py:83-94` (`upsert_chunks`)
- Test: `services/ingestion/tests/test_worker.py`

**Step 1: Write the failing test**

Add to `services/ingestion/tests/test_worker.py`:

```python
from src.worker import upsert_chunks
from src.chunker import Chunk


class TestUpsertChunksContext:
    @patch("src.worker._get_supabase")
    def test_includes_context_in_upsert_rows(self, mock_supabase):
        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        chunks = [
            Chunk(content="Chunk text.", index=0, token_count=3, context="Some context."),
        ]
        embeddings = [[0.1] * 1536]

        upsert_chunks(chunks, embeddings, "doc-123", "org-456")

        insert_call = supabase.table.return_value.insert.call_args[0][0]
        assert insert_call[0]["context"] == "Some context."

    @patch("src.worker._get_supabase")
    def test_upserts_null_context_when_not_set(self, mock_supabase):
        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        chunks = [
            Chunk(content="Chunk text.", index=0, token_count=3),  # context defaults to None
        ]
        embeddings = [[0.1] * 1536]

        upsert_chunks(chunks, embeddings, "doc-123", "org-456")

        insert_call = supabase.table.return_value.insert.call_args[0][0]
        assert insert_call[0]["context"] is None
```

**Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && pytest tests/test_worker.py::TestUpsertChunksContext -v`
Expected: FAIL — `context` key not in upsert row dict

**Step 3: Update upsert_chunks**

In `services/ingestion/src/worker.py`, update the `rows` list comprehension in `upsert_chunks` to include `context`:

```python
    rows = [
        {
            "document_id": document_id,
            "organization_id": organization_id,
            "content": chunk.content,
            "context": chunk.context,
            "embedding": json.dumps(embeddings[i]),
            "chunk_index": chunk.index,
            "token_count": chunk.token_count,
            "metadata": chunk.metadata,
        }
        for i, chunk in enumerate(chunks)
    ]
```

**Step 4: Run tests to verify they pass**

Run: `cd services/ingestion && pytest tests/test_worker.py -v`
Expected: All tests PASS

**Step 5: Run full Python test suite**

Run: `cd services/ingestion && pytest -v`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_worker.py
git commit -m "feat: include context column in chunk upsert"
```

---

### Task 6: Database migration

**Files:**
- Create: `supabase/migrations/00033_contextual_chunking.sql`

**Step 1: Write the migration**

Create `supabase/migrations/00033_contextual_chunking.sql`:

```sql
-- Add contextual chunking support.
-- New nullable `context` column stores LLM-generated situating context per chunk.
-- Updated `fts` generated column includes context for BM25 search.

-- Add context column (nullable — existing chunks have NULL)
ALTER TABLE public.document_chunks ADD COLUMN context text;

-- Rebuild fts generated column to include context for BM25
ALTER TABLE public.document_chunks DROP COLUMN fts;
ALTER TABLE public.document_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(context, '') || ' ' || content)
  ) STORED;

-- Recreate the GIN index on the new fts column
CREATE INDEX document_chunks_fts_idx
  ON public.document_chunks USING gin(fts);
```

**Step 2: Apply migration to Supabase Cloud**

Use the Supabase MCP tool: `mcp__supabase-mcp-server__apply_migration` with project_id `xjzhiprdbzvmijvymkbn` and the SQL above.

**Step 3: Regenerate TypeScript types**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate && pnpm db:types`

Verify the generated types include the new `context` column on `document_chunks`.

**Step 4: Commit**

```bash
git add supabase/migrations/00033_contextual_chunking.sql types/database.types.ts
git commit -m "feat: migration 00033 — context column + fts update for contextual chunking"
```

---

### Task 7: Update .env.example and documentation

**Files:**
- Modify: `.env.example` (if it exists) or `.env.local.example`
- Modify: `PLAN.md`
- Modify: `docs/plans/2026-02-25-contextual-chunking-design.md` (mark as implemented)

**Step 1: Add env vars to example**

Add to the relevant `.env.example` file (in the Python ingestion section):

```
# Contextual chunking (optional — LLM-generated per-chunk context for better retrieval)
CONTEXTUAL_CHUNKING_ENABLED=false
# CONTEXTUAL_MODEL=gpt-4o-mini
# CONTEXTUAL_CONCURRENCY=5
```

**Step 2: Update PLAN.md**

Update `PLAN.md` to reflect contextual chunking as complete. Add a section similar to the semantic caching block.

**Step 3: Commit**

```bash
git add .env.example PLAN.md docs/plans/2026-02-25-contextual-chunking-design.md
git commit -m "docs: update plan and env examples for contextual chunking"
```

---

### Task 8: Run full test suite and verify build

**Step 1: Run Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests PASS (was 47, now ~53-55)

**Step 2: Run TypeScript tests**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate && pnpm vitest run`
Expected: All 130 tests PASS (no TS changes)

**Step 3: Run build**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate && pnpm build`
Expected: Clean build

**Step 4: If anything fails, fix and commit**

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Add `context` field to Chunk dataclass | `chunker.py`, `test_chunker.py` |
| 2 | Add config settings | `config.py` |
| 3 | Create contextualizer module + tests | `contextualizer.py`, `test_contextualizer.py` |
| 4 | Integrate into worker pipeline | `worker.py`, `test_worker.py` |
| 5 | Add context to upsert | `worker.py`, `test_worker.py` |
| 6 | Database migration | `00033_contextual_chunking.sql`, `database.types.ts` |
| 7 | Docs + env examples | `.env.example`, `PLAN.md` |
| 8 | Full test suite + build | Verification only |
