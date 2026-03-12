# Semantic Chunking Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recursive text chunker with Docling's structure-aware HierarchicalChunker so tables, paragraphs, and lists stay intact as natural retrieval units.

**Architecture:** Extract semantic units via Docling's HierarchicalChunker, right-size them (merge small, split large at structure boundaries), then write into the existing `document_chunks` table with two new metadata columns (`label`, `headings`). All downstream consumers (search, chat, eval, optimizer, cache, API) remain unchanged.

**Tech Stack:** Python 3.12, Docling, PostgreSQL/pgvector, Supabase migrations, pytest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/ingestion/src/right_sizer.py` | Create | Merge small units, split large units at structure boundaries |
| `services/ingestion/tests/test_right_sizer.py` | Create | Unit tests for right-sizing logic |
| `services/ingestion/src/config.py` | Modify | Add `min_unit_tokens`, `max_unit_tokens`; rename `extract_semantic_units` → `populate_semantic_units_table` |
| `services/ingestion/src/worker.py` | Modify | Replace `chunk_sections()` with semantic units + right-sizer pipeline; update `upsert_chunks()` to write `label`/`headings` |
| `services/ingestion/tests/test_worker.py` | Modify | Update pipeline tests for new chunking path |
| `services/ingestion/src/semantic_units.py` | No change | Already extracts units correctly |
| `services/ingestion/src/chunker.py` | No change | `estimate_tokens()` and `_split_segment()` reused by right-sizer via import |
| `supabase/migrations/00038_semantic_chunking.sql` | Create | Add `label`, `headings` columns; rebuild `fts` generated column |

---

## Chunk 1: Right-Sizer Module + Migration

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00038_semantic_chunking.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add semantic chunking metadata columns
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS headings text[];

-- Rebuild fts generated column to include headings for BM25
ALTER TABLE public.document_chunks DROP COLUMN fts;
ALTER TABLE public.document_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(array_to_string(headings, ' '), '') || ' ' ||
      coalesce(context, '') || ' ' ||
      content
    )
  ) STORED;

-- Recreate GIN index
CREATE INDEX document_chunks_fts_idx ON public.document_chunks USING gin(fts);
```

- [ ] **Step 2: Apply migration to Supabase Cloud**

Run via Supabase MCP tool: `mcp__supabase-mcp-server__apply_migration` with project_id `xjzhiprdbzvmijvymkbn` and the SQL above.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `supabase gen types typescript --local > types/database.types.ts`

Verify `label` and `headings` appear in the `document_chunks` Row type.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00038_semantic_chunking.sql types/database.types.ts
git commit -m "feat: add label and headings columns to document_chunks (migration 00038)"
```

---

### Task 2: Config Updates

**Files:**
- Modify: `services/ingestion/src/config.py`

- [ ] **Step 1: Update config.py**

Add two new fields and rename the semantic units flag:

```python
# In the Settings class, add these fields:
min_unit_tokens: int = 100
max_unit_tokens: int = 500

# Rename existing field:
# extract_semantic_units: bool = False
# becomes:
populate_semantic_units_table: bool = False
```

The full `Settings` class should have these fields (preserving all existing ones):
- `chunk_max_tokens` (kept for backward compat, no longer used in main path)
- `chunk_overlap` (kept for backward compat, no longer used in main path)
- `min_unit_tokens: int = 100`
- `max_unit_tokens: int = 500`
- `populate_semantic_units_table: bool = False` (renamed from `extract_semantic_units`)
- All other existing fields unchanged

- [ ] **Step 2: Update worker.py references**

Search for `settings.extract_semantic_units` in `worker.py` and replace with `settings.populate_semantic_units_table`. This is at line 198 in the current worker.

- [ ] **Step 3: Update test_worker.py references**

Search for `extract_semantic_units` in test files and replace with `populate_semantic_units_table`.

- [ ] **Step 4: Run existing tests to verify nothing breaks**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All 81 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/config.py services/ingestion/src/worker.py services/ingestion/tests/
git commit -m "refactor: rename extract_semantic_units to populate_semantic_units_table, add right-sizer config"
```

