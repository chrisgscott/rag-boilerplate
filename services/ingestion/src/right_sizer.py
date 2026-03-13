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
    Flush when: heading changes, label incompatible, or buffer exceeds max_tokens.
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
