"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const sign = delta >= 0 ? "+" : "";
  return {
    text: `${sign}${delta.toFixed(4)}`,
    className: delta >= 0 ? "text-green-600 font-medium" : "text-red-600",
  };
}

function formatConfigDelta(delta: Record<string, unknown>): string {
  const entries = Object.entries(delta);
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
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
                        ? session.baseline_score.toFixed(4)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {session.best_score !== null
                        ? session.best_score.toFixed(4)
                        : "—"}
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
                          <TableCell className="text-sm font-mono">
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
