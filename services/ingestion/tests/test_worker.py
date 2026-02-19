import pytest
from unittest.mock import MagicMock, patch, call
from pathlib import Path

from src.worker import process_message


class TestProcessMessage:
    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    @patch("src.worker.embed_texts")
    def test_orchestrates_full_pipeline(self, mock_embed, mock_parse, mock_supabase):
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

        process_message(message)

        # Verify parse was called
        mock_parse.assert_called_once()

        # Verify embed was called
        mock_embed.assert_called_once()

        # Verify document status was updated (processing + complete = multiple table calls)
        assert supabase.table.call_count >= 3  # status update + doc fetch + chunk insert

    @patch("src.worker._get_supabase")
    def test_sets_error_status_on_failure(self, mock_supabase):
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
            process_message(message)

    @patch("src.worker._get_supabase")
    @patch("src.worker.parse_document")
    def test_sets_error_on_empty_chunks(self, mock_parse, mock_supabase):
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
            process_message(message)
