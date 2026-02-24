import asyncio
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from PIL import Image

from src.vlm import (
    get_visual_pages,
    describe_visual_pages,
    upload_page_images,
    enrich_sections,
    VLM_PROMPT,
)
from src.parser import Section


class TestGetVisualPages:
    def test_returns_empty_for_no_pictures(self):
        doc = MagicMock()
        doc.pictures = []
        result = get_visual_pages(doc)
        assert result == {}

    def test_extracts_page_images_from_pictures(self):
        doc = MagicMock()
        pic = MagicMock()
        prov_item = MagicMock()
        prov_item.page_no = 3
        pic.prov = [prov_item]
        doc.pictures = [pic]

        page = MagicMock()
        pil_img = Image.new("RGB", (100, 100), "white")
        page.image.pil_image = pil_img
        doc.pages = {3: page}

        result = get_visual_pages(doc)
        assert 3 in result
        assert result[3] == pil_img

    def test_deduplicates_by_page(self):
        doc = MagicMock()
        pic1 = MagicMock()
        pic1.prov = [MagicMock(page_no=2)]
        pic2 = MagicMock()
        pic2.prov = [MagicMock(page_no=2)]
        doc.pictures = [pic1, pic2]

        page = MagicMock()
        page.image.pil_image = Image.new("RGB", (100, 100))
        doc.pages = {2: page}

        result = get_visual_pages(doc)
        assert len(result) == 1

    def test_skips_pages_without_images(self):
        doc = MagicMock()
        pic = MagicMock()
        pic.prov = [MagicMock(page_no=5)]
        doc.pictures = [pic]
        doc.pages = {5: MagicMock(image=None)}

        result = get_visual_pages(doc)
        assert result == {}


class TestDescribeVisualPages:
    @pytest.fixture
    def mock_openai(self):
        with patch("src.vlm.AsyncOpenAI") as mock:
            yield mock

    async def test_returns_descriptions_keyed_by_page(self, mock_openai):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="A bar chart showing quarterly revenue growth."))
        ]

        mock_openai.return_value.chat.completions.create = AsyncMock(
            return_value=mock_response
        )

        pages = {
            3: Image.new("RGB", (100, 100)),
            7: Image.new("RGB", (100, 100)),
        }

        result = await describe_visual_pages(pages)
        assert 3 in result
        assert 7 in result
        assert "bar chart" in result[3]

    async def test_filters_no_visual_content_responses(self, mock_openai):
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content="NO_VISUAL_CONTENT"))
        ]

        mock_openai.return_value.chat.completions.create = AsyncMock(
            return_value=mock_response
        )

        pages = {1: Image.new("RGB", (100, 100))}
        result = await describe_visual_pages(pages)
        assert result == {}

    async def test_skips_failed_pages(self, mock_openai):
        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Rate limit")
            resp = MagicMock()
            resp.choices = [MagicMock(message=MagicMock(content="A diagram showing workflow."))]
            return resp

        mock_openai.return_value.chat.completions.create = AsyncMock(
            side_effect=side_effect
        )

        pages = {
            1: Image.new("RGB", (100, 100)),
            2: Image.new("RGB", (100, 100)),
        }
        result = await describe_visual_pages(pages)
        # Page 1 failed, page 2 succeeded
        assert len(result) == 1
        assert 2 in result


class TestUploadPageImages:
    def test_uploads_images_as_webp(self):
        mock_supabase = MagicMock()
        mock_supabase.storage.from_.return_value.upload.return_value = None

        pages = {3: Image.new("RGB", (100, 100))}
        result = upload_page_images(pages, "doc-123", "org-abc", mock_supabase)

        assert "org-abc/page-images/doc-123/page-3.webp" in result.values()
        mock_supabase.storage.from_.assert_called_with("documents")
        call_args = mock_supabase.storage.from_.return_value.upload.call_args
        assert call_args[0][0] == "org-abc/page-images/doc-123/page-3.webp"

    def test_returns_paths_keyed_by_page(self):
        mock_supabase = MagicMock()
        mock_supabase.storage.from_.return_value.upload.return_value = None

        pages = {
            1: Image.new("RGB", (100, 100)),
            5: Image.new("RGB", (100, 100)),
        }
        result = upload_page_images(pages, "doc-456", "org-abc", mock_supabase)
        assert result[1] == "org-abc/page-images/doc-456/page-1.webp"
        assert result[5] == "org-abc/page-images/doc-456/page-5.webp"

    def test_skips_failed_uploads(self):
        mock_supabase = MagicMock()
        mock_supabase.storage.from_.return_value.upload.side_effect = Exception("Upload failed")

        pages = {3: Image.new("RGB", (100, 100))}
        result = upload_page_images(pages, "doc-789", "org-abc", mock_supabase)
        assert result == {}


class TestEnrichSections:
    def test_appends_description_to_matching_section(self):
        sections = [
            Section(content="Text about revenue.", headers=["Financials"], pages={2, 3}),
        ]
        descriptions = {3: "A bar chart showing Q4 revenue growth of 15%."}
        page_images = {3: "page-images/doc-1/page-3.webp"}

        enrich_sections(sections, descriptions, page_images)

        assert "bar chart" in sections[0].content
        assert "[Visual content — page 3]" in sections[0].content
        assert sections[0].page_image_paths[3] == "page-images/doc-1/page-3.webp"

    def test_creates_new_section_for_orphan_page(self):
        sections = [
            Section(content="Some text.", headers=["Intro"], pages={1}),
        ]
        descriptions = {5: "A flowchart showing the approval process."}
        page_images = {5: "page-images/doc-1/page-5.webp"}

        enrich_sections(sections, descriptions, page_images)

        assert len(sections) == 2
        assert "flowchart" in sections[1].content
        assert sections[1].headers == ["Visual Content — Page 5"]
        assert 5 in sections[1].pages

    def test_handles_multiple_descriptions_across_sections(self):
        sections = [
            Section(content="First section.", headers=["A"], pages={1, 2}),
            Section(content="Second section.", headers=["B"], pages={3, 4}),
        ]
        descriptions = {
            2: "Chart on page 2.",
            4: "Diagram on page 4.",
        }
        page_images = {}

        enrich_sections(sections, descriptions, page_images)

        assert "Chart on page 2" in sections[0].content
        assert "Diagram on page 4" in sections[1].content

    def test_no_op_when_no_descriptions(self):
        sections = [Section(content="Original.", headers=[], pages={1})]
        enrich_sections(sections, {}, {})
        assert sections[0].content == "Original."
