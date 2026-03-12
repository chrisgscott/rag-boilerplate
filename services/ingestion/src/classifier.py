"""
Classification Pipeline Scaffold.

Generic mechanism for classifying semantic units with AI-proposed labels.
Deployments implement BaseClassifier with their domain-specific prompt and schema.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

from src.semantic_units import SemanticUnit

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    proposed_labels: dict
    confidence: float


class BaseClassifier(ABC):
    """
    Abstract classifier that deployments implement.

    Each deployment provides its own prompt, label schema, and LLM call.
    The scaffold handles orchestration, error handling, and storage.
    """

    @abstractmethod
    async def classify(
        self,
        content: str,
        headings: list[str],
        label: str,
        document_context: dict,
    ) -> ClassificationResult:
        """Classify a semantic unit. Returns proposed labels + confidence."""
        ...


async def classify_units(
    units: list[SemanticUnit],
    classifier: BaseClassifier,
    document_context: dict,
    concurrency: int = 5,
) -> list[tuple[SemanticUnit, ClassificationResult]]:
    """
    Classify a list of semantic units using the provided classifier.

    Returns (unit, result) pairs for successful classifications only.
    Failed classifications are logged and skipped.
    """
    semaphore = asyncio.Semaphore(concurrency)
    results: list[tuple[SemanticUnit, ClassificationResult]] = []

    async def classify_one(unit: SemanticUnit) -> tuple[SemanticUnit, ClassificationResult] | None:
        async with semaphore:
            try:
                result = await classifier.classify(
                    content=unit.content,
                    headings=unit.headings,
                    label=unit.label,
                    document_context=document_context,
                )
                return (unit, result)
            except Exception as e:
                logger.warning(f"Classification failed for unit {unit.unit_index}: {e}")
                return None

    tasks = [classify_one(unit) for unit in units]
    completed = await asyncio.gather(*tasks)

    for item in completed:
        if item is not None:
            results.append(item)

    logger.info(f"Classified {len(results)}/{len(units)} units successfully")
    return results
