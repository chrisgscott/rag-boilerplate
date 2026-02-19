import logging
from dataclasses import dataclass, field
from pathlib import Path

from docling.document_converter import DocumentConverter
from docling.datamodel.base_models import InputFormat
from docling_core.types.doc.labels import DocItemLabel

logger = logging.getLogger(__name__)

# Initialize converter once (loads AI models into memory)
_converter: DocumentConverter | None = None


def get_converter() -> DocumentConverter:
    global _converter
    if _converter is None:
        _converter = DocumentConverter(
            allowed_formats=[
                InputFormat.PDF,
                InputFormat.MD,
                InputFormat.HTML,
                InputFormat.DOCX,
            ]
        )
    return _converter


@dataclass
class Section:
    content: str
    headers: list[str] = field(default_factory=list)
    level: int = 0


@dataclass
class ParseResult:
    text: str
    sections: list[Section]
    page_count: int = 1


SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "text/markdown",
    "text/plain",
    "text/html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def parse_document(file_path: Path, mime_type: str) -> ParseResult:
    """Parse a document using Docling and return structured text with sections."""
    if mime_type not in SUPPORTED_MIME_TYPES:
        raise ValueError(f"Unsupported MIME type: {mime_type}")

    if mime_type == "text/plain":
        return _parse_plain_text(file_path)

    converter = get_converter()
    result = converter.convert(str(file_path))
    doc = result.document

    # Get full text as markdown (preserves structure, tables, etc.)
    text = doc.export_to_markdown()

    # Extract sections with header hierarchy
    sections = _extract_sections(doc)

    # Get page count
    page_count = len(doc.pages) if hasattr(doc, "pages") and doc.pages else 1

    return ParseResult(text=text, sections=sections, page_count=page_count)


def _extract_sections(doc) -> list[Section]:
    """Walk Docling's document tree and extract sections with header breadcrumbs."""
    sections: list[Section] = []
    header_stack: list[str] = []
    current_content: list[str] = []
    current_level = 0

    for item, level in doc.iterate_items():
        label = getattr(item, "label", None)
        text = ""

        # Handle tables specially
        if label == DocItemLabel.TABLE:
            table_md = item.export_to_markdown() if hasattr(item, "export_to_markdown") else ""
            if table_md:
                current_content.append(table_md)
            continue

        text = getattr(item, "text", "").strip()
        if not text:
            continue

        if label == DocItemLabel.SECTION_HEADER:
            # Flush current section
            _flush_section(sections, current_content, header_stack, current_level)
            current_content = []

            # Update header stack
            h_level = getattr(item, "level", 1)
            header_stack = header_stack[: h_level - 1]
            while len(header_stack) < h_level:
                header_stack.append("")
            header_stack[h_level - 1] = text
            current_level = h_level

        elif label == DocItemLabel.TITLE:
            _flush_section(sections, current_content, header_stack, current_level)
            current_content = []
            header_stack = [text]
            current_level = 1

        else:
            current_content.append(text)

    # Flush final section
    _flush_section(sections, current_content, header_stack, current_level)

    # If no sections found, return entire text as one section
    if not sections:
        full_text = doc.export_to_markdown()
        if full_text.strip():
            sections.append(Section(content=full_text.strip(), headers=[], level=0))

    return sections


def _flush_section(
    sections: list[Section],
    content_lines: list[str],
    headers: list[str],
    level: int,
):
    content = "\n\n".join(line for line in content_lines if line.strip())
    if content:
        clean_headers = [h for h in headers if h]
        sections.append(Section(content=content, headers=list(clean_headers), level=level))


def _parse_plain_text(file_path: Path) -> ParseResult:
    """Simple fallback for plain text files."""
    text = file_path.read_text(encoding="utf-8").strip()
    return ParseResult(
        text=text,
        sections=[Section(content=text, headers=[], level=0)] if text else [],
        page_count=1,
    )
