"use client";

import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cancelOptimizationSession } from "../actions";
import type {
  OptimizationRunRow,
  OptimizationExperimentRow,
  RunStatus,
  ExperimentStatus,
} from "@/lib/rag/optimizer/results-log";

type Props = {
  latestSessions: OptimizationRunRow[];
  experiments: OptimizationExperimentRow[];
};

function RunStatusBadge({ status }: { status: RunStatus }) {
  const variant =
    status === "complete"
      ? "default"
      : status === "running"
        ? "secondary"
        : status === "error"
          ? "destructive"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function ExperimentStatusBadge({ status }: { status: ExperimentStatus }) {
  if (status === "kept") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        kept
      </Badge>
    );
  }
  if (status === "error") {
    return <Badge variant="secondary">error</Badge>;
  }
  return <Badge variant="destructive">discarded</Badge>;
}

function formatDelta(delta: number): { text: string; className: string } {
  const pts = delta * 100;
  const sign = pts >= 0 ? "+" : "";
  return {
    text: `${sign}${pts.toFixed(1)}`,
    className: pts >= 0 ? "text-green-600 font-medium" : "text-red-600",
  };
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

function formatValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (key === "rerankCandidateMultiplier") return `${value}x`;
  return String(value);
}

function formatConfigDelta(delta: Record<string, unknown>): string {
  const entries = Object.entries(delta);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, v]) => {
      const label = CONFIG_LABELS[key] ?? key;
      const change = v as { before?: unknown; after?: unknown };
      if (change && typeof change === "object" && "before" in change && "after" in change) {
        return `${label}: ${formatValue(key, change.before)} → ${formatValue(key, change.after)}`;
      }
      return `${label}: ${JSON.stringify(v)}`;
    })
    .join(", ");
}

function CancelButton({ runId }: { runId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleCancel() {
    startTransition(async () => {
      try {
        await cancelOptimizationSession(runId);
      } catch (err) {
        console.error("Failed to cancel session:", err);
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCancel}
      disabled={isPending}
      className="text-destructive hover:text-destructive"
    >
      {isPending ? "Cancelling..." : "Cancel"}
    </Button>
  );
}

export function ExperimentHistoryPanel({ latestSessions, experiments }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Experiment History</CardTitle>
        <CardDescription>
          Recent optimization sessions and their experiments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {latestSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No optimization sessions yet.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Experiments</TableHead>
                  <TableHead>Baseline</TableHead>
                  <TableHead>Best</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestSessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <RunStatusBadge status={session.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(session.started_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{session.experiments_run}</TableCell>
                    <TableCell>
                      {session.baseline_score !== null
                        ? Math.round(session.baseline_score * 100)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {session.best_score !== null
                        ? Math.round(session.best_score * 100)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {(session.status === "running" ||
                        session.status === "pending") && (
                        <CancelButton runId={session.id} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {experiments.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">
                  Latest Session Experiments
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Config Change</TableHead>
                      <TableHead>Delta</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {experiments.map((exp) => {
                      const { text, className } = formatDelta(exp.delta);
                      return (
                        <TableRow key={exp.id}>
                          <TableCell className="text-sm">
                            {exp.experiment_index + 1}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatConfigDelta(exp.config_delta)}
                          </TableCell>
                          <TableCell className={`text-sm ${className}`}>
                            {text}
                          </TableCell>
                          <TableCell>
                            <ExperimentStatusBadge status={exp.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