---

### Task 3: Right-Sizer — Merge Small Units

**Files:**
- Create: `services/ingestion/src/right_sizer.py`
- Create: `services/ingestion/tests/test_right_sizer.py`

- [ ] **Step 1: Write failing tests for merge logic**

Create `services/ingestion/tests/test_right_sizer.py`:

```python
"""Tests for right_sizer module — merge and split semantic units for optimal embedding size."""

import pytest
from src.semantic_units import SemanticUnit
from src.right_sizer import right_size_units, RightSizeOptions
from src.chunker import Chunk


def _unit(content: str, headings: list[str] | None = None, label: str = "paragraph",
          page_numbers: list[int] | None = None, unit_index: int = 0) -> SemanticUnit:
    """Helper to create a SemanticUnit with defaults."""
    return SemanticUnit(
        content=content,
        headings=headings or [],
        label=label,
        page_numbers=page_numbers or [1],
        unit_index=unit_index,
        docling_ref="",
    )


class TestMergeSmallUnits:
    """Merging adjacent small units with same heading context."""

    def test_single_unit_below_min_passes_through(self):
        """A single tiny unit can't be merged with anything — keep as-is."""
        units = [_unit("Short text.", headings=["H1"])]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 1
        assert result[0].content == "Short text."

    def test_adjacent_small_units_same_heading_merged(self):
        """Two small paragraphs under the same heading get merged."""
        units = [
            _unit("First paragraph.", headings=["Chapter 1"], unit_index=0),
            _unit("Second paragraph.", headings=["Chapter 1"], unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 1
        assert "First paragraph." in result[0].content
        assert "Second paragraph." in result[0].content

    def test_merged_unit_has_label_mixed_when_different_labels(self):
        """Merging paragraph + list_item produces label 'mixed'."""
        units = [
            _unit("A paragraph.", headings=["H1"], label="paragraph", unit_index=0),
            _unit("A list item.", headings=["H1"], label="list_item", unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 1
        assert result[0].metadata.get("label") == "mixed"

    def test_merged_unit_keeps_label_when_same(self):
        """Merging two paragraphs keeps label 'paragraph'."""
        units = [
            _unit("Para one.", headings=["H1"], label="paragraph", unit_index=0),
            _unit("Para two.", headings=["H1"], label="paragraph", unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 1
        assert result[0].metadata.get("label") == "paragraph"

    def test_different_headings_not_merged(self):
        """Units under different headings stay separate even if small."""
        units = [
            _unit("Under heading A.", headings=["A"], unit_index=0),
            _unit("Under heading B.", headings=["B"], unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 2

    def test_merge_stops_at_max_tokens(self):
        """Merging stops when combined size would exceed max_tokens."""
        # Each unit ~50 tokens (200 chars / 4)
        text = "x " * 100  # ~200 chars = ~50 tokens
        units = [
            _unit(text, headings=["H1"], unit_index=0),
            _unit(text, headings=["H1"], unit_index=1),
            _unit(text, headings=["H1"], unit_index=2),
        ]
        # max_tokens=120 means two units merge (~100 tokens) but adding third (~150) exceeds limit
        result = right_size_units(units, RightSizeOptions(min_tokens=30, max_tokens=120))
        assert len(result) == 2  # First two merged, third stays separate

    def test_page_numbers_unioned_on_merge(self):
        """Merged units combine their page numbers."""
        units = [
            _unit("First.", headings=["H1"], page_numbers=[1, 2], unit_index=0),
            _unit("Second.", headings=["H1"], page_numbers=[2, 3], unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 1
        pages = result[0].metadata.get("page_numbers", [])
        assert set(pages) == {1, 2, 3}

    def test_table_not_merged_with_paragraph(self):
        """Tables are never merged with paragraphs — different structural roles."""
        units = [
            _unit("A paragraph.", headings=["H1"], label="paragraph", unit_index=0),
            _unit("| col1 | col2 |\n|---|---|\n| a | b |", headings=["H1"], label="table", unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_right_sizer.py -v`
