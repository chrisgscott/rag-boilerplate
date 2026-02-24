# VLM Visual Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional Gemini 2.5 Flash step to the ingestion pipeline that describes visual elements in documents and stores page images for future display.

**Architecture:** Post-parse enrichment with concurrent VLM calls. After Docling parses a document, scan for pages with pictures, send all page images to Gemini concurrently via `asyncio.gather`, append descriptions to matching sections, then proceed with existing chunk/embed/upsert pipeline.

**Tech Stack:** google-genai (Gemini SDK), Pillow (already installed), Supabase Storage (already configured)

**Design doc:** `docs/plans/2026-02-24-vlm-visual-extraction-design.md`

---

### Task 1: Add google-genai dependency and VLM config settings

**Files:**
- Modify: `services/ingestion/pyproject.toml`
- Modify: `services/ingestion/src/config.py`

**Step 1: Add google-genai to dependencies**

In `services/ingestion/pyproject.toml`, add to the `dependencies` list:

```toml
    "google-genai>=1.0.0",
```

**Step 2: Install the dependency**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pip install google-genai`

**Step 3: Add VLM settings to config**

In `services/ingestion/src/config.py`, add after the Chunking section:

```python
    # VLM (optional — enables visual extraction when google_api_key is set)
    google_api_key: str | None = None
    vlm_model: str = "gemini-2.5-flash"
    vlm_concurrency: int = 10
```

**Step 4: Verify existing tests still pass**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All 27 tests pass (the optional `google_api_key` no longer breaks Pydantic validation)

**Step 5: Commit**

```bash
git add services/ingestion/pyproject.toml services/ingestion/src/config.py
git commit -m "feat(ingestion): add google-genai dependency and VLM config settings"
```

---

### Task 2: Add page tracking to Section dataclass

**Files:**
- Modify: `services/ingestion/src/parser.py`
- Test: `services/ingestion/tests/test_parser.py`

**Step 1: Write the failing test**

Add to `tests/test_parser.py`:

```python
class TestPageTracking:
    def test_sections_have_page_numbers(self):
        pdf_path = FIXTURES / "sample.pdf"
        result = parse_document(pdf_path, "application/pdf")
        for section in result.sections:
            assert isinstance(section.pages, set)
            # Every section should have at least one page
            assert len(section.pages) >= 1

    def test_plain_text_sections_have_empty_pages(self):
        txt_path = FIXTURES / "sample.txt"
        result = parse_document(txt_path, "text/plain")
        for section in result.sections:
            assert isinstance(section.pages, set)
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_parser.py::TestPageTracking -v`
Expected: FAIL with `AttributeError: 'Section' object has no attribute 'pages'`

**Step 3: Add pages field to Section and populate it**

In `services/ingestion/src/parser.py`:

Add `pages` field to the `Section` dataclass:

```python
@dataclass
class Section:
    content: str
    headers: list[str] = field(default_factory=list)
    level: int = 0
    pages: set[int] = field(default_factory=set)
    page_image_paths: dict[int, str] = field(default_factory=dict)
```

Update `_extract_sections()` to track page numbers. Add a `current_pages` set alongside `current_content`, and extract page numbers from each item's `prov`:

```python
def _extract_sections(doc) -> list[Section]:
    """Walk Docling's document tree and extract sections with header breadcrumbs."""
    sections: list[Section] = []
    header_stack: list[str] = []
    current_content: list[str] = []
    current_pages: set[int] = set()
    current_level = 0

    for item, level in doc.iterate_items():
        label = getattr(item, "label", None)
        text = ""

        # Track page number from provenance
        prov = getattr(item, "prov", None)
        if prov and len(prov) > 0:
            page_no = getattr(prov[0], "page_no", None)
            if page_no is not None:
                current_pages.add(page_no)

        # Handle tables specially
        if label == DocItemLabel.TABLE:
            table_md = item.export_to_markdown() if hasattr(item, "export_to_markdown") else ""
            if table_md:
                current_content.append(table_md)
            continue

        text = getattr(item, "text", "").strip()
        if not text:
            continue

        if label == DocItemLabel.SECTION_HEADER:
            # Flush current section
            _flush_section(sections, current_content, header_stack, current_level, current_pages)
            current_content = []
            current_pages = set()

            # Update header stack
            h_level = getattr(item, "level", 1)
            header_stack = header_stack[: h_level - 1]
            while len(header_stack) < h_level:
                header_stack.append("")
            header_stack[h_level - 1] = text
            current_level = h_level

        elif label == DocItemLabel.TITLE:
            _flush_section(sections, current_content, header_stack, current_level, current_pages)
            current_content = []
            current_pages = set()
            header_stack = [text]
            current_level = 1

        else:
            current_content.append(text)

    # Flush final section
    _flush_section(sections, current_content, header_stack, current_level, current_pages)

    # If no sections found, return entire text as one section
    if not sections:
        full_text = doc.export_to_markdown()
        if full_text.strip():
            sections.append(Section(content=full_text.strip(), headers=[], level=0))

    return sections
