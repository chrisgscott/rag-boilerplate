"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runOptimizationSession } from "../actions";
import type { OptimizationConfigRow } from "@/lib/rag/optimizer/results-log";
import type { BestConfigMetrics } from "../actions";

type Props = {
  bestConfig: OptimizationConfigRow | null;
  metrics: BestConfigMetrics | null;
};

function scoreColor(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.9) return "bg-green-100 text-green-800 border-green-200";
  if (pct >= 0.7) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function MetricBadge({
  label,
  score,
  max,
  format,
}: {
  label: string;
  score: number;
  max: number;
  format: "pct" | "out5";
}) {
  const display =
    format === "pct"
      ? `${Math.round(score * 100)}%`
      : `${score.toFixed(1)}/5`;
  return (
    <div className="flex flex-col items-center gap-1">
      <Badge variant="outline" className={scoreColor(score, max)}>
        {display}
      </Badge>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

const CONFIG_LABELS: Record<string, string> = {
  topK: "Chunks returned",
  model: "LLM model",
  rerankEnabled: "Reranking",
  fullTextWeight: "Keyword weight",
  semanticWeight: "Semantic weight",
  similarityThreshold: "Min similarity",
  rerankCandidateMultiplier: "Rerank candidates",
};

function formatConfigValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (key === "rerankCandidateMultiplier")
    return `${value}x over-fetch`;
  if (key === "similarityThreshold") return String(value);
  return String(value);
}

export function BestConfigPanel({ bestConfig, metrics }: Props) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "started" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleRun() {
    setStatus("idle");
    setErrorMsg(null);
    startTransition(async () => {
      try {
        await runOptimizationSession();
        setStatus("started");
      } catch (err) {
        setStatus("error");
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to start session"
        );
      }
    });
  }

  const compositeDisplay = bestConfig?.composite_score != null
    ? Math.round(bestConfig.composite_score * 100)
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Best Configuration</CardTitle>
            <CardDescription>
              The highest-scoring RAG pipeline configuration found so far.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {status === "started" && (
              <span className="text-sm text-green-600">
                Session started
              </span>
            )}
            {status === "error" && (
              <span className="text-sm text-destructive">{errorMsg}</span>
            )}
            <Button onClick={handleRun} disabled={isPending}>
              {isPending ? "Starting..." : "Run Optimization"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {bestConfig ? (
          <div className="space-y-5">
            {/* Composite score */}
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums">
                {compositeDisplay}
              </span>
              <span className="text-lg text-muted-foreground">/100</span>
              <span className="ml-auto text-xs text-muted-foreground">
                Updated {new Date(bestConfig.updated_at).toLocaleDateString()}
              </span>
            </div>

            {/* Metric badges */}
            {metrics && (
              <div className="space-y-3">
                {metrics.retrievalMetrics && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Retrieval
                    </p>
                    <div className="flex gap-4">
                      <MetricBadge
                        label="Precision"
                        score={metrics.retrievalMetrics.precisionAtK}
                        max={1}
                        format="pct"
                      />
                      <MetricBadge
                        label="Recall"
                        score={metrics.retrievalMetrics.recallAtK}
                        max={1}
                        format="pct"
                      />
                      <MetricBadge
                        label="MRR"
                        score={metrics.retrievalMetrics.mrr}
                        max={1}
                        format="pct"
                      />
                    </div>
                  </div>
                )}
                {metrics.judgeScores && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Answer Quality
                    </p>
                    <div className="flex gap-4">
                      <MetricBadge
                        label="Faithfulness"
                        score={metrics.judgeScores.faithfulness}
                        max={5}
                        format="out5"
                      />
                      <MetricBadge
                        label="Relevance"
                        score={metrics.judgeScores.relevance}
                        max={5}
                        format="out5"
                      />
                      <MetricBadge
                        label="Completeness"
                        score={metrics.judgeScores.completeness}
                        max={5}
                        format="out5"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Config settings */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                Pipeline Settings
              </p>
              <div className="rounded-md border bg-muted/30 px-3">
                {Object.entries(bestConfig.config as Record<string, unknown>).map(
                  ([key, value]) => (
                    <ConfigItem
                      key={key}
                      label={CONFIG_LABELS[key] ?? key}
                      value={formatConfigValue(key, value)}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No optimized configuration yet. Run an optimization session to get
            started.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
