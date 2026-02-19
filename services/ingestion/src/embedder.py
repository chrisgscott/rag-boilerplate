from dataclasses import dataclass, field

from src.config import settings

BATCH_SIZE = settings.embedding_batch_size
MODEL = settings.embedding_model


@dataclass
class EmbeddingResult:
    embeddings: list[list[float]] = field(default_factory=list)
    token_count: int = 0


_client = None


def get_embedding_client():
    global _client
    if _client is None:
        import openai

        _client = openai.OpenAI().embeddings
    return _client


def set_embedding_client(client) -> None:
    global _client
    _client = client


def embed_texts(texts: list[str]) -> EmbeddingResult:
    if not texts:
        return EmbeddingResult()

    client = get_embedding_client()
    all_embeddings: list[list[float]] = []
    total_tokens = 0

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        response = client.create(model=MODEL, input=batch)

        sorted_data = sorted(response.data, key=lambda x: x.index)
        for item in sorted_data:
            all_embeddings.append(item.embedding)
        total_tokens += response.usage.prompt_tokens

    return EmbeddingResult(embeddings=all_embeddings, token_count=total_tokens)