```

Update `_flush_section()` to accept and pass through pages:

```python
def _flush_section(
    sections: list[Section],
    content_lines: list[str],
    headers: list[str],
    level: int,
    pages: set[int] | None = None,
):
    content = "\n\n".join(line for line in content_lines if line.strip())
    if content:
        clean_headers = [h for h in headers if h]
        sections.append(Section(
            content=content,
            headers=list(clean_headers),
            level=level,
            pages=pages or set(),
        ))
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_parser.py -v`
Expected: All parser tests pass including new TestPageTracking tests

**Step 5: Commit**

```bash
git add services/ingestion/src/parser.py services/ingestion/tests/test_parser.py
git commit -m "feat(parser): track page numbers per section for VLM enrichment"
```

---

### Task 3: Add metadata field to Chunk and propagate through worker

**Files:**
- Modify: `services/ingestion/src/chunker.py`
- Modify: `services/ingestion/src/worker.py`
- Test: `services/ingestion/tests/test_chunker.py`

**Step 1: Write the failing test**

Add to `tests/test_chunker.py`:

```python
    def test_chunk_has_metadata_field(self):
        chunks = chunk_text("Hello world", ChunkOptions(max_tokens=100, overlap=0.0))
        assert hasattr(chunks[0], "metadata")
        assert isinstance(chunks[0].metadata, dict)
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_chunker.py::TestChunkText::test_chunk_has_metadata_field -v`
Expected: FAIL

**Step 3: Add metadata field to Chunk**

In `services/ingestion/src/chunker.py`, update the Chunk dataclass. The import needs `field` from dataclasses:

```python
from dataclasses import dataclass, field


@dataclass
class Chunk:
    content: str
    index: int
    token_count: int
    metadata: dict = field(default_factory=dict)
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_chunker.py -v`
Expected: All chunker tests pass

**Step 5: Update chunk_sections to populate metadata**

In `services/ingestion/src/worker.py`, update `chunk_sections()`:

```python
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
        # Propagate section-level metadata to chunks
        section_metadata: dict = {"document_name": doc_name}
        if hasattr(section, "page_image_paths") and section.page_image_paths:
            # Store all page image paths from this section
            section_metadata["page_image_paths"] = section.page_image_paths
        for chunk in section_chunks:
            chunk.metadata = section_metadata

        all_chunks.extend(section_chunks)

    # Re-index sequentially across all sections
    for i, chunk in enumerate(all_chunks):
        chunk.index = i

    return all_chunks
```

**Step 6: Update upsert_chunks to use chunk.metadata**

In `services/ingestion/src/worker.py`, update `upsert_chunks()`:

```python
def upsert_chunks(
    chunks: list[Chunk],
    embeddings: list[list[float]],
    document_id: str,
    organization_id: str,
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
            "metadata": chunk.metadata,
        }
        for i, chunk in enumerate(chunks)
    ]

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        supabase.table("document_chunks").insert(batch).execute()
```

**Step 7: Update process_message call to upsert_chunks (remove doc_name param)**

In `services/ingestion/src/worker.py`, update the `upsert_chunks` call in `process_message()`:

```python
            # Upsert to database
            upsert_chunks(
                chunks,
                embedding_result.embeddings,
                document_id,
                organization_id,
            )
```

**Step 8: Run all tests**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests pass

**Step 9: Commit**

```bash
git add services/ingestion/src/chunker.py services/ingestion/src/worker.py services/ingestion/tests/test_chunker.py
git commit -m "feat(chunker): add metadata field to Chunk, propagate through worker"
```

---

### Task 4: VLM module — get_visual_pages and describe_visual_pages

**Files:**
- Create: `services/ingestion/src/vlm.py`
- Create: `services/ingestion/tests/test_vlm.py`

**Step 1: Write the failing tests**

Create `services/ingestion/tests/test_vlm.py`:

```python
import asyncio
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from PIL import Image

