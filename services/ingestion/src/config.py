from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    database_url: str

    # OpenAI
    openai_api_key: str

    # Queue
    queue_poll_interval: int = 5
    queue_visibility_timeout: int = 300
    queue_max_retries: int = 3

    # Embedding
    embedding_model: str = "text-embedding-3-small"
    embedding_batch_size: int = 100
    embedding_dimensions: int = 1536

    # Chunking
    chunk_max_tokens: int = 512
    chunk_overlap: float = 0.15

    # VLM (optional — enables visual extraction with OpenAI vision models)
    vlm_enabled: bool = False
    vlm_model: str = "gpt-4o-mini"
    vlm_concurrency: int = 5

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
