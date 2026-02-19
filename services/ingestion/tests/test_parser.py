import pytest
from pathlib import Path

from src.parser import parse_document, ParseResult

FIXTURES = Path(__file__).parent / "fixtures"


class TestPdfParsing:
    def test_extracts_text_from_pdf(self):
        pdf_path = FIXTURES / "sample.pdf"
        result = parse_document(pdf_path, "application/pdf")
        assert isinstance(result, ParseResult)
        assert len(result.text) > 0

    def test_extracts_sections_from_pdf(self):
        pdf_path = FIXTURES / "sample.pdf"
        result = parse_document(pdf_path, "application/pdf")
        assert len(result.sections) > 0
        for section in result.sections:
            assert len(section.content) > 0

    def test_extracts_tables_as_markdown(self):
        pdf_path = FIXTURES / "sample-with-table.pdf"
        result = parse_document(pdf_path, "application/pdf")
        # Tables should appear in the text as markdown tables
        assert "|" in result.text


class TestMarkdownParsing:
    def test_extracts_text_from_markdown(self):
        md_path = FIXTURES / "sample.md"
        result = parse_document(md_path, "text/markdown")
        assert len(result.text) > 0

    def test_extracts_sections_with_headers(self):
        md_path = FIXTURES / "sample.md"
        result = parse_document(md_path, "text/markdown")
        assert len(result.sections) > 0
        has_headers = any(len(s.headers) > 0 for s in result.sections)
        assert has_headers


class TestPlainTextParsing:
    def test_extracts_text_from_plain(self):
        txt_path = FIXTURES / "sample.txt"
        result = parse_document(txt_path, "text/plain")
        assert len(result.text) > 0
        assert len(result.sections) >= 1


class TestUnsupportedFormat:
    def test_raises_on_unsupported_mime_type(self):
        with pytest.raises(ValueError, match="Unsupported"):
            parse_document(Path("fake.xyz"), "application/octet-stream")