from src.vlm import get_visual_pages, describe_visual_pages, VLM_PROMPT


class TestGetVisualPages:
    def test_returns_empty_for_no_pictures(self):
        doc = MagicMock()
        doc.pictures = []
        result = get_visual_pages(doc)
        assert result == {}

    def test_extracts_page_images_from_pictures(self):
        doc = MagicMock()

        # Create a mock picture on page 3
        pic = MagicMock()
        prov_item = MagicMock()
        prov_item.page_no = 3
        pic.prov = [prov_item]
        doc.pictures = [pic]

        # Mock the page image
        page = MagicMock()
        pil_img = Image.new("RGB", (100, 100), "white")
        page.image.pil_image = pil_img
        doc.pages = {3: page}

        result = get_visual_pages(doc)
        assert 3 in result
        assert result[3] == pil_img

    def test_deduplicates_by_page(self):
        doc = MagicMock()

        # Two pictures on the same page
        pic1 = MagicMock()
        pic1.prov = [MagicMock(page_no=2)]
        pic2 = MagicMock()
        pic2.prov = [MagicMock(page_no=2)]
        doc.pictures = [pic1, pic2]

        page = MagicMock()
        page.image.pil_image = Image.new("RGB", (100, 100))
        doc.pages = {2: page}

        result = get_visual_pages(doc)
        assert len(result) == 1

    def test_skips_pages_without_images(self):
        doc = MagicMock()
        pic = MagicMock()
        pic.prov = [MagicMock(page_no=5)]
        doc.pictures = [pic]
        doc.pages = {5: MagicMock(image=None)}

        result = get_visual_pages(doc)
        assert result == {}


class TestDescribeVisualPages:
    @pytest.fixture
    def mock_genai(self):
        with patch("src.vlm.genai") as mock:
            yield mock

    def test_returns_descriptions_keyed_by_page(self, mock_genai):
        mock_response = MagicMock()
        mock_response.text = "A bar chart showing quarterly revenue growth."

        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        pages = {
            3: Image.new("RGB", (100, 100)),
            7: Image.new("RGB", (100, 100)),
        }

        result = asyncio.get_event_loop().run_until_complete(
            describe_visual_pages(pages)
        )
        assert 3 in result
        assert 7 in result
        assert "bar chart" in result[3]

    def test_filters_no_visual_content_responses(self, mock_genai):
        mock_response = MagicMock()
        mock_response.text = "NO_VISUAL_CONTENT"

        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        pages = {1: Image.new("RGB", (100, 100))}
        result = asyncio.get_event_loop().run_until_complete(
            describe_visual_pages(pages)
        )
        assert result == {}

    def test_skips_failed_pages(self, mock_genai):
        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Rate limit")
            resp = MagicMock()
            resp.text = "A diagram showing workflow."
            return resp

        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            side_effect=side_effect
        )

        pages = {
            1: Image.new("RGB", (100, 100)),
            2: Image.new("RGB", (100, 100)),
        }
        result = asyncio.get_event_loop().run_until_complete(
            describe_visual_pages(pages)
        )
        # Page 1 failed, page 2 succeeded
        assert len(result) == 1
        assert 2 in result

    def test_uses_correct_prompt(self, mock_genai):
        mock_response = MagicMock()
        mock_response.text = "Some description"

        mock_genai.Client.return_value.aio.models.generate_content = AsyncMock(
            return_value=mock_response
        )

        pages = {1: Image.new("RGB", (100, 100))}
        asyncio.get_event_loop().run_until_complete(describe_visual_pages(pages))

        call_args = mock_genai.Client.return_value.aio.models.generate_content.call_args
        assert VLM_PROMPT in str(call_args)
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_vlm.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.vlm'`

**Step 3: Create the VLM module**

Create `services/ingestion/src/vlm.py`:

