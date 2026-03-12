# Semantic Chunking Migration

## Problem

The recursive text chunker splits documents into fixed-size chunks without awareness of document structure. Tables get split mid-row, producing garbled pipe-delimited fragments in search results. This degrades retrieval quality — particularly for structured content like comparison tables, fee schedules, and payment breakdowns common in PropTech documents.

## Solution

Replace the recursive text chunker with Docling's structure-aware HierarchicalChunker as the source of search-ready units. Tables, paragraphs, and lists stay intact as natural document elements, get right-sized for embedding quality, then write into the existing `document_chunks` table.

## Architecture

### Pipeline Change

```
CURRENT:  Parse → Recursive Chunk → [Contextual Enrich] → Embed → document_chunks
NEW:      Parse → Semantic Units → Right-Size → [Contextual Enrich] → Embed → document_chunks
```

We reuse the `document_chunks` table (not `document_semantic_units`) as the storage target. This avoids migrating every downstream consumer — chat, search, eval, optimizer, cache, API all work unchanged.

Two new nullable columns are added to `document_chunks`:
- `label` (text) — element type: paragraph, table, list_item, mixed, etc.
- `headings` (text[]) — heading breadcrumb hierarchy from Docling

The `document_semantic_units` table stays as-is for its original purpose (classification, knowledge graphs).

### Right-Sizing Logic

New module: `services/ingestion/src/right_sizer.py`

Takes raw semantic units from Docling's HierarchicalChunker and produces search-ready units in the embedding sweet spot (~100-500 tokens).

**Merge small units:** Adjacent units with the same heading context and compatible labels (paragraph + paragraph, paragraph + list) get merged until they hit a minimum threshold (~100 tokens). Prevents tiny 20-token paragraphs from becoming weak embeddings.

**Split large units:** Units exceeding max threshold (~500 tokens) get split with structure awareness:
- Tables: split at row boundaries (never mid-row). Each sub-unit keeps the table header row for context.
- Prose: fall back to sentence-boundary splitting (reuse logic from existing recursive chunker's `_split_segment`).

**Metadata preservation:** Each right-sized unit carries:
- `label` — paragraph, table, list_item, etc. (or `mixed` if merged from different types)
- `headings` — breadcrumb hierarchy from Docling
- `page_numbers` — union of pages from merged/split units
- `unit_index` — sequential order in document

**No overlap between units.** The current recursive chunker applies 15% backward-looking overlap. With semantic units, overlap is unnecessary — structural boundaries (paragraph breaks, table edges) are natural retrieval boundaries. Heading context and contextual chunking provide sufficient signal at boundaries.

**Token counting:** Uses the same `estimate_tokens()` method as the existing chunker (`ceil(len(text) / 4)`) for consistency.

**Config knobs** (in `services/ingestion/src/config.py`):
- `min_unit_tokens: int = 100`
- `max_unit_tokens: int = 500`

### Worker Pipeline Changes

Current pipeline in `worker.py`:
```
Parse → [Persist DoclingJSON] → [Semantic Units] → [VLM] → Chunk Sections → [Contextual] → Embed → Upsert
```

New pipeline:
```
Parse → [Persist DoclingJSON] → Extract Semantic Units → Right-Size → [VLM enrich] → [Contextual] → Embed → Upsert
```

Key changes:
- `chunk_sections()` call replaced by `extract_semantic_units()` + `right_size_units()`
- Semantic unit extraction becomes mandatory for the chunking path
- Right-sizer output maps to `Chunk` dataclass: `content` from unit content, `index` from sequential re-indexing, `token_count` from `estimate_tokens()`, `metadata` carrying `label`, `headings`, `page_numbers`, `document_name`, and `page_image_paths` (if VLM enabled), `context` set to `None` (populated later by contextualizer if enabled)
- `upsert_chunks()` updated to include `label` and `headings` in INSERT payload (currently builds rows with a fixed set of keys — must add the two new columns)
- **VLM page image enrichment:** After right-sizing, map page images to units by matching unit `page_numbers` against the VLM page image storage paths (`{org_id}/page-images/{doc_id}/page-{n}.webp`). Store as `page_image_paths` in chunk `metadata` JSONB, same format as current pipeline.
- **Config flag rename:** `extract_semantic_units` renamed to `populate_semantic_units_table` to clarify its new meaning — semantic unit extraction is always used for chunking, this flag controls whether units are also stored in the separate `document_semantic_units` table (for classification/KG use cases). Default remains `False`.

### Migration

Single migration (00038):
- Add `label` column (text, nullable) to `document_chunks`
- Add `headings` column (text[], nullable) to `document_chunks`
- Update `fts` generated column to include headings in BM25 index:
  ```sql
  ALTER TABLE public.document_chunks DROP COLUMN fts;
  ALTER TABLE public.document_chunks
    ADD COLUMN fts tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(array_to_string(headings, ' '), '') || ' ' ||
        coalesce(context, '') || ' ' ||
        content
      )
    ) STORED;
  CREATE INDEX IF NOT EXISTS document_chunks_fts_idx ON public.document_chunks USING gin(fts);
  ```

No changes needed to `hybrid_search` RPC — it already queries `document_chunks`.

### Re-ingestion

- Add a "Re-ingest All" server action on the documents page (per-org, processes all documents in the current organization)
- For each document with stored `docling_json`: deserialize back to `DoclingDocument` via `DoclingDocument.model_validate(json_data)`, then run through semantic units → right-size → embed pipeline (skip download + parse)
- For documents without stored `docling_json` (ingested before `persist_docling_doc` was enabled): fall back to full re-download and re-parse
- Deletes old chunks for each document before inserting new ones
- Bumps cache version once at the end to invalidate stale cached responses
- Runs as background job via existing pgmq queue — enqueue one message per document
- Progress: track via document status (set to "processing" during re-ingestion, "complete" when done)

### Contextual Chunking

Contextual chunking (LLM-generated situating context prepended before embedding) is preserved. Each semantic unit gets the same treatment — heading hierarchy plus LLM context provides rich embedding signal.

This remains a deployment decision (on/off via `CONTEXTUAL_CHUNKING_ENABLED`), not an optimizer knob, since toggling it requires re-ingestion.

## What Doesn't Change

- `hybrid_search` RPC — same table, same columns
- Chat route — same search result shape, page image gallery works
- REST API — same search endpoint
- Semantic cache — same invalidation pattern
- Optimizer — same knobs, same eval runner
- Test case generator — still references `document_chunks`
- Document detail page — still shows chunks by chunk_index
- Demo seed/delete — cascade deletes still work
- All 32 files that reference `document_chunks` — zero breaking changes confirmed via audit

## Testing

- Unit tests for `right_sizer.py`: merge logic, table row splitting, edge cases (single huge table, many tiny paragraphs)
- Update `test_worker.py` to verify new pipeline order
- After re-ingestion: re-run eval suite to compare retrieval quality (P@k, R@k, MRR) against current baseline (P@k 0.72, R@k 0.98, MRR 0.98)
- Eval regression = rollback signal

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Replace vs supplement chunks | Replace | One source of truth; semantic units have better boundaries |
| Storage table | Reuse `document_chunks` | Avoids migrating all downstream consumers |
| Small units | Merge adjacent | Prevents weak embeddings from tiny fragments |
| Large units | Split at structure boundaries | Tables split at rows, prose at sentences |
| Contextual chunking | Keep support | Proven to improve eval scores |
| Old chunks on re-ingest | Delete and replace | docling_json stored for re-processing if needed |
| Search strategy | Semantic units only | No reason to search worse copy of same data |
