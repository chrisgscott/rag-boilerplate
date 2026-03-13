"""Right-size semantic units for optimal embedding quality.

Merges small adjacent units (same heading context, compatible labels) and splits
oversized units at structure boundaries (table rows, sentence breaks).
"""

from __future__ import annotations

from dataclasses import dataclass

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


def _split_table(content: str, max_tokens: int, metadata: dict) -> list[Chunk]:
    """Split a markdown table at row boundaries, preserving header in each chunk."""
    lines = content.split("\n")
    header_lines: list[str] = []
    data_lines: list[str] = []
    header_found = False

    for line in lines:
        stripped = line.strip()
        if not header_found:
            header_lines.append(line)
            if stripped.startswith("|") and set(stripped.replace("|", "").strip()) <= {"-", ":", " "}:
                if len(header_lines) >= 2:
                    header_found = True
        else:
            if stripped:
                data_lines.append(line)

    if not header_found:
        return _split_prose(content, max_tokens, metadata)

    header_text = "\n".join(header_lines)
    header_tokens = estimate_tokens(header_text)

    chunks: list[Chunk] = []
    current_rows: list[str] = []
    current_tokens = header_tokens

    for row in data_lines:
        row_tokens = estimate_tokens(row)
        if current_tokens + row_tokens > max_tokens and current_rows:
            chunk_content = header_text + "\n" + "\n".join(current_rows)
            chunks.append(Chunk(
                content=chunk_content, index=0,
                token_count=estimate_tokens(chunk_content),
                metadata=dict(metadata), context=None,
            ))
            current_rows = [row]
            current_tokens = header_tokens + row_tokens
        else:
            current_rows.append(row)
            current_tokens += row_tokens

    if current_rows:
        chunk_content = header_text + "\n" + "\n".join(current_rows)
        chunks.append(Chunk(
            content=chunk_content, index=0,
            token_count=estimate_tokens(chunk_content),
            metadata=dict(metadata), context=None,
        ))

    return chunks if chunks else [Chunk(
        content=content, index=0, token_count=estimate_tokens(content),
        metadata=dict(metadata), context=None,
    )]


def _split_prose(content: str, max_tokens: int, metadata: dict) -> list[Chunk]:
    """Split prose at sentence boundaries using the chunker's split logic.

    Note: _split_segment and _merge_segments are private functions in chunker.py.
    They are stable internal APIs reused here to avoid duplication.
    """
    from src.chunker import _split_segment, _merge_segments

    segments = _split_segment(content, max_tokens)
    merged = _merge_segments(segments, max_tokens)

    chunks: list[Chunk] = []
    for segment in merged:
        chunks.append(Chunk(
            content=segment, index=0,
            token_count=estimate_tokens(segment),
            metadata=dict(metadata), context=None,
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