```python
import asyncio
import io
import logging

from PIL import Image
from google import genai

from src.config import settings

logger = logging.getLogger(__name__)

VLM_PROMPT = """You are analyzing a page from a document. Describe ALL visual elements \
(charts, diagrams, images, figures) on this page in detail.

Focus on:
- Data values, trends, and relationships shown in charts/graphs
- Labels, legends, axis titles, and annotations
- Structural relationships in diagrams or flowcharts
- Key takeaways a reader would extract from the visual

Write in plain prose suitable for text search. Do not describe decorative \
elements, page layout, or formatting. If there are no meaningful visual \
elements, respond with "NO_VISUAL_CONTENT"."""

NO_VISUAL_SENTINEL = "NO_VISUAL_CONTENT"


def get_visual_pages(doc) -> dict[int, Image.Image]:
    """Scan a Docling document for pages containing pictures. Returns {page_no: PIL.Image}."""
    if not hasattr(doc, "pictures") or not doc.pictures:
        return {}

    page_numbers: set[int] = set()
    for pic in doc.pictures:
        prov = getattr(pic, "prov", None)
        if prov and len(prov) > 0:
            page_no = getattr(prov[0], "page_no", None)
            if page_no is not None:
                page_numbers.add(page_no)

    pages: dict[int, Image.Image] = {}
    for page_no in sorted(page_numbers):
        page = doc.pages.get(page_no)
        if page and page.image and page.image.pil_image:
            pages[page_no] = page.image.pil_image

    return pages


async def describe_visual_pages(
    pages: dict[int, Image.Image],
    model: str | None = None,
    concurrency: int | None = None,
) -> dict[int, str]:
    """Send page images to Gemini concurrently. Returns {page_no: description}."""
    model = model or settings.vlm_model
    max_concurrent = concurrency or settings.vlm_concurrency
    semaphore = asyncio.Semaphore(max_concurrent)

    client = genai.Client(api_key=settings.google_api_key)

    async def describe_page(page_no: int, image: Image.Image) -> tuple[int, str | None]:
        async with semaphore:
            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=[VLM_PROMPT, image],
                )
                text = response.text.strip()
                if NO_VISUAL_SENTINEL in text:
                    logger.info(f"Page {page_no}: no meaningful visual content")
                    return page_no, None
                return page_no, text
            except Exception as e:
                logger.warning(f"VLM failed for page {page_no}: {e}")
                return page_no, None

    tasks = [describe_page(page_no, img) for page_no, img in pages.items()]
    results = await asyncio.gather(*tasks)

    return {page_no: desc for page_no, desc in results if desc is not None}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_vlm.py -v`
Expected: All VLM tests pass

**Step 5: Commit**

```bash
git add services/ingestion/src/vlm.py services/ingestion/tests/test_vlm.py
git commit -m "feat(vlm): add get_visual_pages and describe_visual_pages with Gemini client"
```

---

### Task 5: VLM module — upload_page_images

**Files:**
- Modify: `services/ingestion/src/vlm.py`
- Modify: `services/ingestion/tests/test_vlm.py`

**Step 1: Write the failing test**

Add to `tests/test_vlm.py`:

```python
from src.vlm import upload_page_images


class TestUploadPageImages:
    def test_uploads_images_as_webp(self):
        mock_supabase = MagicMock()
        mock_supabase.storage.from_.return_value.upload.return_value = None

        pages = {3: Image.new("RGB", (100, 100))}
        result = upload_page_images(pages, "doc-123", mock_supabase)

        assert "page-images/doc-123/page-3.webp" in result.values()
        mock_supabase.storage.from_.assert_called_with("documents")
        call_args = mock_supabase.storage.from_.return_value.upload.call_args
        assert call_args[0][0] == "page-images/doc-123/page-3.webp"

    def test_returns_paths_keyed_by_page(self):
        mock_supabase = MagicMock()
        mock_supabase.storage.from_.return_value.upload.return_value = None

        pages = {
            1: Image.new("RGB", (100, 100)),
            5: Image.new("RGB", (100, 100)),
        }
        result = upload_page_images(pages, "doc-456", mock_supabase)
        assert result[1] == "page-images/doc-456/page-1.webp"
        assert result[5] == "page-images/doc-456/page-5.webp"

    def test_skips_failed_uploads(self):
        mock_supabase = MagicMock()
        mock_supabase.storage.from_.return_value.upload.side_effect = Exception("Upload failed")

        pages = {3: Image.new("RGB", (100, 100))}
        result = upload_page_images(pages, "doc-789", mock_supabase)
        assert result == {}
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_vlm.py::TestUploadPageImages -v`
Expected: FAIL with `ImportError`

**Step 3: Implement upload_page_images**

Add to `services/ingestion/src/vlm.py`:

