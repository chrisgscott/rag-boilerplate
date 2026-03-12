"use client";

import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runOptimizationSession } from "../actions";
import type { OptimizationConfigRow } from "@/lib/rag/optimizer/results-log";

type Props = {
  bestConfig: OptimizationConfigRow | null;
};

export function BestConfigPanel({ bestConfig }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    startTransition(async () => {
      try {
        await runOptimizationSession();
      } catch (err) {
        console.error("Failed to start optimization session:", err);
      }
    });
  }

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
          <Button onClick={handleRun} disabled={isPending}>
            {isPending ? "Starting..." : "Run Optimization"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {bestConfig ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                Composite score:{" "}
                <span className="font-semibold text-foreground">
                  {bestConfig.composite_score !== null
                    ? bestConfig.composite_score.toFixed(4)
                    : "—"}
                </span>
              </span>
              <span>
                Last updated:{" "}
                <span className="font-semibold text-foreground">
                  {new Date(bestConfig.updated_at).toLocaleDateString()}
                </span>
              </span>
            </div>
            <pre className="rounded-md bg-muted p-4 text-xs overflow-auto max-h-64">
              {JSON.stringify(bestConfig.config, null, 2)}
            </pre>
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
