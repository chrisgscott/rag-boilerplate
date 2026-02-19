import json
import logging
import tempfile
from pathlib import Path

import psycopg2

from src.config import settings
from src.parser import parse_document, ParseResult
from src.chunker import chunk_text, ChunkOptions, Chunk
from src.embedder import embed_texts

logger = logging.getLogger(__name__)


def _get_db_connection():
    return psycopg2.connect(settings.database_url)


def _get_supabase():
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def update_document_status(
    document_id: str, status: str, error_message: str | None = None, chunk_count: int | None = None
):
    supabase = _get_supabase()
    update_data: dict = {"status": status}
    if error_message is not None:
        update_data["error_message"] = error_message
    if chunk_count is not None:
        update_data["chunk_count"] = chunk_count
    supabase.table("documents").update(update_data).eq("id", document_id).execute()


def chunk_sections(parse_result: ParseResult, doc_name: str) -> list[Chunk]:
    """Chunk each section separately with header context."""
    all_chunks: list[Chunk] = []
    for section in parse_result.sections:
        section_chunks = chunk_text(
            section.content,
            ChunkOptions(
                max_tokens=settings.chunk_max_tokens,
                overlap=settings.chunk_overlap,
                document_title=doc_name,
                section_header=" > ".join(section.headers) if section.headers else None,
            ),
        )
        all_chunks.extend(section_chunks)

    # Re-index sequentially across all sections
    for i, chunk in enumerate(all_chunks):
        chunk.index = i

    return all_chunks


def upsert_chunks(
    chunks: list[Chunk],
    embeddings: list[list[float]],
    document_id: str,
    organization_id: str,
    doc_name: str,
):
    supabase = _get_supabase()
    batch_size = 50

    rows = [
        {
            "document_id": document_id,
            "organization_id": organization_id,
            "content": chunk.content,
            "embedding": json.dumps(embeddings[i]),
            "chunk_index": chunk.index,
            "token_count": chunk.token_count,
            "metadata": {"document_name": doc_name},
        }
        for i, chunk in enumerate(chunks)
    ]

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        supabase.table("document_chunks").insert(batch).execute()


def process_message(message: dict) -> None:
    """Process a single ingestion job message."""
    document_id = message["document_id"]
    organization_id = message["organization_id"]

    # Set status to processing
    update_document_status(document_id, "processing")

    try:
        # Fetch document record (using service role key — bypasses RLS)
        supabase = _get_supabase()
        doc_response = (
            supabase.table("documents").select("*").eq("id", document_id).single().execute()
        )
        doc = doc_response.data

        # Download file from storage
        file_bytes = supabase.storage.from_("documents").download(doc["storage_path"])

        # Write to temp file for Docling
        suffix = Path(doc["name"]).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        try:
            # Parse with Docling
            parse_result = parse_document(tmp_path, doc["mime_type"])

            # Chunk sections
            chunks = chunk_sections(parse_result, doc["name"])
            if not chunks:
                raise ValueError("No chunks generated from document")

            # Embed
            embedding_result = embed_texts([c.content for c in chunks])

            # Upsert to database
            upsert_chunks(
                chunks,
                embedding_result.embeddings,
                document_id,
                organization_id,
                doc["name"],
            )

            # Success
            update_document_status(
                document_id, "complete", error_message=None, chunk_count=len(chunks)
            )
            logger.info(
                f"Document {document_id} processed: {len(chunks)} chunks, "
                f"{embedding_result.token_count} tokens"
            )
        finally:
            tmp_path.unlink(missing_ok=True)

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Ingestion failed for {document_id}: {error_msg}")
        update_document_status(document_id, "error", error_message=error_msg)
        raise  # Re-raise so the queue handler knows it failed


async def process_next_job() -> bool:
    """Poll the queue for the next job. Returns True if a job was processed."""
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            # Read one message with visibility timeout
            cur.execute(
                "SELECT * FROM pgmq.read(%s, %s, %s)",
                ("ingestion_jobs", settings.queue_visibility_timeout, 1),
            )
            row = cur.fetchone()

            if not row:
                return False

            # pgmq.read returns (msg_id, read_ct, enqueued_at, vt, message)
            msg_id = row[0]
            read_ct = row[1]
            message = row[4] if isinstance(row[4], dict) else json.loads(row[4])

            logger.info(f"Processing job {msg_id} (attempt {read_ct}): {message}")

            # Check retry limit
            if read_ct > settings.queue_max_retries:
                logger.warning(
                    f"Message {msg_id} exceeded max retries ({read_ct}), moving to DLQ"
                )
                cur.execute(
                    "SELECT pgmq.send(%s, %s::jsonb)",
                    ("ingestion_jobs_dlq", json.dumps(message)),
                )
                cur.execute(
                    "SELECT pgmq.delete(%s, %s)",
                    ("ingestion_jobs", msg_id),
                )
                conn.commit()
                update_document_status(
                    message["document_id"],
                    "error",
                    error_message=f"Failed after {settings.queue_max_retries} retries",
                )
                return True

            try:
                process_message(message)
                # Archive on success
                cur.execute(
                    "SELECT pgmq.archive(%s, %s)",
                    ("ingestion_jobs", msg_id),
                )
                conn.commit()
                logger.info(f"Job {msg_id} completed and archived")
            except Exception as e:
                logger.error(f"Job {msg_id} failed: {e}")
                conn.rollback()
                # Message will become visible again after visibility timeout

            return True
    finally:
        conn.close()