```python
def upload_page_images(
    pages: dict[int, Image.Image],
    document_id: str,
    supabase,
) -> dict[int, str]:
    """Upload page images to Supabase Storage as WebP. Returns {page_no: storage_path}."""
    paths: dict[int, str] = {}

    for page_no, image in pages.items():
        storage_path = f"page-images/{document_id}/page-{page_no}.webp"
        try:
            buf = io.BytesIO()
            image.save(buf, format="WEBP", quality=80)
            buf.seek(0)
            supabase.storage.from_("documents").upload(
                storage_path, buf.getvalue(), {"content-type": "image/webp"}
            )
            paths[page_no] = storage_path
            logger.info(f"Uploaded page image: {storage_path}")
        except Exception as e:
            logger.warning(f"Failed to upload page {page_no} image: {e}")

    return paths
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_vlm.py -v`
Expected: All VLM tests pass

**Step 5: Commit**

```bash
git add services/ingestion/src/vlm.py services/ingestion/tests/test_vlm.py
git commit -m "feat(vlm): add upload_page_images to store page images in Supabase Storage"
```

---

### Task 6: VLM module — enrich_sections

**Files:**
- Modify: `services/ingestion/src/vlm.py`
- Modify: `services/ingestion/tests/test_vlm.py`

**Step 1: Write the failing tests**

Add to `tests/test_vlm.py`:

```python
from src.parser import Section
from src.vlm import enrich_sections


class TestEnrichSections:
    def test_appends_description_to_matching_section(self):
        sections = [
            Section(content="Text about revenue.", headers=["Financials"], pages={2, 3}),
        ]
        descriptions = {3: "A bar chart showing Q4 revenue growth of 15%."}
        page_images = {3: "page-images/doc-1/page-3.webp"}

        enrich_sections(sections, descriptions, page_images)

        assert "bar chart" in sections[0].content
        assert "[Visual content — page 3]" in sections[0].content
        assert sections[0].page_image_paths[3] == "page-images/doc-1/page-3.webp"

    def test_creates_new_section_for_orphan_page(self):
        sections = [
            Section(content="Some text.", headers=["Intro"], pages={1}),
        ]
        descriptions = {5: "A flowchart showing the approval process."}
        page_images = {5: "page-images/doc-1/page-5.webp"}

        enrich_sections(sections, descriptions, page_images)

        # Should have created a new section
        assert len(sections) == 2
        assert "flowchart" in sections[1].content
        assert sections[1].headers == ["Visual Content — Page 5"]
        assert 5 in sections[1].pages

    def test_handles_multiple_descriptions_across_sections(self):
        sections = [
            Section(content="First section.", headers=["A"], pages={1, 2}),
            Section(content="Second section.", headers=["B"], pages={3, 4}),
        ]
        descriptions = {
            2: "Chart on page 2.",
            4: "Diagram on page 4.",
        }
        page_images = {}

        enrich_sections(sections, descriptions, page_images)

        assert "Chart on page 2" in sections[0].content
        assert "Diagram on page 4" in sections[1].content

    def test_no_op_when_no_descriptions(self):
        sections = [Section(content="Original.", headers=[], pages={1})]
        enrich_sections(sections, {}, {})
        assert sections[0].content == "Original."
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_vlm.py::TestEnrichSections -v`
Expected: FAIL with `ImportError`

**Step 3: Implement enrich_sections**

Add to `services/ingestion/src/vlm.py`:

```python
from src.parser import Section


def enrich_sections(
    sections: list[Section],
    descriptions: dict[int, str],
    page_images: dict[int, str],
) -> None:
    """Append VLM descriptions to matching sections. Mutates sections in place."""
    if not descriptions:
        return

    for page_no, description in descriptions.items():
        # Find the section that contains this page
        matched = False
        for section in sections:
            if page_no in section.pages:
                section.content += f"\n\n[Visual content — page {page_no}]: {description}"
                if page_no in page_images:
                    section.page_image_paths[page_no] = page_images[page_no]
                matched = True
                break

        if not matched:
            # Create a new section for orphan visual pages
            new_section = Section(
                content=f"[Visual content — page {page_no}]: {description}",
                headers=[f"Visual Content — Page {page_no}"],
                level=1,
                pages={page_no},
                page_image_paths={page_no: page_images[page_no]} if page_no in page_images else {},
            )
            sections.append(new_section)
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_vlm.py -v`
Expected: All VLM tests pass

