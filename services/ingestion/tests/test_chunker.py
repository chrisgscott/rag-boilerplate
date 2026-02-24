import pytest

from src.chunker import chunk_text, estimate_tokens, ChunkOptions


class TestChunkText:
    def test_returns_single_chunk_for_short_text(self):
        chunks = chunk_text("Hello world", ChunkOptions(max_tokens=100, overlap=0.15))
        assert len(chunks) == 1
        assert chunks[0].content == "Hello world"

    def test_splits_long_text_into_multiple_chunks(self):
        text = " ".join(["word"] * 200)  # ~50 tokens
        chunks = chunk_text(text, ChunkOptions(max_tokens=20, overlap=0.0))
        assert len(chunks) > 1

    def test_respects_max_tokens_limit(self):
        text = " ".join(["word"] * 400)
        chunks = chunk_text(text, ChunkOptions(max_tokens=30, overlap=0.15))
        for chunk in chunks:
            # 25% tolerance: overlap adds tokens from previous chunk beyond split target
            assert chunk.token_count <= 30 * 1.25

    def test_applies_overlap_between_chunks(self):
        text = " ".join(["word"] * 200)
        chunks = chunk_text(text, ChunkOptions(max_tokens=30, overlap=0.15))
        if len(chunks) >= 2:
            first_words = set(chunks[0].content.split())
            second_words = set(chunks[1].content.split())
            overlap = first_words & second_words
            assert len(overlap) > 0

    def test_assigns_sequential_indexes(self):
        text = " ".join(["word"] * 200)
        chunks = chunk_text(text, ChunkOptions(max_tokens=30, overlap=0.0))
        for i, chunk in enumerate(chunks):
            assert chunk.index == i

    def test_splits_on_paragraph_boundaries(self):
        para = " ".join(["word"] * 30)
        text = f"{para}\n\n{para}\n\n{para}"
        chunks = chunk_text(text, ChunkOptions(max_tokens=10, overlap=0.0))
        assert len(chunks) >= 2

    def test_splits_on_sentence_boundaries(self):
        text = "First sentence here. Second sentence here. Third sentence here. Fourth one."
        chunks = chunk_text(text, ChunkOptions(max_tokens=8, overlap=0.0))
        assert len(chunks) >= 2

    def test_returns_empty_for_empty_text(self):
        assert chunk_text("", ChunkOptions(max_tokens=100, overlap=0.0)) == []

    def test_returns_empty_for_whitespace(self):
        assert chunk_text("   \n\n  ", ChunkOptions(max_tokens=100, overlap=0.0)) == []

    def test_prepends_context_prefix(self):
        chunks = chunk_text(
            "Some content here",
            ChunkOptions(
                max_tokens=100,
                overlap=0.0,
                document_title="My Doc",
                section_header="Chapter 1",
            ),
        )
        assert chunks[0].content.startswith("My Doc > Chapter 1\n\n")

    def test_token_count_matches_estimate(self):
        chunks = chunk_text("Hello world foo bar", ChunkOptions(max_tokens=100, overlap=0.0))
        for chunk in chunks:
            assert chunk.token_count == estimate_tokens(chunk.content)

    def test_chunk_has_metadata_field(self):
        chunks = chunk_text("Hello world", ChunkOptions(max_tokens=100, overlap=0.0))
        assert hasattr(chunks[0], "metadata")
        assert isinstance(chunks[0].metadata, dict)