Expected: ImportError — `right_sizer` module doesn't exist yet.

- [ ] **Step 3: Implement right_sizer.py — merge logic**

Create `services/ingestion/src/right_sizer.py`:

```python
"""Right-size semantic units for optimal embedding quality.

Merges small adjacent units (same heading context, compatible labels) and splits
oversized units at structure boundaries (table rows, sentence breaks).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import ceil

from src.chunker import Chunk, estimate_tokens
from src.semantic_units import SemanticUnit


@dataclass
class RightSizeOptions:
    """Configuration for right-sizing semantic units."""
    min_tokens: int = 100
    max_tokens: int = 500


# Labels that can be merged together
_MERGEABLE_LABELS = {"paragraph", "list_item"}


def _can_merge(a: SemanticUnit, b: SemanticUnit) -> bool:
    """Check if two units can be merged (same headings, compatible labels)."""
    if a.headings != b.headings:
        return False
    # Tables are never merged with non-tables
    if a.label == "table" or b.label == "table":
        return False
    # Only merge paragraph-like content
    if a.label not in _MERGEABLE_LABELS or b.label not in _MERGEABLE_LABELS:
        return False
    return True


def _merge_label(labels: set[str]) -> str:
    """Determine label for a merged unit."""
    if len(labels) == 1:
        return next(iter(labels))
    return "mixed"


def _merge_pages(page_lists: list[list[int]]) -> list[int]:
    """Union page numbers from multiple units, sorted."""
    pages: set[int] = set()
    for pl in page_lists:
        pages.update(pl)
    return sorted(pages)


def _to_chunk(content: str, index: int, label: str, headings: list[str],
              page_numbers: list[int]) -> Chunk:
    """Convert right-sized unit data into a Chunk for downstream pipeline."""
    return Chunk(
        content=content,
        index=index,
        token_count=estimate_tokens(content),
        metadata={
            "label": label,
            "headings": headings,
            "page_numbers": page_numbers,
        },
        context=None,
    )


def _merge_pass(units: list[SemanticUnit], options: RightSizeOptions) -> list[Chunk]:
    """Merge adjacent small units with same heading context.

    Walk through units sequentially, accumulating into a buffer.
    Flush when: heading changes, label incompatible, or buffer exceeds min_tokens.
    """
    if not units:
        return []

    chunks: list[Chunk] = []
    chunk_index = 0

    # Buffer state
    buf_contents: list[str] = [units[0].content]
    buf_labels: set[str] = {units[0].label}
    buf_pages: list[list[int]] = [units[0].page_numbers]
    buf_headings: list[str] = units[0].headings

    def flush() -> None:
        nonlocal chunk_index
        content = "\n\n".join(buf_contents)
        chunks.append(_to_chunk(
            content=content,
            index=chunk_index,
            label=_merge_label(set(buf_labels)),
            headings=list(buf_headings),
            page_numbers=_merge_pages(buf_pages),
        ))
        chunk_index += 1

    for unit in units[1:]:
        combined_text = "\n\n".join(buf_contents + [unit.content])
        combined_tokens = estimate_tokens(combined_text)

        # Check merge compatibility: same headings, both mergeable labels, fits in max
        can_merge = (
            unit.headings == buf_headings
            and unit.label in _MERGEABLE_LABELS
            and all(l in _MERGEABLE_LABELS for l in buf_labels)
            and "table" not in buf_labels
            and unit.label != "table"
            and combined_tokens <= options.max_tokens
        )

        if can_merge:
            # Accumulate into buffer
            buf_contents.append(unit.content)
            buf_labels.add(unit.label)
            buf_pages.append(unit.page_numbers)
        else:
            # Flush current buffer, start new
            flush()
            buf_contents = [unit.content]
            buf_labels = {unit.label}
            buf_pages = [unit.page_numbers]
            buf_headings = unit.headings

    # Flush remaining
    flush()
    return chunks


def right_size_units(units: list[SemanticUnit], options: RightSizeOptions | None = None) -> list[Chunk]:
    """Right-size semantic units: merge small, split large.

    Args:
        units: Raw semantic units from Docling's HierarchicalChunker.
        options: Sizing thresholds. Uses defaults if not provided.

    Returns:
        List of Chunk objects ready for embedding pipeline.
    """
    if options is None:
        options = RightSizeOptions()

    # Phase 1: Merge small adjacent units
    merged = _merge_pass(units, options)

    # Phase 2: Split oversized chunks — placeholder pass-through until Task 4 adds _split_chunk.
    # For now, all chunks pass through with re-indexed positions.
    result: list[Chunk] = []
    final_index = 0
    for chunk in merged:
        chunk.index = final_index
        result.append(chunk)
        final_index += 1

    return result
```

