import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.config import settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

worker_task: asyncio.Task | None = None


async def poll_queue():
    """Main worker loop — polls pgmq for ingestion jobs."""
    from src.worker import process_next_job

    while True:
        try:
            processed = await process_next_job()
            if not processed:
                await asyncio.sleep(settings.queue_poll_interval)
        except Exception as e:
            logger.error(f"Worker error: {e}")
            await asyncio.sleep(settings.queue_poll_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker_task
    logger.info("Starting ingestion worker...")
    worker_task = asyncio.create_task(poll_queue())
    yield
    logger.info("Shutting down ingestion worker...")
    if worker_task:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="RAG Ingestion Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "queue": "ingestion_jobs"}
