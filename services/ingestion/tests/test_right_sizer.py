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