- [ ] **Step 4: Run merge tests to verify they pass**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_right_sizer.py -v`
Expected: All merge tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/right_sizer.py services/ingestion/tests/test_right_sizer.py
git commit -m "feat: add right-sizer module with merge logic for semantic units"
```

---

### Task 4: Right-Sizer — Split Large Units

**Files:**
- Modify: `services/ingestion/src/right_sizer.py`
- Modify: `services/ingestion/tests/test_right_sizer.py`

- [ ] **Step 1: Write failing tests for split logic**

Add to `services/ingestion/tests/test_right_sizer.py`:

```python
class TestSplitLargeUnits:
    """Splitting oversized units at structure boundaries."""

    def test_large_table_split_at_row_boundaries(self):
        """A table exceeding max_tokens is split between rows, keeping header."""
        header = "| Name | Value |\n|------|-------|\n"
        rows = "\n".join([f"| item{i} | val{i} |" for i in range(80)])
        table_content = header + rows
        units = [_unit(table_content, headings=["H1"], label="table")]
        result = right_size_units(units, RightSizeOptions(min_tokens=50, max_tokens=200))
        assert len(result) > 1
        # Each split chunk should start with the header row
        for chunk in result:
            assert "| Name | Value |" in chunk.content

    def test_large_prose_split_at_sentences(self):
        """Prose exceeding max_tokens is split at sentence boundaries."""
        sentences = ". ".join([f"Sentence number {i} with some words" for i in range(60)])
        units = [_unit(sentences + ".", headings=["H1"], label="paragraph")]
        result = right_size_units(units, RightSizeOptions(min_tokens=50, max_tokens=200))
        assert len(result) > 1
        # No chunk should exceed max_tokens
        for chunk in result:
            assert chunk.token_count <= 200

    def test_split_preserves_metadata(self):
        """Split chunks inherit label, headings, page_numbers from parent."""
        sentences = ". ".join([f"Sentence {i} with padding words here" for i in range(60)])
        units = [_unit(sentences + ".", headings=["Ch1", "Sec2"], label="paragraph",
                       page_numbers=[3, 4])]
        result = right_size_units(units, RightSizeOptions(min_tokens=50, max_tokens=200))
        assert len(result) > 1
        for chunk in result:
            assert chunk.metadata["headings"] == ["Ch1", "Sec2"]
            assert chunk.metadata["label"] == "paragraph"
            assert chunk.metadata["page_numbers"] == [3, 4]

    def test_unit_at_max_tokens_not_split(self):
        """A unit exactly at max_tokens is not split."""
        # ~500 tokens = ~2000 chars
        text = "word " * 500
        units = [_unit(text.strip(), headings=["H1"])]
        result = right_size_units(units, RightSizeOptions(min_tokens=100, max_tokens=500))
        assert len(result) == 1

    def test_sequential_indexes_after_split(self):
        """After merge + split, all chunks have sequential indexes starting at 0."""
        sentences = ". ".join([f"Long sentence {i} with extra padding" for i in range(60)])
        units = [
            _unit("Short intro.", headings=["H1"], unit_index=0),
            _unit(sentences + ".", headings=["H2"], label="paragraph", unit_index=1),
        ]
        result = right_size_units(units, RightSizeOptions(min_tokens=10, max_tokens=200))
        indexes = [c.index for c in result]
        assert indexes == list(range(len(result)))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_right_sizer.py::TestSplitLargeUnits -v`
