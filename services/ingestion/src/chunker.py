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
    if len(words) > 1:
        return _merge_segments(words, max_tokens)

    # Base case: single token too large to split further — hard character split
    char_limit = max_tokens * 4  # ~4 chars per token
    return [text[i : i + char_limit] for i in range(0, len(text), char_limit)]


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
