import pytest
from src.classifier import BaseClassifier, ClassificationResult, classify_units
from src.semantic_units import SemanticUnit


class MockClassifier(BaseClassifier):
    async def classify(self, content, headings, label, document_context):
        return ClassificationResult(
            proposed_labels={"section": "PAST_PERFORMANCE", "category": "SDA"},
            confidence=0.92,
        )


def test_classification_result_fields():
    result = ClassificationResult(proposed_labels={"a": "b"}, confidence=0.5)
    assert result.proposed_labels == {"a": "b"}
    assert result.confidence == 0.5


@pytest.mark.asyncio
async def test_classify_units_calls_classifier_for_each_unit():
    classifier = MockClassifier()
    units = [
        SemanticUnit(content="Past perf text", headings=["PP"], label="paragraph", unit_index=0),
        SemanticUnit(content="Table data", headings=["Tables"], label="table", unit_index=1),
    ]
    results = await classify_units(units, classifier, document_context={})
    assert len(results) == 2
    assert results[0][1].proposed_labels["section"] == "PAST_PERFORMANCE"


@pytest.mark.asyncio
async def test_classify_units_handles_classifier_errors():
    """If classifier raises on one unit, others still succeed."""

    class FailingClassifier(BaseClassifier):
        call_count = 0

        async def classify(self, content, headings, label, document_context):
            self.call_count += 1
            if self.call_count == 1:
                raise ValueError("API error")
            return ClassificationResult(proposed_labels={"ok": True}, confidence=0.8)

    classifier = FailingClassifier()
    units = [
        SemanticUnit(content="fail", headings=[], label="paragraph", unit_index=0),
        SemanticUnit(content="succeed", headings=[], label="paragraph", unit_index=1),
    ]
    results = await classify_units(units, classifier, document_context={})
    assert len(results) == 1  # Only the successful one
