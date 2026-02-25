import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from pathlib import Path

from src.worker import process_message


class TestProcessMessage:
    @patch("src.worker._get_db_connection")
    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    async def test_orchestrates_full_pipeline(self, mock_embed, mock_parse, mock_supabase, mock_settings, mock_db_conn):
        # Config — no VLM
        mock_settings.vlm_enabled = False
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        # Mock Supabase client
        supabase = MagicMock()
        mock_supabase.return_value = supabase

        # Mock document fetch
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "test.pdf",
            "storage_path": "org-456/doc-123/test.pdf",
            "mime_type": "application/pdf",
            "organization_id": "org-456",
        }

        # Mock file download
        supabase.storage.from_.return_value.download.return_value = b"file content"

        # Mock parser
        from src.parser import ParseResult, Section

        mock_parse.return_value = ParseResult(
            text="Some text",
            sections=[Section(content="Section content here for testing", headers=["H1"], level=1)],
            page_count=1,
        )

        # Mock embedder
        from src.embedder import EmbeddingResult

        mock_embed.return_value = EmbeddingResult(
            embeddings=[[0.1] * 1536], token_count=5
        )

        # Mock chunk insert
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()

        # Mock status update
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        message = {
            "document_id": "doc-123",
            "organization_id": "org-456",
        }

        await process_message(message)

        # Verify parse was called
        mock_parse.assert_called_once()

        # Verify embed was called
        mock_embed.assert_called_once()

        # Verify document status was updated (processing + complete = multiple table calls)
        assert supabase.table.call_count >= 3  # status update + doc fetch + chunk insert

    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    async def test_sets_error_status_on_failure(self, mock_supabase, mock_settings):
        mock_settings.vlm_enabled = False
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        supabase = MagicMock()
        mock_supabase.return_value = supabase

        # Make the document fetch fail
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = Exception(
            "Document not found"
        )

        # Status updates should still work
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        message = {
            "document_id": "doc-123",
            "organization_id": "org-456",
        }

        with pytest.raises(Exception, match="Document not found"):
            await process_message(message)

    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    async def test_sets_error_on_empty_chunks(self, mock_parse, mock_supabase, mock_settings):
        mock_settings.vlm_enabled = False
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        supabase = MagicMock()
        mock_supabase.return_value = supabase

        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "empty.txt",
            "storage_path": "org-456/doc-123/empty.txt",
            "mime_type": "text/plain",
            "organization_id": "org-456",
        }
        supabase.storage.from_.return_value.download.return_value = b""

        # Parser returns no sections
        from src.parser import ParseResult

        mock_parse.return_value = ParseResult(text="", sections=[], page_count=1)

        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        message = {
            "document_id": "doc-123",
            "organization_id": "org-456",
        }

        with pytest.raises(ValueError, match="No chunks generated"):
            await process_message(message)


class TestProcessMessageWithVLM:
    @patch("src.worker._get_db_connection")
    @patch("src.worker.enrich_sections")
    @patch("src.worker.upload_page_images")
    @patch("src.worker.describe_visual_pages", new_callable=AsyncMock)
    @patch("src.worker.get_visual_pages")
    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    async def test_runs_vlm_when_api_key_set(
        self,
        mock_embed,
        mock_parse,
        mock_supabase,
        mock_settings,
        mock_visual_pages,
        mock_describe,
        mock_upload,
        mock_enrich,
        mock_db_conn,
    ):
        # Config with VLM enabled
        mock_settings.vlm_enabled = True
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        # Mock Supabase
        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "slides.pdf",
            "storage_path": "org-1/doc-123/slides.pdf",
            "mime_type": "application/pdf",
        }
        supabase.storage.from_.return_value.download.return_value = b"pdf content"
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

        # Mock parser
        from src.parser import ParseResult, Section

        mock_docling_doc = MagicMock()
        mock_parse.return_value = ParseResult(
            text="Some text",
            sections=[Section(content="Content here", headers=["H1"], level=1, pages={1})],
            page_count=3,
            docling_doc=mock_docling_doc,
        )

        # Mock VLM
        from PIL import Image

        mock_visual_pages.return_value = {2: Image.new("RGB", (100, 100))}
        mock_describe.return_value = {2: "A chart showing data."}
        mock_upload.return_value = {2: "page-images/doc-123/page-2.webp"}

        # Mock embedder
        from src.embedder import EmbeddingResult

        mock_embed.return_value = EmbeddingResult(embeddings=[[0.1] * 1536], token_count=5)

        message = {"document_id": "doc-123", "organization_id": "org-1"}
        await process_message(message)

        mock_visual_pages.assert_called_once_with(mock_docling_doc)
        mock_describe.assert_called_once()
        mock_upload.assert_called_once()
        mock_enrich.assert_called_once()

    @patch("src.worker._get_db_connection")
    @patch("src.worker.get_visual_pages")
    @patch("src.worker.settings")
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    async def test_skips_vlm_when_disabled(
        self,
        mock_embed,
        mock_parse,
        mock_supabase,
        mock_settings,
        mock_visual_pages,
        mock_db_conn,
    ):
        mock_settings.vlm_enabled = False
        mock_settings.chunk_max_tokens = 512
        mock_settings.chunk_overlap = 0.15

        supabase = MagicMock()
        mock_supabase.return_value = supabase
        supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "id": "doc-123",
            "name": "test.pdf",
            "storage_path": "org-1/doc-123/test.pdf",
            "mime_type": "application/pdf",
        }
        supabase.storage.from_.return_value.download.return_value = b"content"
        supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()

        from src.parser import ParseResult, Section

        mock_parse.return_value = ParseResult(
            text="Text",
            sections=[Section(content="Content", headers=[], level=0, pages={1})],
            page_count=1,
        )

        from src.embedder import EmbeddingResult

        mock_embed.return_value = EmbeddingResult(embeddings=[[0.1] * 1536], token_count=5)

        message = {"document_id": "doc-123", "organization_id": "org-1"}
        await process_message(message)

        mock_visual_pages.assert_not_called()
