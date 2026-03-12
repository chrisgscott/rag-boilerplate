"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reviewTestCase, generateTestSet } from "../actions";
import type { OptimizePageData } from "../actions";

type FlaggedTestCase = OptimizePageData["flaggedTestCases"][number];

type TestCaseCardProps = {
  testCase: FlaggedTestCase;
  onMutate?: () => void;
};

function TestCaseCard({ testCase, onMutate }: TestCaseCardProps) {
  const [isPending, startTransition] = useTransition();
  const [showSource, setShowSource] = useState(false);

  function handleReview(decision: "validated" | "rejected") {
    startTransition(async () => {
      try {
        await reviewTestCase(testCase.id, decision);
        onMutate?.();
      } catch (err) {
        console.error("Failed to review test case:", err);
      }
    });
  }

  const sourceContent = testCase.document_chunks?.content;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Question
          </p>
          <p className="text-sm">{testCase.question}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Expected Answer
          </p>
          <p className="text-sm">{testCase.expected_answer}</p>
        </div>
        {testCase.grounding_score !== null && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Grounding Score
            </p>
            <p className="text-sm">{testCase.grounding_score.toFixed(2)}</p>
          </div>
        )}
        {sourceContent && (
          <div>
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 hover:text-foreground transition-colors cursor-pointer"
              onClick={() => setShowSource(!showSource)}
            >
              Source Chunk {showSource ? "▾" : "▸"}
            </button>
            {showSource && (
              <div className="rounded-md border bg-muted/30 p-3 max-h-48 overflow-y-auto">
                <p className="text-xs whitespace-pre-wrap">{sourceContent}</p>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="default"
            onClick={() => handleReview("validated")}
            disabled={isPending}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleReview("rejected")}
            disabled={isPending}
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type Props = {
  flaggedTestCases: FlaggedTestCase[];
  flaggedCount: number;
  onMutate?: () => void;
};

export function TestCasePanel({ flaggedTestCases, flaggedCount, onMutate }: Props) {
  const [isGenerating, startGenerateTransition] = useTransition();
  const [generateStatus, setGenerateStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function handleGenerate() {
    setGenerateStatus("idle");
    setStatusMessage(null);
    startGenerateTransition(async () => {
      try {
        const result = await generateTestSet();
        setGenerateStatus("success");
        const parts = [`${result.validated} validated`, `${result.flagged} flagged`];
        if (result.rejected > 0) parts.push(`${result.rejected} rejected`);
        setStatusMessage(`Generated ${result.generated}: ${parts.join(", ")}`);
        onMutate?.();
      } catch (err) {
        setGenerateStatus("error");
        setStatusMessage(
          err instanceof Error ? err.message : "Failed to generate test cases"
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Flagged Test Cases</CardTitle>
            {flaggedCount > 0 && (
              <Badge variant="destructive">{flaggedCount}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            {generateStatus === "success" && (
              <span className="text-sm text-green-600">{statusMessage}</span>
            )}
            {generateStatus === "error" && (
              <span className="text-sm text-destructive">{statusMessage}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? "Generating..." : "Generate Test Cases"}
            </Button>
          </div>
        </div>
        <CardDescription>
          Auto-generated test cases awaiting human review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {flaggedTestCases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No flagged test cases to review.
          </p>
        ) : (
          <div className="space-y-3">
            {flaggedTestCases.map((tc) => (
              <TestCaseCard key={tc.id} testCase={tc} onMutate={onMutate} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
