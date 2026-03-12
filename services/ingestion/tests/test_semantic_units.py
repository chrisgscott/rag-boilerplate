import pytest
import dataclasses
from unittest.mock import MagicMock, patch


def test_semantic_unit_dataclass_fields():
    """SemanticUnit should have content, headings, label, page_numbers, unit_index, docling_ref."""
    from src.semantic_units import SemanticUnit

    fields = {f.name for f in dataclasses.fields(SemanticUnit)}
    assert fields == {"content", "headings", "label", "page_numbers", "unit_index", "docling_ref"}


def test_extract_semantic_units_returns_list():
    """extract_semantic_units should return a list of SemanticUnit objects."""
    from src.semantic_units import extract_semantic_units

    assert callable(extract_semantic_units)


@patch("src.semantic_units.HierarchicalChunker")
def test_extract_produces_units_from_chunks(mock_chunker_cls):
    """Each HierarchicalChunker chunk becomes a SemanticUnit."""
    from src.semantic_units import extract_semantic_units, SemanticUnit

    mock_chunk_1 = MagicMock()
    mock_chunk_1.text = "Past performance on DTRA contract."
    mock_chunk_1.meta.headings = ["Part 1", "Past Performance"]
    mock_chunk_1.meta.doc_items = [MagicMock(label="paragraph")]
    mock_chunk_1.meta.doc_items[0].prov = [MagicMock(page_no=3)]
    mock_chunk_1.meta.doc_items[0].self_ref = "#/body/0"

    mock_chunk_2 = MagicMock()
    mock_chunk_2.text = "| Col A | Col B |"
    mock_chunk_2.meta.headings = ["Part 2", "Tables"]
    mock_chunk_2.meta.doc_items = [MagicMock(label="table")]
    mock_chunk_2.meta.doc_items[0].prov = [MagicMock(page_no=5)]
    mock_chunk_2.meta.doc_items[0].self_ref = "#/body/1"

    mock_chunker = MagicMock()
    mock_chunker.chunk.return_value = [mock_chunk_1, mock_chunk_2]
    mock_chunker_cls.return_value = mock_chunker

    doc = MagicMock()
    units = extract_semantic_units(doc)

    assert len(units) == 2
    assert isinstance(units[0], SemanticUnit)
    assert units[0].content == "Past performance on DTRA contract."
    assert units[0].headings == ["Part 1", "Past Performance"]
    assert units[0].unit_index == 0
    assert units[1].unit_index == 1
    assert units[1].label == "table"
    assert 5 in units[1].page_numbers


@patch("src.semantic_units.HierarchicalChunker")
def test_extract_returns_empty_on_chunker_error(mock_chunker_cls):
    """If HierarchicalChunker raises, return empty list."""
    from src.semantic_units import extract_semantic_units

    mock_chunker = MagicMock()
    mock_chunker.chunk.side_effect = Exception("Chunker failed")
    mock_chunker_cls.return_value = mock_chunker

    doc = MagicMock()
    units = extract_semantic_units(doc)
    assert units == []


@patch("src.semantic_units.HierarchicalChunker")
def test_extract_handles_empty_chunks(mock_chunker_cls):
    """If HierarchicalChunker returns no chunks, return empty list."""
    from src.semantic_units import extract_semantic_units

    mock_chunker = MagicMock()
    mock_chunker.chunk.return_value = []
    mock_chunker_cls.return_value = mock_chunker

    doc = MagicMock()
    units = extract_semantic_units(doc)
    assert units == []


def test_infer_label_defaults_to_paragraph():
    """Unknown labels map to paragraph."""
    from src.semantic_units import _infer_label

    assert _infer_label([]) == "paragraph"
    item = MagicMock(label="unknown_type")
    assert _infer_label([item]) == "paragraph"


def test_infer_label_maps_known_types():
    """Known Docling labels map correctly."""
    from src.semantic_units import _infer_label

    for label in ["table", "list_item", "section_header", "title", "caption", "formula", "picture"]:
        item = MagicMock(label=label)
        assert _infer_label([item]) == label


def test_extract_pages_from_prov():
    """Page numbers extracted from provenance data."""
    from src.semantic_units import _extract_pages

    item = MagicMock()
    item.prov = [MagicMock(page_no=2), MagicMock(page_no=5), MagicMock(page_no=2)]
    pages = _extract_pages([item])
    assert pages == [2, 5]


def test_extract_pages_handles_missing_prov():
    """Items without prov attribute return empty list."""
    from src.semantic_units import _extract_pages

    item = MagicMock(spec=[])  # no prov attribute
    pages = _extract_pages([item])
    assert pages == []
