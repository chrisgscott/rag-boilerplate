import asyncio
import logging

from openai import AsyncOpenAI

from src.chunker import Chunk, estimate_tokens
from src.config import Settings

logger = logging.getLogger(__name__)

MAX_DOCUMENT_TOKENS = 120_000

CONTEXT_PROMPT = """\
<document>
{document_text}
</document>
Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_content}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else."""


def _truncate_document(text: str, max_tokens: int = MAX_DOCUMENT_TOKENS) -> str:
    """Truncate document text to fit within the model's context window."""
    if estimate_tokens(text) <= max_tokens:
        return text
    char_limit = max_tokens * 4
    return text[:char_limit]


async def generate_chunk_context(
    document_text: str,
    chunk_content: str,
    client: AsyncOpenAI,
    model: str = "gpt-4o-mini",
) -> str | None:
    """Generate contextual summary for a single chunk using LLM."""
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": CONTEXT_PROMPT.format(
                    document_text=document_text,
                    chunk_content=chunk_content,
                ),
            }],
            max_tokens=200,
        )
        text = (response.choices[0].message.content or "").strip()
        return text if text else None
    except Exception as e:
        logger.warning(f"Context generation failed for chunk: {e}")
        return None


async def contextualize_chunks(
    chunks: list[Chunk],
    document_text: str,
    config: Settings,
) -> list[Chunk]:
    """Generate context for all chunks concurrently. Mutates and returns chunks."""
    if not chunks:
        return chunks

    client = AsyncOpenAI(api_key=config.openai_api_key)
    semaphore = asyncio.Semaphore(config.contextual_concurrency)
    truncated_doc = _truncate_document(document_text)

    async def process_chunk(chunk: Chunk) -> None:
        async with semaphore:
            chunk.context = await generate_chunk_context(
                document_text=truncated_doc,
                chunk_content=chunk.content,
                client=client,
                model=config.contextual_model,
            )

    await asyncio.gather(*[process_chunk(c) for c in chunks])
    return chunks