Expected: FAIL — split logic not implemented (oversized chunks pass through unsplit).

- [ ] **Step 3: Implement split logic in right_sizer.py**

Add these functions to `services/ingestion/src/right_sizer.py`, and update the `right_size_units` function:

```python
def _split_table(content: str, max_tokens: int, metadata: dict) -> list[Chunk]:
    """Split a markdown table at row boundaries, preserving header in each chunk.

    Detects the header (first two lines: column names + separator),
    then groups remaining rows into chunks that fit within max_tokens.
    """
    lines = content.split("\n")

    # Find header: first line with |, then separator line with |---|
    header_lines: list[str] = []
    data_lines: list[str] = []
    header_found = False

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not header_found:
            header_lines.append(line)
            # Separator line (e.g., |---|---|) marks end of header
            if stripped.startswith("|") and set(stripped.replace("|", "").strip()) <= {"-", ":", " "}:
                if len(header_lines) >= 2:
                    header_found = True
        else:
            if stripped:  # Skip empty lines between rows
                data_lines.append(line)

    if not header_found:
        # Not a proper markdown table — fall back to prose split
        return _split_prose(content, max_tokens, metadata)

    header_text = "\n".join(header_lines)
    header_tokens = estimate_tokens(header_text)

    chunks: list[Chunk] = []
    current_rows: list[str] = []
    current_tokens = header_tokens

    for row in data_lines:
        row_tokens = estimate_tokens(row)
        if current_tokens + row_tokens > max_tokens and current_rows:
            # Flush current chunk
            chunk_content = header_text + "\n" + "\n".join(current_rows)
            chunks.append(Chunk(
                content=chunk_content,
                index=0,  # Re-indexed later
                token_count=estimate_tokens(chunk_content),
                metadata=dict(metadata),
                context=None,
            ))
            current_rows = [row]
            current_tokens = header_tokens + row_tokens
        else:
            current_rows.append(row)
            current_tokens += row_tokens

    # Flush remaining rows
    if current_rows:
        chunk_content = header_text + "\n" + "\n".join(current_rows)
        chunks.append(Chunk(
            content=chunk_content,
            index=0,
            token_count=estimate_tokens(chunk_content),
            metadata=dict(metadata),
            context=None,
        ))

    return chunks if chunks else [Chunk(
        content=content, index=0, token_count=estimate_tokens(content),
        metadata=dict(metadata), context=None,
    )]


def _split_prose(content: str, max_tokens: int, metadata: dict) -> list[Chunk]:
    """Split prose at sentence boundaries using the chunker's split logic.

    Note: _split_segment and _merge_segments are private functions in chunker.py.
    They are stable internal APIs reused here to avoid duplication. If they change,
    these imports will break at test time.
    """
    from src.chunker import _split_segment, _merge_segments

    segments = _split_segment(content, max_tokens)
    merged = _merge_segments(segments, max_tokens)

    chunks: list[Chunk] = []
    for segment in merged:
        chunks.append(Chunk(
            content=segment,
            index=0,  # Re-indexed later
            token_count=estimate_tokens(segment),
            metadata=dict(metadata),
            context=None,
        ))

    return chunks if chunks else [Chunk(
        content=content, index=0, token_count=estimate_tokens(content),
        metadata=dict(metadata), context=None,
    )]


def _split_chunk(chunk: Chunk, max_tokens: int) -> list[Chunk]:
    """Split an oversized chunk using structure-aware logic."""
    label = chunk.metadata.get("label", "paragraph")
    if label == "table":
        return _split_table(chunk.content, max_tokens, chunk.metadata)
    return _split_prose(chunk.content, max_tokens, chunk.metadata)
```

