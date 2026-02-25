# Contextual Chunking Design

**Date:** 2026-02-25
**Status:** Approved
**Technique:** Anthropic's Contextual Retrieval — LLM-generated per-chunk context prepended before embedding and BM25 indexing

## Background

Traditional chunking loses document-level context. A chunk like "Revenue grew 3% over the previous quarter" is ambiguous without knowing which company, which quarter, or which document it came from. Anthropic's Contextual Retrieval technique uses an LLM to generate a short (50-100 token) situating summary for each chunk, given the full document as context. This context is prepended to the chunk before embedding and BM25 indexing.

**Claimed improvements (Anthropic):**
- Contextual embeddings alone: 35% retrieval failure reduction
- Combined with contextual BM25: 49% reduction
- With reranking added: 67% reduction

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM for context generation | GPT-4o-mini | Already in Python worker (VLM). No new dependency. Cheap, capable enough for short summaries. |
| Context storage | Separate `context` column on `document_chunks` | Clean separation. Developers can inspect, regenerate, or ignore context independently. |
| Feature toggle | Opt-in via `CONTEXTUAL_CHUNKING_ENABLED=false` | Matches VLM and semantic cache patterns. Zero-cost default. |
| Embedding construction | `context + "\n\n" + content` (content retains header prefix) | Belt and suspenders — deterministic header prefix + semantic LLM context. |
| Architecture | Batch concurrent calls (asyncio.gather + semaphore) | Mirrors VLM pattern. 5-10x faster than sequential. |

## Data Model

### Migration: `00033_contextual_chunking.sql`

Add nullable `context` column and update `fts` generated column:

```sql
ALTER TABLE document_chunks ADD COLUMN context text;

-- Rebuild fts to include context for BM25
ALTER TABLE document_chunks DROP COLUMN fts;
ALTER TABLE document_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(context, '') || ' ' || content)
  ) STORED;
```

Nullable — existing chunks and chunks ingested with the feature off have `NULL` context. No backfill needed.

## Context Generation Module

### New file: `services/ingestion/src/contextualizer.py`

Mirrors `vlm.py` pattern. Two main functions:

**`generate_chunk_context(document_text, chunk_content, client) -> str`**
- Sends prompt to GPT-4o-mini, returns 50-100 token context

**`contextualize_chunks(chunks, document_text, config) -> list[Chunk]`**
- Entry point from worker
- `asyncio.gather` with `Semaphore(config.contextual_concurrency)`
- Populates `chunk.context` on each chunk

### Prompt Template

```
<document>
{document_text}
</document>
Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_content}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.
```

### Config Additions (`config.py`)

```python
contextual_chunking_enabled: bool = False
contextual_model: str = "gpt-4o-mini"
contextual_concurrency: int = 5
```

### Chunk Dataclass Update (`chunker.py`)

```python
@dataclass
class Chunk:
    content: str
    index: int
    token_count: int
    metadata: dict
    context: str | None = None  # Populated by contextualizer
```

## Pipeline Integration

```
Parse → VLM (optional) → Chunk → Contextualize (optional) → Embed → Upsert
```

In `worker.process_message`, after chunking and before embedding:

```python
if config.contextual_chunking_enabled:
    chunks = await contextualize_chunks(chunks, parse_result.text, config)
```

### Embedding String Construction

```python
def get_embedding_text(chunk: Chunk) -> str:
    if chunk.context:
        return f"{chunk.context}\n\n{chunk.content}"
    return chunk.content
```

Used when building the text list for OpenAI embedding API.

### Upsert Change

Add `context` to the INSERT statement in `upsert_chunks`.

### Search Side

No changes needed:
- `hybrid_search` RPC uses `embedding` (already contextual) and `fts` (auto-updated by generated column)
- `content` column still holds the original chunk text for display
- Cache invalidation already handled by `bump_cache_version()` on ingestion

## Edge Cases

**Large documents (>120K tokens):** Truncate document text to 120K tokens before sending to GPT-4o-mini (128K context window). Covers 99.9% of real documents.

**Single chunk context failure:** Log error, set `chunk.context = None`. Chunk is embedded and upserted normally without context. Don't fail the whole document.

**Existing documents (feature off → on):** No automatic backfill. Users re-ingest to get contextual chunks.

**Token budget:** Context (50-100 tokens) is in a separate column, not counted against the 512-token chunk budget. Embedding string is ~560-612 tokens — well within text-embedding-3-small's 8191 limit.

## Cost Estimate

- GPT-4o-mini: ~$0.15/M input tokens, ~$0.60/M output tokens
- A 20-page PDF (~50 chunks, ~10K tokens document): ~50 calls, each sending ~10K input tokens + ~75 output tokens
- Total per document: ~500K input tokens ($0.075) + ~3.75K output tokens ($0.002) ≈ **$0.08 per 20-page PDF**
- OpenAI's automatic prompt caching may reduce input costs further for repeated identical document prefixes
