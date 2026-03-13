import json
import logging
import tempfile
from pathlib import Path

import psycopg2

from src.config import settings
from src.parser import parse_document, ParseResult
from src.chunker import Chunk, estimate_tokens
from src.embedder import embed_texts
from src.vlm import get_visual_pages, describe_visual_pages, upload_page_images
from src.contextualizer import contextualize_chunks
from src.semantic_units import extract_semantic_units as extract_units, SemanticUnit
from src.right_sizer import right_size_units, RightSizeOptions

logger = logging.getLogger(__name__)


def _get_db_connection():
    return psycopg2.connect(settings.database_url)


def _get_supabase():
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def update_document_status(
    document_id: str,
    status: str,
    error_message: str | None = None,
    chunk_count: int | None = None,
    parsed_content: str | None = None,
):
    supabase = _get_supabase()
    update_data: dict = {"status": status}
    if error_message is not None:
        update_data["error_message"] = error_message
    if chunk_count is not None:
        update_data["chunk_count"] = chunk_count
    if parsed_content is not None:
        update_data["parsed_content"] = parsed_content
    supabase.table("documents").update(update_data).eq("id", document_id).execute()


def build_chunks_from_semantic_units(parse_result: ParseResult, doc_name: str,
                                     vlm_page_images: dict[int, str] | None = None) -> list[Chunk]:
    """Extract semantic units from Docling document and right-size for embedding.

    Replaces the old chunk_sections() approach with structure-aware units.
    """
    semantic_units = extract_units(parse_result.docling_doc)
    right_size_opts = RightSizeOptions(
        min_tokens=settings.min_unit_tokens,
        max_tokens=settings.max_unit_tokens,
    )
    chunks = right_size_units(semantic_units, right_size_opts)

    # Enrich chunks with document name and VLM page images
    for chunk in chunks:
        chunk.metadata["document_name"] = doc_name
        # Map VLM page images by page number overlap
        if vlm_page_images:
            chunk_pages = set(chunk.metadata.get("page_numbers", []))
            page_paths = {p: path for p, path in vlm_page_images.items() if p in chunk_pages}
            if page_paths:
                chunk.metadata["page_image_paths"] = page_paths

    return chunks


def get_embedding_text(chunk: Chunk) -> str:
    """Build the text string used for embedding. Prepends context if available."""
    if chunk.context:
        return f"{chunk.context}\n\n{chunk.content}"
    return chunk.content


def upsert_chunks(
    chunks: list[Chunk],
    embeddings: list[list[float]],
    document_id: str,
    organization_id: str,
):
    supabase = _get_supabase()
    batch_size = 50

    rows = [
        {
            "document_id": document_id,
            "organization_id": organization_id,
            "content": chunk.content,
            "context": chunk.context,
            "embedding": json.dumps(embeddings[i]),
            "chunk_index": chunk.index,
            "token_count": chunk.token_count,
            "metadata": chunk.metadata,
            "label": chunk.metadata.get("label") if chunk.metadata else None,
            "headings": chunk.metadata.get("headings") if chunk.metadata else None,
        }
        for i, chunk in enumerate(chunks)
    ]

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        supabase.table("document_chunks").insert(batch).execute()


def bump_cache_version(organization_id: str):
    """Increment the org's cache_version to invalidate semantic cache."""
    conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE organizations SET cache_version = cache_version + 1 WHERE id = %s",
                (organization_id,),
            )
        conn.commit()
    finally:
        conn.close()


async def persist_docling_json(document_id: str, docling_json: dict | None) -> None:
    """Store the full DoclingDocument JSON on the document record."""
    if not settings.persist_docling_doc or docling_json is None:
        return

    supabase = _get_supabase()
    supabase.table("documents").update(
        {"docling_doc": docling_json}
    ).eq("id", document_id).execute()
    logger.info(f"Persisted DoclingDocument JSON for document {document_id}")


async def upsert_semantic_units(
    document_id: str,
    organization_id: str,
    units: list[SemanticUnit],
) -> None:
    """Store semantic units in database."""
    if not units:
        return
    supabase = _get_supabase()
    batch_size = 50
    for i in range(0, len(units), batch_size):
        batch = units[i : i + batch_size]
        rows = [
            {
                "document_id": document_id,
                "organization_id": organization_id,
                "content": u.content,
                "headings": u.headings,
                "label": u.label,
                "page_numbers": u.page_numbers,
                "unit_index": u.unit_index,
                "docling_ref": u.docling_ref,
            }
            for u in batch
        ]
        supabase.table("document_semantic_units").insert(rows).execute()


async def process_message(message: dict) -> None:
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

            # Persist DoclingDocument JSON for re-processing
            await persist_docling_json(document_id, parse_result.docling_json)

            # Extract semantic units (optional — structured extraction via HierarchicalChunker)
            if settings.populate_semantic_units_table and parse_result.docling_doc:
                units = extract_units(parse_result.docling_doc)
                await upsert_semantic_units(document_id, organization_id, units)
                logger.info(f"Stored {len(units)} semantic units for {document_id}")

            # VLM visual extraction (optional — runs when VLM_ENABLED=true)
            vlm_page_images: dict[int, str] = {}
            if settings.vlm_enabled and parse_result.docling_doc:
                visual_pages = get_visual_pages(parse_result.docling_doc)
                if visual_pages:
                    await describe_visual_pages(visual_pages)
                    vlm_page_images = upload_page_images(visual_pages, document_id, organization_id, supabase)
                    logger.info(
                        f"VLM processed {len(vlm_page_images)} pages for document {document_id}"
                    )

            # Delete existing chunks (needed for re-ingestion)
            supabase.table("document_chunks").delete().eq("document_id", document_id).execute()

            # Build chunks from semantic units (replaces chunk_sections)
            chunks = build_chunks_from_semantic_units(parse_result, doc["name"], vlm_page_images)
            if not chunks:
                raise ValueError("No chunks generated from document")

            # Contextual chunking (optional — adds LLM-generated context per chunk)
            if settings.contextual_chunking_enabled:
                chunks = await contextualize_chunks(chunks, parse_result.text, settings)

            # Embed
            embedding_result = embed_texts([get_embedding_text(c) for c in chunks])

            # Upsert to database
            upsert_chunks(
                chunks,
                embedding_result.embeddings,
                document_id,
                organization_id,
            )

            # Success
            update_document_status(
                document_id,
                "complete",
                error_message=None,
                chunk_count=len(chunks),
                parsed_content=parse_result.text,
            )

            # Invalidate semantic cache for this org
            bump_cache_version(organization_id)

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

            # Commit the read so the visibility timeout persists even if
            # processing fails — prevents infinite immediate retry loops.
            conn.commit()

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
                await process_message(message)
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