**Step 5: Commit**

```bash
git add services/ingestion/src/vlm.py services/ingestion/tests/test_vlm.py
git commit -m "feat(vlm): add enrich_sections to append visual descriptions to sections"
```

---

### Task 7: Wire VLM into the worker pipeline

**Files:**
- Modify: `services/ingestion/src/worker.py`
- Modify: `services/ingestion/tests/test_worker.py`

**Step 1: Write the failing test**

Add to `tests/test_worker.py`:

```python
class TestProcessMessageWithVLM:
    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    @patch("src.worker.get_visual_pages")
    @patch("src.worker.describe_visual_pages", new_callable=AsyncMock)
    @patch("src.worker.upload_page_images")
    @patch("src.worker.enrich_sections")
    async def test_runs_vlm_when_api_key_set(
        self,
        mock_enrich,
        mock_upload,
        mock_describe,
        mock_visual_pages,
        mock_embed,
        mock_parse,
        mock_supabase,
        mock_settings,
    ):
        # Config
        mock_settings.google_api_key = "test-key"
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        # Mock Supabase
        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "slides.pdf",
            "storage_path": "org-1/doc-123/slides.pdf",
            "mime_type": "application/pdf",
        }
        supabase.storage.from_.return_value.download.return_value = b"pdf content"
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

        # Mock parser — returns a ParseResult and the raw doc object
        from src.parser import ParseResult, Section
        mock_parse.return_value = ParseResult(
            text="Some text",
            sections=[Section(content="Content here", headers=["H1"], level=1, pages={1})],
            page_count=3,
        )

        # Mock VLM
        from PIL import Image
        mock_visual_pages.return_value = {2: Image.new("RGB", (100, 100))}
        mock_describe.return_value = {2: "A chart showing data."}
        mock_upload.return_value = {2: "page-images/doc-123/page-2.webp"}

        # Mock embedder
        from src.embedder import EmbeddingResult
        mock_embed.return_value = EmbeddingResult(embeddings=[[0.1] * 1536], token_count=5)

        message = {"document_id": "doc-123", "organization_id": "org-1"}
        await process_message(message)

        mock_visual_pages.assert_called_once()
        mock_describe.assert_called_once()
        mock_upload.assert_called_once()
        mock_enrich.assert_called_once()

    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    @patch("src.worker.get_visual_pages")
    async def test_skips_vlm_when_no_api_key(
        self,
        mock_visual_pages,
        mock_embed,
        mock_parse,
        mock_supabase,
        mock_settings,
    ):
        mock_settings.google_api_key = None
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "test.pdf",
            "storage_path": "org-1/doc-123/test.pdf",
            "mime_type": "application/pdf",
        }
        supabase.storage.from_.return_value.download.return_value = b"content"
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

        from src.parser import ParseResult, Section
        mock_parse.return_value = ParseResult(
            text="Text",
            sections=[Section(content="Content", headers=[], level=0, pages={1})],
            page_count=1,
        )

        from src.embedder import EmbeddingResult
        mock_embed.return_value = EmbeddingResult(embeddings=[[0.1] * 1536], token_count=5)

        message = {"document_id": "doc-123", "organization_id": "org-1"}
        await process_message(message)

        mock_visual_pages.assert_not_called()
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest tests/test_worker.py::TestProcessMessageWithVLM -v`
Expected: FAIL (process_message is not async, VLM functions not imported)

**Step 3: Update process_message to be async and integrate VLM**

In `services/ingestion/src/worker.py`, update the imports at the top:

```python
from src.vlm import get_visual_pages, describe_visual_pages, upload_page_images, enrich_sections
```

Change `process_message` to `async def` and add the VLM step between parse and chunk:

