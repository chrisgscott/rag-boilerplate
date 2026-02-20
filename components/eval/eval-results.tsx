"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvalResultSummary } from "@/app/(dashboard)/eval/actions";

function ScoreBadge({
  score,
  target,
  label,
}: {
  score: number | null;
  target: number;
  label: string;
}) {
  if (score === null) return <span className="text-muted-foreground">--</span>;
  const pass = score >= target;
  return (
    <Badge variant={pass ? "default" : "destructive"} className="font-mono">
      {label}: {score.toFixed(2)}
    </Badge>
  );
}

function QualityScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">--</span>;
  return <span className="font-mono">{score.toFixed(1)}/5</span>;
}

function StatusBadge({ status }: { status: string }) {
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

export function EvalResults({ results }: { results: EvalResultSummary[] }) {
  if (results.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No evaluation results yet. Run an evaluation to see results here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Test Set</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Retrieval</TableHead>
          <TableHead>Answer Quality</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.testSetName}</TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <ScoreBadge score={r.precisionAtK} target={0.8} label="P@k" />
                <ScoreBadge score={r.recallAtK} target={0.75} label="R@k" />
                <ScoreBadge score={r.mrr} target={0.7} label="MRR" />
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-3 text-sm">
                <span>F: <QualityScore score={r.avgFaithfulness} /></span>
                <span>R: <QualityScore score={r.avgRelevance} /></span>
                <span>C: <QualityScore score={r.avgCompleteness} /></span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(r.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
