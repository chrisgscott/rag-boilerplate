/**
 * Precision@k: What fraction of retrieved documents are relevant?
 */
export function precisionAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  if (retrievedDocIds.length === 0) return 0;
  const expectedSet = new Set(expectedDocIds);
  const relevant = retrievedDocIds.filter((id) => expectedSet.has(id)).length;
  return relevant / retrievedDocIds.length;
}

/**
 * Recall@k: What fraction of expected documents were retrieved?
 */
export function recallAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  if (expectedDocIds.length === 0) return 0;
  const retrievedSet = new Set(retrievedDocIds);
  const found = expectedDocIds.filter((id) => retrievedSet.has(id)).length;
  return found / expectedDocIds.length;
}

/**
 * Mean Reciprocal Rank: 1/rank of first relevant result.
 */
export function meanReciprocalRank(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  const expectedSet = new Set(expectedDocIds);
  for (let i = 0; i < retrievedDocIds.length; i++) {
    if (expectedSet.has(retrievedDocIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export type RetrievalMetrics = {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
};

/**
 * Aggregate metrics across multiple test cases by averaging.
 */
export function aggregateMetrics(
  perCase: RetrievalMetrics[]
): RetrievalMetrics {
  if (perCase.length === 0) {
    return { precisionAtK: 0, recallAtK: 0, mrr: 0 };
  }

  const sum = perCase.reduce(
    (acc, m) => ({
      precisionAtK: acc.precisionAtK + m.precisionAtK,
      recallAtK: acc.recallAtK + m.recallAtK,
      mrr: acc.mrr + m.mrr,
    }),
    { precisionAtK: 0, recallAtK: 0, mrr: 0 }
  );

  return {
    precisionAtK: sum.precisionAtK / perCase.length,
    recallAtK: sum.recallAtK / perCase.length,
    mrr: sum.mrr / perCase.length,
  };
}
