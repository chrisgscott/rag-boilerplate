import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from src.contextualizer import generate_chunk_context, contextualize_chunks, CONTEXT_PROMPT
from src.chunker import Chunk


class TestGenerateChunkContext:
    async def test_returns_context_string(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="This chunk is from the payment terms section of a residential lease agreement."))
        ]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await generate_chunk_context(
            document_text="Full document text here...",
            chunk_content="The tenant shall pay rent monthly.",
            client=mock_client,
        )

        assert result == "This chunk is from the payment terms section of a residential lease agreement."
        mock_client.chat.completions.create.assert_called_once()

    async def test_sends_correct_prompt_structure(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Some context."))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        await generate_chunk_context(
            document_text="Doc text",
            chunk_content="Chunk text",
            client=mock_client,
        )

        call_kwargs = mock_client.chat.completions.create.call_args[1]
        user_message = call_kwargs["messages"][0]["content"]
        assert "<document>" in user_message
        assert "Doc text" in user_message
        assert "<chunk>" in user_message
        assert "Chunk text" in user_message

    async def test_returns_none_on_failure(self):
        mock_client = AsyncMock()
        mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API error"))

        result = await generate_chunk_context(
            document_text="Doc",
            chunk_content="Chunk",
            client=mock_client,
        )

        assert result is None

    async def test_strips_whitespace_from_response(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="  Some context.  \n"))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await generate_chunk_context(
            document_text="Doc",
            chunk_content="Chunk",
            client=mock_client,
        )

        assert result == "Some context."

    async def test_returns_none_for_empty_response(self):
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content=""))]
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await generate_chunk_context(
            document_text="Doc",
            chunk_content="Chunk",
            client=mock_client,
        )

        assert result is None


class TestContextualizeChunks:
    @patch("src.contextualizer.AsyncOpenAI")
    async def test_populates_context_on_all_chunks(self, mock_openai_cls):
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Generated context."))]
        mock_openai_cls.return_value.chat.completions.create = AsyncMock(return_value=mock_response)

        chunks = [
            Chunk(content="Chunk one.", index=0, token_count=3),
            Chunk(content="Chunk two.", index=1, token_count=3),
        ]

        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 5

        result = await contextualize_chunks(chunks, "Full document text.", mock_config)

        assert len(result) == 2
        assert result[0].context == "Generated context."
        assert result[1].context == "Generated context."

    @patch("src.contextualizer.AsyncOpenAI")
    async def test_graceful_degradation_on_partial_failure(self, mock_openai_cls):
        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Rate limit")
            resp = MagicMock()
            resp.choices = [MagicMock(message=MagicMock(content="Context for chunk 2."))]
            return resp

        mock_openai_cls.return_value.chat.completions.create = AsyncMock(side_effect=side_effect)

        chunks = [
            Chunk(content="Chunk one.", index=0, token_count=3),
            Chunk(content="Chunk two.", index=1, token_count=3),
        ]

        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 1  # Sequential to control ordering

        result = await contextualize_chunks(chunks, "Doc text.", mock_config)

        assert result[0].context is None  # Failed gracefully
        assert result[1].context == "Context for chunk 2."  # Succeeded

    @patch("src.contextualizer.AsyncOpenAI")
    async def test_truncates_large_documents(self, mock_openai_cls):
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Context."))]
        mock_openai_cls.return_value.chat.completions.create = AsyncMock(return_value=mock_response)

        # Create a document that exceeds 120K tokens (~480K chars)
        large_doc = "x" * 500_000

        chunks = [Chunk(content="Small chunk.", index=0, token_count=3)]

        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 5

        await contextualize_chunks(chunks, large_doc, mock_config)

        call_kwargs = mock_openai_cls.return_value.chat.completions.create.call_args[1]
        user_message = call_kwargs["messages"][0]["content"]
        # Document should be truncated — the full message should be < 500K chars
        assert len(user_message) < 500_000

    @patch("src.contextualizer.AsyncOpenAI")
    async def test_returns_empty_list_for_no_chunks(self, mock_openai_cls):
        mock_config = MagicMock()
        mock_config.openai_api_key = "test-key"
        mock_config.contextual_model = "gpt-4o-mini"
        mock_config.contextual_concurrency = 5

        result = await contextualize_chunks([], "Doc text.", mock_config)
        assert result == []
        mock_openai_cls.assert_not_called()
