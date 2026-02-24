import asyncio
import io
import logging

from PIL import Image
from google import genai

from src.config import settings
from src.parser import Section

logger = logging.getLogger(__name__)

VLM_PROMPT = """You are analyzing a page from a document. Describe ALL visual elements \
(charts, diagrams, images, figures) on this page in detail.

Focus on:
- Data values, trends, and relationships shown in charts/graphs
- Labels, legends, axis titles, and annotations
- Structural relationships in diagrams or flowcharts
- Key takeaways a reader would extract from the visual

Write in plain prose suitable for text search. Do not describe decorative \
elements, page layout, or formatting. If there are no meaningful visual \
elements, respond with "NO_VISUAL_CONTENT"."""

NO_VISUAL_SENTINEL = "NO_VISUAL_CONTENT"


def get_visual_pages(doc) -> dict[int, Image.Image]:
    """Scan a Docling document for pages containing pictures. Returns {page_no: PIL.Image}."""
    if not hasattr(doc, "pictures") or not doc.pictures:
        return {}

    page_numbers: set[int] = set()
    for pic in doc.pictures:
        prov = getattr(pic, "prov", None)
        if prov and len(prov) > 0:
            page_no = getattr(prov[0], "page_no", None)
            if page_no is not None:
                page_numbers.add(page_no)

    pages: dict[int, Image.Image] = {}
    for page_no in sorted(page_numbers):
        page = doc.pages.get(page_no)
        if page and page.image and page.image.pil_image:
            pages[page_no] = page.image.pil_image

    return pages


async def describe_visual_pages(
    pages: dict[int, Image.Image],
    model: str | None = None,
    concurrency: int | None = None,
) -> dict[int, str]:
    """Send page images to Gemini concurrently. Returns {page_no: description}."""
    model = model or settings.vlm_model
    max_concurrent = concurrency or settings.vlm_concurrency
    semaphore = asyncio.Semaphore(max_concurrent)

    client = genai.Client(api_key=settings.google_api_key)

    async def describe_page(page_no: int, image: Image.Image) -> tuple[int, str | None]:
        async with semaphore:
            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=[VLM_PROMPT, image],
                )
                text = response.text.strip()
                if NO_VISUAL_SENTINEL in text:
                    logger.info(f"Page {page_no}: no meaningful visual content")
                    return page_no, None
                return page_no, text
            except Exception as e:
                logger.warning(f"VLM failed for page {page_no}: {e}")
                return page_no, None

    tasks = [describe_page(page_no, img) for page_no, img in pages.items()]
    results = await asyncio.gather(*tasks)

    return {page_no: desc for page_no, desc in results if desc is not None}


def upload_page_images(
    pages: dict[int, Image.Image],
    document_id: str,
    supabase,
) -> dict[int, str]:
    """Upload page images to Supabase Storage as WebP. Returns {page_no: storage_path}."""
    paths: dict[int, str] = {}

    for page_no, image in pages.items():
        storage_path = f"page-images/{document_id}/page-{page_no}.webp"
        try:
            buf = io.BytesIO()
            image.save(buf, format="WEBP", quality=80)
            buf.seek(0)
            supabase.storage.from_("documents").upload(
                storage_path, buf.getvalue(), {"content-type": "image/webp"}
            )
            paths[page_no] = storage_path
            logger.info(f"Uploaded page image: {storage_path}")
        except Exception as e:
            logger.warning(f"Failed to upload page {page_no} image: {e}")

    return paths


def enrich_sections(
    sections: list[Section],
    descriptions: dict[int, str],
    page_images: dict[int, str],
) -> None:
    """Append VLM descriptions to matching sections. Mutates sections in place."""
    if not descriptions:
        return

    for page_no, description in descriptions.items():
        # Find the section that contains this page
        matched = False
        for section in sections:
            if page_no in section.pages:
                section.content += f"\n\n[Visual content — page {page_no}]: {description}"
                if page_no in page_images:
                    section.page_image_paths[page_no] = page_images[page_no]
                matched = True
                break

        if not matched:
            # Create a new section for orphan visual pages
            new_section = Section(
                content=f"[Visual content — page {page_no}]: {description}",
                headers=[f"Visual Content — Page {page_no}"],
                level=1,
                pages={page_no},
                page_image_paths={page_no: page_images[page_no]} if page_no in page_images else {},
            )
            sections.append(new_section)