Update the `right_size_units` function — replace the Phase 2 section:

```python
    # Phase 2: Split oversized chunks
    result: list[Chunk] = []
    final_index = 0
    for chunk in merged:
        if chunk.token_count > options.max_tokens:
            split_chunks = _split_chunk(chunk, options.max_tokens)
            for sc in split_chunks:
                sc.index = final_index
                result.append(sc)
                final_index += 1
        else:
            chunk.index = final_index
            result.append(chunk)
            final_index += 1

    return result
```

- [ ] **Step 4: Run all right-sizer tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_right_sizer.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/right_sizer.py services/ingestion/tests/test_right_sizer.py
git commit -m "feat: add split logic to right-sizer (tables at rows, prose at sentences)"
```

---

## Chunk 2: Worker Integration + Re-ingestion

### Task 5: Update upsert_chunks to Write New Columns

**Files:**
- Modify: `services/ingestion/src/worker.py:83-108`

- [ ] **Step 1: Write failing test**

Add to `services/ingestion/tests/test_worker.py` (adjust based on existing test patterns):

```python
def test_upsert_chunks_includes_label_and_headings(mock_supabase):
    """upsert_chunks sends label and headings in the INSERT payload."""
    chunks = [
        Chunk(content="Test content", index=0, token_count=5,
              metadata={"label": "table", "headings": ["Ch1", "Sec2"],
                        "page_numbers": [1]},
              context=None),
    ]
    embeddings = [[0.1] * 1536]

    upsert_chunks(chunks, embeddings, "doc-uuid", "org-uuid")

    call_args = mock_supabase.table("document_chunks").insert.call_args
    row = call_args[0][0][0]  # First row of first positional arg
    assert row["label"] == "table"
    assert row["headings"] == ["Ch1", "Sec2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_worker.py::test_upsert_chunks_includes_label_and_headings -v`
Expected: FAIL — `label` and `headings` not in upsert payload.

- [ ] **Step 3: Update upsert_chunks in worker.py**

In `services/ingestion/src/worker.py`, find the `upsert_chunks` function (lines 83-108). Update the row dict to include `label` and `headings`:

Current row construction (approximately lines 92-104):
```python
rows.append({
    "document_id": document_id,
    "organization_id": organization_id,
    "content": chunk.content,
    "context": chunk.context,
    "embedding": embedding,
    "chunk_index": chunk.index,
    "token_count": chunk.token_count,
    "metadata": chunk.metadata,
})
```

Add two new fields:
```python
rows.append({
    "document_id": document_id,
    "organization_id": organization_id,
    "content": chunk.content,
    "context": chunk.context,
    "embedding": embedding,
    "chunk_index": chunk.index,
    "token_count": chunk.token_count,
    "metadata": chunk.metadata,
    "label": chunk.metadata.get("label"),
    "headings": chunk.metadata.get("headings"),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_worker.py::test_upsert_chunks_includes_label_and_headings -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_worker.py
git commit -m "feat: upsert_chunks writes label and headings columns"
```

---

### Task 6: Replace chunk_sections with Semantic Units Pipeline

**Files:**
- Modify: `services/ingestion/src/worker.py:165-257` (process_message function)
- Modify: `services/ingestion/tests/test_worker.py`

- [ ] **Step 1: Write failing test for new pipeline**

Add to `services/ingestion/tests/test_worker.py`:

```python
def test_process_message_uses_semantic_units_for_chunking(mock_supabase, mock_settings):
    """Pipeline uses semantic units + right-sizer instead of chunk_sections."""
    mock_settings.populate_semantic_units_table = False

    with patch("src.worker.extract_semantic_units") as mock_extract, \
         patch("src.worker.right_size_units") as mock_right_size, \
         patch("src.worker.chunk_sections") as mock_chunk_sections, \
         patch("src.worker.embed_texts") as mock_embed, \
         patch("src.worker.parse_document") as mock_parse:

        # Setup mocks
        mock_parse.return_value = mock_parse_result()
        mock_extract.return_value = [mock_semantic_unit()]
        mock_right_size.return_value = [
            Chunk(content="test", index=0, token_count=5,
                  metadata={"label": "paragraph", "headings": ["H1"], "page_numbers": [1]},
                  context=None)
        ]
        mock_embed.return_value = [[0.1] * 1536]

        process_message(mock_message())

        # Semantic units + right-sizer called
        mock_extract.assert_called_once()
        mock_right_size.assert_called_once()
        # Old chunk_sections NOT called
        mock_chunk_sections.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_worker.py::test_process_message_uses_semantic_units_for_chunking -v`
Expected: FAIL — worker still calls `chunk_sections`.

- [ ] **Step 3: Update process_message in worker.py**

Replace the `chunk_sections` call (line 215) with the semantic units pipeline. The key section to modify is inside `process_message()`:

Note: VLM enrichment (lines 204-212 in current worker) runs BEFORE chunking and modifies `parse_result.sections` with page image paths. This ordering is preserved — the new code below replaces only the `chunk_sections` call at line 215, after VLM has already enriched the sections.

Also: The function is imported as `extract_units` in the current worker (line 199), but the actual function name in `semantic_units.py` is `extract_semantic_units`. Use the actual name.

Remove the `chunk_sections` import from the top of `worker.py` (dead code after this change).

```python
# REPLACE THIS:
# chunks = chunk_sections(parse_result, doc["name"])

# WITH THIS (imports go at top of file):
from src.semantic_units import extract_semantic_units
from src.right_sizer import right_size_units, RightSizeOptions

# Extract semantic units from Docling document
semantic_units = extract_semantic_units(parse_result.docling_doc)

# Right-size: merge small, split large
right_size_opts = RightSizeOptions(
    min_tokens=settings.min_unit_tokens,
    max_tokens=settings.max_unit_tokens,
)
chunks = right_size_units(semantic_units, right_size_opts)

# Enrich chunks with document name and VLM page images
for chunk in chunks:
    chunk.metadata["document_name"] = doc["name"]
    # Map VLM page images by page number overlap
    if parse_result.sections:
        chunk_pages = set(chunk.metadata.get("page_numbers", []))
        page_image_paths = {}
        for section in parse_result.sections:
            if section.page_image_paths:
                for page_no, path in section.page_image_paths.items():
                    if page_no in chunk_pages:
                        page_image_paths[page_no] = path
        if page_image_paths:
            chunk.metadata["page_image_paths"] = page_image_paths
```

Also update the imports at the top of `worker.py` to include `extract_semantic_units` and `right_size_units`.

The `populate_semantic_units_table` conditional remains for storing to the separate `document_semantic_units` table — this is independent of the chunking path.

- [ ] **Step 4: Run full test suite**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests PASS (existing tests may need mock updates — see Step 5).

- [ ] **Step 5: Fix any broken existing tests**

Existing tests that mock `chunk_sections` will need updating to mock `extract_semantic_units` + `right_size_units` instead. Update mock setup in affected tests to use the new pipeline.

The test helper `mock_parse_result()` may need a `docling_doc` attribute if it doesn't have one already. Add it:

```python
mock_result.docling_doc = MagicMock()  # Docling document mock
```

- [ ] **Step 6: Run full test suite again**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_worker.py
git commit -m "feat: replace chunk_sections with semantic units + right-sizer pipeline"
```

---

### Task 7: Re-ingestion Server Action

**Files:**
- Modify: `app/(dashboard)/documents/actions.ts` (or wherever document server actions live)

- [ ] **Step 1: Find the existing document actions file**

Check `app/(dashboard)/documents/` for an `actions.ts` file. If none exists, check `app/(dashboard)/documents/[id]/page.tsx` for inline server actions or a nearby actions file.

- [ ] **Step 2: Add reIngestAll server action**

```typescript
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function reIngestAll() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No organization found");
  }

  const organizationId = profile.current_organization_id;
  const admin = createAdminClient();

  // Get all documents for this org
  const { data: documents, error } = await admin
    .from("documents")
    .select("id")
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Failed to fetch documents: ${error.message}`);
  if (!documents?.length) return { enqueued: 0 };

  // Set all documents to "processing" status
  for (const doc of documents) {
    await admin
      .from("documents")
      .update({ status: "processing" })
      .eq("id", doc.id);
  }

  // Enqueue re-ingestion messages via pgmq — one per document
  // enqueue_ingestion accepts a single UUID: p_document_id
  for (const doc of documents) {
    const { error: enqueueError } = await admin.rpc("enqueue_ingestion", {
      p_document_id: doc.id,
    });
    if (enqueueError) {
      console.error(`Failed to enqueue ${doc.id}: ${enqueueError.message}`);
    }
  }

  // Bump cache version atomically
  await admin.rpc("bump_cache_version", { org_id: organizationId });

  return { enqueued: documents.length };
}

- [ ] **Step 3: Add UI button to documents page**

Add a "Re-ingest All Documents" button to the documents list page. Follow the same pattern as the "Generate Test Cases" button in `test-case-panel.tsx`:

```typescript
const [isReingesting, startReingestionTransition] = useTransition();

