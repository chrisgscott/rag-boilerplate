# VLM Visual Extraction Design

## Summary

Add an optional Gemini 2.5 Flash step to the ingestion pipeline that describes images, charts, and diagrams in documents. Descriptions are appended to their surrounding text sections, chunked normally, and embedded alongside regular text. Page images are stored in Supabase Storage for future display in chat source cards.

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| What happens to descriptions? | Append to parent section | Simplest; descriptions flow through existing chunker with overlap and context prefixes |
| Opt-in mechanism? | Auto-detect (key present + pictures found) | Zero config for operators; skip silently if no key |
| Image granularity? | Full page images | VLM needs surrounding context (labels, captions, layout) for accurate descriptions |
| Store source images? | Yes, in Supabase Storage | Capture at ingestion time; frontend can display later (Level 2) |
| Concurrency model? | asyncio.gather with semaphore | Parallelize all visual page calls; semaphore (default 10) prevents rate limit hits |

## Architecture

### Pipeline Change

```
Parse (Docling) --> VLM Enrich --> Chunk --> Embed --> Upsert
                    ^^^^^^^^^^^
                    NEW STEP
```

The VLM enrich step runs only when:
1. `GOOGLE_API_KEY` is set in the environment
2. Docling's parsed document has at least one `PictureItem`

### New File: `services/ingestion/src/vlm.py`

Responsibilities:
- `get_visual_pages(doc) -> dict[int, PIL.Image]` — Scan `doc.pictures`, collect unique page numbers, return page images via `doc.pages[page_no].image.pil_image`
- `describe_visual_pages(pages: dict[int, PIL.Image]) -> dict[int, str]` — Send all page images to Gemini 2.5 Flash concurrently, return descriptions keyed by page number
- `upload_page_images(pages, document_id, supabase) -> dict[int, str]` — Upload page images as WebP to Supabase Storage, return storage paths keyed by page number
- `enrich_sections(sections, descriptions, page_images)` — Append descriptions to matching sections, propagate `page_image_path` metadata

### Gemini Prompt

```
You are analyzing a page from a document. Describe ALL visual elements
(charts, diagrams, images, figures) on this page in detail.

Focus on:
- Data values, trends, and relationships shown in charts/graphs
- Labels, legends, axis titles, and annotations
- Structural relationships in diagrams or flowcharts
- Key takeaways a reader would extract from the visual

Write in plain prose suitable for text search. Do not describe decorative
elements, page layout, or formatting. If there are no meaningful visual
elements, respond with "NO_VISUAL_CONTENT".
```

The `NO_VISUAL_CONTENT` sentinel filters false positives (decorative borders, logos).

### Config Changes

Add to `Settings` in `config.py`:
- `google_api_key: str | None = None` — Optional; enables VLM when present
- `vlm_model: str = "gemini-2.5-flash"` — Model name
- `vlm_concurrency: int = 10` — Max concurrent Gemini calls

### Data Model Changes

**No schema migrations.** Page image paths stored in the existing `metadata` JSONB column on `document_chunks`:

```json
{
  "document_name": "Q4 Report.pdf",
  "page_image_path": "page-images/{document_id}/page-3.webp"
}
```

### Parser Changes

Add `pages: set[int]` field to the `Section` dataclass. Populate during `_extract_sections()` from each item's `prov[0].page_no`. This lets `enrich_sections()` match descriptions to the correct section.

### Storage Layout

```
Supabase Storage: documents bucket
  page-images/
    {document_id}/
      page-1.webp
      page-3.webp
      page-7.webp
```

WebP format at quality 80 — ~50-150KB per page image.

## Error Handling

- **Single page VLM failure** — Log warning, skip that page. Don't fail the document.
- **All VLM calls fail** — Log error, continue with text-only ingestion. Document still gets indexed.
- **No GOOGLE_API_KEY** — Skip VLM step entirely. Zero impact on existing pipeline.
- **Image upload failure** — Log warning, continue without storing that page image. Description still gets appended.

## Testing

- **`test_vlm.py`** — Mock Gemini client. Test concurrent calls, `NO_VISUAL_CONTENT` filtering, per-page error isolation, image upload.
- **`test_enrich_sections()`** — Given sections with page ranges and descriptions by page number, verify correct placement. Test orphan pages create new sections.
- **Integration** — Fixture PDF with known image. Mock Gemini response. Verify description appears in final chunks.
- **Existing tests** — Unchanged. `google_api_key = None` means VLM step is skipped.

## Dependencies

- `google-genai` — Official Google AI Python SDK (async-native)
- `Pillow` — Already installed (Docling dependency)

## Cost

~$0.03 per 100 visual pages (Gemini 2.5 Flash pricing). Storage: ~100KB per page image.

## Future (Level 2 — not in scope)

- Display page images in chat source cards when `page_image_path` exists in chunk metadata
- Frontend-only change, no backend work needed
