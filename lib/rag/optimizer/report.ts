import type { ExperimentConfig, ConfigDiff } from "./config";
import { configDiff } from "./config";
import type { CorpusFingerprint } from "./corpus";
import type { CumulativeInsights } from "./agent";

type ExperimentSummary = {
  index: number;
  knob: string;
  valueTested: string | number | boolean;
  delta: number;
  status: "kept" | "discarded" | "error";
  reasoning: string | null;
};

type ReportParams = {
  baselineConfig: ExperimentConfig;
  finalConfig: ExperimentConfig;
  baselineScore: number;
  bestScore: number;
  experiments: ExperimentSummary[];
  corpusFingerprint: CorpusFingerprint;
};

export function generateSessionReport(params: ReportParams): string {
  const { baselineConfig, finalConfig, baselineScore, bestScore, experiments, corpusFingerprint } = params;
  const diff = configDiff(baselineConfig, finalConfig);
  const keptCount = experiments.filter((e) => e.status === "kept").length;
  const discardedCount = experiments.filter((e) => e.status === "discarded").length;

  let md = `# Optimization Session Report\n\n`;
  md += `**Corpus:** ${corpusFingerprint.docCount} docs, ${corpusFingerprint.chunkCount} chunks\n`;
  md += `**Baseline score:** ${baselineScore.toFixed(4)}\n`;
  md += `**Best score:** ${bestScore.toFixed(4)} (${bestScore > baselineScore ? "+" : ""}${(bestScore - baselineScore).toFixed(4)})\n`;
  md += `**Experiments:** ${experiments.length} total (${keptCount} kept, ${discardedCount} discarded)\n\n`;

  if (Object.keys(diff).length > 0) {
    md += `## Config Changes\n`;
    for (const [key, entry] of Object.entries(diff)) {
      md += `- **${key}:** ${entry!.before} → ${entry!.after}\n`;
    }
    md += "\n";
  }

  md += `## Experiment Log\n\n`;
  md += `| # | Knob | Value | Delta | Status | Reasoning |\n`;
  md += `|---|------|-------|-------|--------|----------|\n`;
  for (const exp of experiments) {
    md += `| ${exp.index} | ${exp.knob} | ${exp.valueTested} | ${exp.delta >= 0 ? "+" : ""}${exp.delta.toFixed(4)} | ${exp.status} | ${exp.reasoning ?? "-"} |\n`;
  }

  return md;
}

type HistoryEntry = {
  knob: string;
  delta: number;
  status: "kept" | "discarded" | "error";
  corpusFingerprint: CorpusFingerprint | null;
};

export function buildInsightsFromHistory(
  experiments: HistoryEntry[],
  existingInsights: CumulativeInsights | null
): CumulativeInsights {
  // Group experiments by knob
  const byKnob = new Map<string, HistoryEntry[]>();
  for (const exp of experiments) {
    const list = byKnob.get(exp.knob) ?? [];
    list.push(exp);
    byKnob.set(exp.knob, list);
  }

  // Merge with existing insights
  const existingMap = new Map(
    (existingInsights?.knobFindings ?? []).map((f) => [f.knob, f])
  );

  for (const [knob, exps] of byKnob) {
    const kept = exps.filter((e) => e.status === "kept");
    const discarded = exps.filter((e) => e.status === "discarded");
    const existing = existingMap.get(knob);
    const totalTested = (existing?.testedCount ?? 0) + exps.length;
    const lastCorpus = exps[exps.length - 1]?.corpusFingerprint;

    let finding: string;
    if (kept.length > 0) {
      const avgDelta = kept.reduce((sum, e) => sum + e.delta, 0) / kept.length;
      finding = `Beneficial (avg delta +${avgDelta.toFixed(4)})${lastCorpus ? ` at ${lastCorpus.chunkCount} chunks` : ""}`;
    } else if (discarded.length === exps.length) {
      finding = `Not beneficial${lastCorpus ? ` at ${lastCorpus.chunkCount} chunks` : ""}`;
    } else {
      finding = existing?.finding ?? "Inconclusive";
    }

    existingMap.set(knob, { knob, finding, testedCount: totalTested });
  }

  return { knobFindings: Array.from(existingMap.values()) };
}
