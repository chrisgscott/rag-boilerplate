import pytest

from src.embedder import embed_texts, EmbeddingResult, set_embedding_client


class MockEmbedding:
    def __init__(self, embedding: list[float], index: int):
        self.embedding = embedding
        self.index = index


class MockUsage:
    def __init__(self, prompt_tokens: int, total_tokens: int):
        self.prompt_tokens = prompt_tokens
        self.total_tokens = total_tokens


class MockEmbeddingResponse:
    def __init__(self, data: list[MockEmbedding], usage: MockUsage):
        self.data = data
        self.usage = usage


class MockEmbeddingClient:
    """Mock OpenAI embeddings client for testing (matches SDK interface)."""

    def __init__(self):
        self.calls: list[dict] = []

    def create(self, *, model: str, input: list[str]) -> MockEmbeddingResponse:
        self.calls.append({"model": model, "input": input})
        return MockEmbeddingResponse(
            data=[MockEmbedding([0.1] * 1536, i) for i in range(len(input))],
            usage=MockUsage(prompt_tokens=len(input) * 10, total_tokens=len(input) * 10),
        )


@pytest.fixture(autouse=True)
def mock_client():
    client = MockEmbeddingClient()
    set_embedding_client(client)
    yield client
    set_embedding_client(None)


class TestEmbedTexts:
    def test_returns_embeddings_for_batch(self, mock_client):
        result = embed_texts(["hello", "world"])
        assert len(result.embeddings) == 2
        assert len(result.embeddings[0]) == 1536

    def test_uses_correct_model(self, mock_client):
        embed_texts(["test"])
        assert mock_client.calls[0]["model"] == "text-embedding-3-small"

    def test_splits_large_batches(self, mock_client):
        texts = [f"text {i}" for i in range(150)]
        result = embed_texts(texts)
        assert len(result.embeddings) == 150
        assert len(mock_client.calls) == 2  # 100 + 50

    def test_returns_empty_for_empty_input(self, mock_client):
        result = embed_texts([])
        assert result.embeddings == []
        assert result.token_count == 0
        assert len(mock_client.calls) == 0

    def test_tracks_token_count(self, mock_client):
        result = embed_texts(["hello", "world"])
        assert result.token_count == 20  # 2 texts * 10 tokens each

    def test_propagates_errors(self, mock_client):
        def raise_error(**kwargs):
            raise Exception("API error")

        mock_client.create = raise_error
        with pytest.raises(Exception, match="API error"):
            embed_texts(["hello"])
