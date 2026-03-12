"""
Semantic Unit Extraction via Docling's HierarchicalChunker.

Produces one SemanticUnit per natural document element (paragraph, list, table)
with heading hierarchy attached. These are NOT replacements for RAG chunks —
they're optimized for structured extraction, not retrieval.
"""

import logging
from dataclasses import dataclass, field

from docling_core.transforms.chunker.hierarchical_chunker import HierarchicalChunker

logger = logging.getLogger(__name__)


@dataclass
class SemanticUnit:
    content: str
    headings: list[str] = field(default_factory=list)
    label: str = "paragraph"
    page_numbers: list[int] = field(default_factory=list)
    unit_index: int = 0
    docling_ref: str | None = None


def _infer_label(doc_items: list) -> str:
    """Map DocItem labels to a simplified set."""
    if not doc_items:
        return "paragraph"
    label = str(getattr(doc_items[0], "label", "paragraph")).lower()
    label_map = {
        "table": "table",
        "list_item": "list_item",
        "section_header": "section_header",
        "title": "title",
        "caption": "caption",
        "formula": "formula",
        "picture": "picture",
        "paragraph": "paragraph",
    }
    return label_map.get(label, "paragraph")


def _extract_pages(doc_items: list) -> list[int]:
    """Extract unique page numbers from DocItem provenance data."""
    pages: set[int] = set()
    for item in doc_items:
        for prov in getattr(item, "prov", []):
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                pages.add(page_no)
    return sorted(pages)


def extract_semantic_units(docling_doc) -> list[SemanticUnit]:
    """
    Extract semantic units from a DoclingDocument using HierarchicalChunker.

    Each unit corresponds to a natural document element (paragraph, list, table)
    with its heading hierarchy and page provenance.
    """
    chunker = HierarchicalChunker()
    units: list[SemanticUnit] = []

    try:
        chunks = list(chunker.chunk(dl_doc=docling_doc))
    except Exception as e:
        logger.error(f"HierarchicalChunker failed: {e}")
        return []

    for i, chunk in enumerate(chunks):
        doc_items = getattr(chunk.meta, "doc_items", []) if chunk.meta else []
        headings = getattr(chunk.meta, "headings", []) if chunk.meta else []

        units.append(
            SemanticUnit(
                content=chunk.text,
                headings=list(headings),
                label=_infer_label(doc_items),
                page_numbers=_extract_pages(doc_items),
                unit_index=i,
                docling_ref=(
                    getattr(doc_items[0], "self_ref", None) if doc_items else None
                ),
            )
        )

    logger.info(f"Extracted {len(units)} semantic units")
    return units
