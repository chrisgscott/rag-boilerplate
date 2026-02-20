"use client";

import { Fragment, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EvalResultSummary } from "@/app/(dashboard)/eval/actions";
import type { PerCaseResult } from "@/lib/rag/eval-runner";
import { getEvalResultDetail } from "@/app/(dashboard)/eval/actions";

function ScoreBadge({
  score,
  target,
  label,
  tooltip,
}: {
  score: number | null;
  target: number;
  label: string;
  tooltip: string;
}) {
  if (score === null) return <span className="text-muted-foreground">--</span>;
  const pass = score >= target;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={pass ? "default" : "destructive"} className="font-mono cursor-help">
          {label}: {score.toFixed(2)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function QualityScore({
  score,
  label,
  tooltip,
}: {
  score: number | null;
  label: string;
  tooltip: string;
}) {
  if (score === null) return <span className="text-muted-foreground">--</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">
          {label}: <span className="font-mono">{score.toFixed(1)}/5</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
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

function ExpandableText({ text, maxLength = 120 }: { text: string; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxLength) return <span>{text}</span>;
  return (
    <div>
      {expanded ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      ) : (
        <span>{text.slice(0, maxLength) + "..."}</span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="ml-1 text-xs text-primary underline"
      >
        {expanded ? "less" : "more"}
      </button>
    </div>
  );
}

function RetrievalScores({ precisionAtK, recallAtK, mrr }: { precisionAtK: number | null; recallAtK: number | null; mrr: number | null }) {
  return (
    <div className="flex flex-wrap gap-1">
      <ScoreBadge score={precisionAtK} target={0.8} label="P@k" tooltip="Precision at K — fraction of retrieved documents that are relevant" />
      <ScoreBadge score={recallAtK} target={0.75} label="R@k" tooltip="Recall at K — fraction of expected documents that were retrieved" />
      <ScoreBadge score={mrr} target={0.7} label="MRR" tooltip="Mean Reciprocal Rank — how high the first relevant document appears" />
    </div>
  );
}

function AnswerQualityScores({ faithfulness, relevance, completeness }: { faithfulness: number | null; relevance: number | null; completeness: number | null }) {
  return (
    <div className="grid gap-1 text-sm">
      <QualityScore score={faithfulness} label="F" tooltip="Faithfulness — is the answer supported by the retrieved sources?" />
      <QualityScore score={relevance} label="R" tooltip="Relevance — does the answer address the question asked?" />
      <QualityScore score={completeness} label="C" tooltip="Completeness — does the answer cover all key points?" />
    </div>
  );
}

function PerCaseTable({ cases }: { cases: PerCaseResult[] }) {
  return (
    <div className="px-4 pb-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Question</TableHead>
            <TableHead className="w-[250px]">Expected Answer</TableHead>
            <TableHead className="w-[250px]">Generated Answer</TableHead>
            <TableHead>Retrieval</TableHead>
            <TableHead>Answer Quality</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((c, i) => (
            <TableRow key={c.testCaseId || i}>
              <TableCell className="align-top text-sm">
                <ExpandableText text={c.question} />
              </TableCell>
              <TableCell className="align-top text-sm">
                {c.expectedAnswer ? (
                  <ExpandableText text={c.expectedAnswer} />
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
              <TableCell className="align-top text-sm">
                {c.generatedAnswer ? (
                  <ExpandableText text={c.generatedAnswer} />
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <RetrievalScores precisionAtK={c.precisionAtK} recallAtK={c.recallAtK} mrr={c.mrr} />
              </TableCell>
              <TableCell className="align-top">
                {c.judgeScores ? (
                  <AnswerQualityScores faithfulness={c.judgeScores.faithfulness} relevance={c.judgeScores.relevance} completeness={c.judgeScores.completeness} />
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EvalResults({ results }: { results: EvalResultSummary[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, PerCaseResult[]>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  if (results.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No evaluation results yet. Run an evaluation to see results here.
      </p>
    );
  }

  function handleRowClick(resultId: string) {
    if (expandedId === resultId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(resultId);

    if (!detailCache[resultId]) {
      startTransition(async () => {
        try {
          const detail = await getEvalResultDetail(resultId);
          setDetailCache((prev) => ({ ...prev, [resultId]: detail }));
        } catch {
          setDetailErrors((prev) => ({ ...prev, [resultId]: "Failed to load details" }));
        }
      });
    }
  }

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Test Set</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Retrieval</TableHead>
            <TableHead>Answer Quality</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => (
            <Fragment key={r.id}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleRowClick(r.id)}
              >
                <TableCell className="w-8 px-2">
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${expandedId === r.id ? "rotate-90" : ""}`}
                  />
                </TableCell>
                <TableCell className="font-medium">{r.testSetName}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>
                  <RetrievalScores precisionAtK={r.precisionAtK} recallAtK={r.recallAtK} mrr={r.mrr} />
                </TableCell>
                <TableCell>
                  <AnswerQualityScores faithfulness={r.avgFaithfulness} relevance={r.avgRelevance} completeness={r.avgCompleteness} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
              {expandedId === r.id && (
                <TableRow>
                  <TableCell colSpan={6} className="p-0 bg-muted/30">
                    {detailErrors[r.id] ? (
                      <p className="p-4 text-sm text-destructive">{detailErrors[r.id]}</p>
                    ) : isPending && !detailCache[r.id] ? (
                      <p className="p-4 text-sm text-muted-foreground">Loading details...</p>
                    ) : detailCache[r.id] ? (
                      <PerCaseTable cases={detailCache[r.id]} />
                    ) : null}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