function handleReingest() {
  startReingestionTransition(async () => {
    try {
      const result = await reIngestAll();
      // Show success message
    } catch (err) {
      // Show error message
    }
  });
}
```

- [ ] **Step 4: Add chunk deletion before upsert in worker.py**

The current worker uses `.insert()` and does NOT delete old chunks. For re-ingestion to work, add a DELETE step in `process_message()` before the `upsert_chunks` call. Add this line immediately before the `upsert_chunks(chunks, embeddings, ...)` call:

```python
# Delete existing chunks before inserting new ones (needed for re-ingestion)
supabase.table("document_chunks").delete().eq("document_id", document_id).execute()
```

This is safe for first-time ingestion too (no-op when no chunks exist).

- [ ] **Step 5: Commit**

```bash
git add app/(dashboard)/documents/
git commit -m "feat: add re-ingest all documents action and UI button"
```

---

### Task 8: Integration Test — End-to-End Pipeline

**Files:**
- No new files — manual verification

- [ ] **Step 1: Run TypeScript type check**

Run: `pnpm tsc --noEmit`
Expected: Clean — no type errors.

- [ ] **Step 2: Run TypeScript tests**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests pass.

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: Clean build.

- [ ] **Step 5: Test re-ingestion manually**

1. Start the dev server: `pnpm dev`
2. Start the Python worker: `cd services/ingestion && source .venv/bin/activate && python -m src.worker`
3. Navigate to the documents page
4. Click "Re-ingest All Documents"
5. Verify documents go to "processing" status
6. Wait for worker to complete processing
7. Verify documents return to "complete" status
8. Open a document detail page — verify chunks have `label` metadata visible
9. Test chat — verify search still works and returns relevant results

- [ ] **Step 6: Run eval suite**

Run the eval to compare against baseline (P@k 0.72, R@k 0.98, MRR 0.98):

Navigate to `/optimize` dashboard and trigger an eval run, or run via the eval runner directly.

Compare results. If scores regress significantly (>5% drop on any metric), investigate:
- Are chunks too small or too large?
- Are tables being split correctly?
- Is contextual chunking still working?

- [ ] **Step 7: Final commit**

Stage only the specific files modified during integration fixes (if any). Do not use `git add -A` — it risks staging unintended files.

```bash
git commit -m "chore: integration verification — semantic chunking pipeline complete"
```
