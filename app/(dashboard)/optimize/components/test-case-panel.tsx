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
import { reviewTestCase } from "../actions";
import type { OptimizePageData } from "../actions";

type FlaggedTestCase = OptimizePageData["flaggedTestCases"][number];

type TestCaseCardProps = {
  testCase: FlaggedTestCase;
};

function TestCaseCard({ testCase }: TestCaseCardProps) {
  const [isPending, startTransition] = useTransition();

  function handleReview(decision: "validated" | "rejected") {
    startTransition(async () => {
      try {
        await reviewTestCase(testCase.id, decision);
      } catch (err) {
        console.error("Failed to review test case:", err);
      }
    });
  }

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
};

export function TestCasePanel({ flaggedTestCases, flaggedCount }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Flagged Test Cases</CardTitle>
          {flaggedCount > 0 && (
            <Badge variant="destructive">{flaggedCount}</Badge>
          )}
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
              <TestCaseCard key={tc.id} testCase={tc} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