```python
async def process_message(message: dict) -> None:
    """Process a single ingestion job message."""
    document_id = message["document_id"]
    organization_id = message["organization_id"]

    # Set status to processing
    update_document_status(document_id, "processing")

    try:
        # Fetch document record (using service role key — bypasses RLS)
        supabase = _get_supabase()
        doc_response = (
            supabase.table("documents").select("*").eq("id", document_id).single().execute()
        )
        doc = doc_response.data

        # Download file from storage
        file_bytes = supabase.storage.from_("documents").download(doc["storage_path"])

        # Write to temp file for Docling
        suffix = Path(doc["name"]).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        try:
            # Parse with Docling
            parse_result = parse_document(tmp_path, doc["mime_type"])

            # VLM visual extraction (optional — runs when GOOGLE_API_KEY is set)
            if settings.google_api_key:
                # We need the raw Docling document for picture extraction.
                # Re-parse to get the doc object (parse_document returns ParseResult).
                # To avoid double-parsing, we refactor to also return the doc.
                from src.parser import get_converter
                converter = get_converter()
                docling_result = converter.convert(str(tmp_path))
                docling_doc = docling_result.document

                visual_pages = get_visual_pages(docling_doc)
                if visual_pages:
                    descriptions = await describe_visual_pages(visual_pages)
                    page_images = upload_page_images(visual_pages, document_id, supabase)
                    enrich_sections(parse_result.sections, descriptions, page_images)
                    logger.info(
                        f"VLM enriched {len(descriptions)} pages for document {document_id}"
                    )

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
            )

            # Success
            update_document_status(
                document_id,
                "complete",
                error_message=None,
                chunk_count=len(chunks),
                parsed_content=parse_result.text,
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
```

**Step 4: Update process_next_job to await process_message**

In `process_next_job`, change line 210 from:

```python
                process_message(message)
```

to:

```python
                await process_message(message)
```

**Step 5: Update existing worker tests for async**

In `tests/test_worker.py`, the existing `TestProcessMessage` tests need to become async since `process_message` is now `async def`. Update the class:

- Change all `def test_` to `async def test_`
- Change `process_message(message)` to `await process_message(message)`
- Add `from unittest.mock import AsyncMock` to imports

**Step 6: Run all tests**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests pass (existing + new VLM tests)

**Step 7: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_worker.py
git commit -m "feat(worker): integrate VLM visual extraction into ingestion pipeline"
```

---

### Task 8: Avoid double-parsing — return Docling doc from parse_document

**Files:**
- Modify: `services/ingestion/src/parser.py`
- Modify: `services/ingestion/src/worker.py`
- Test: `services/ingestion/tests/test_parser.py`

**Context:** Task 7 introduces a double-parse to get the Docling doc object for picture extraction. This is wasteful. Instead, return the raw Docling doc from `parse_document` alongside the ParseResult.

**Step 1: Update ParseResult to hold the raw doc**

In `services/ingestion/src/parser.py`, update the `ParseResult` dataclass:

```python
@dataclass
class ParseResult:
    text: str
    sections: list[Section]
    page_count: int = 1
    docling_doc: object = None  # Raw Docling document for VLM extraction
```

**Step 2: Store doc in parse_document return**

In `parse_document()`, change the return to include the doc:

```python
    return ParseResult(text=text, sections=sections, page_count=page_count, docling_doc=doc)
```

**Step 3: Update worker to use parse_result.docling_doc**

In `services/ingestion/src/worker.py`, replace the double-parse block with:

```python
            # VLM visual extraction (optional — runs when GOOGLE_API_KEY is set)
            if settings.google_api_key and parse_result.docling_doc:
                visual_pages = get_visual_pages(parse_result.docling_doc)
                if visual_pages:
                    descriptions = await describe_visual_pages(visual_pages)
                    page_images = upload_page_images(visual_pages, document_id, supabase)
                    enrich_sections(parse_result.sections, descriptions, page_images)
                    logger.info(
                        f"VLM enriched {len(descriptions)} pages for document {document_id}"
                    )
```

Remove the `from src.parser import get_converter` import that was added in Task 7.

**Step 4: Run all tests**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add services/ingestion/src/parser.py services/ingestion/src/worker.py
git commit -m "refactor(parser): return docling_doc in ParseResult to avoid double-parsing"
```

---

### Task 9: Final verification — all tests green + manual smoke test

**Step 1: Run the full test suite**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate/services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests pass (27 existing + new VLM tests)

**Step 2: Run TypeScript tests to verify nothing broke**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate && pnpm vitest run`
Expected: 70 tests pass

**Step 3: Build check**

Run: `cd /Users/chrisgscott/projects/RAG-boilerplate && pnpm build`
Expected: Build succeeds

**Step 4: Update PLAN.md**

Update the "Recent Changes" and "Next Steps" sections to reflect VLM implementation.

**Step 5: Final commit**

```bash
git add PLAN.md
git commit -m "docs: update PLAN.md with VLM implementation status"
```
