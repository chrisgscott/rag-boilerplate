"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { CumulativeInsights } from "@/lib/rag/optimizer/agent";

type Props = {
  insights: CumulativeInsights | null;
};

export function InsightsPanel({ insights }: Props) {
  const findings = insights?.knobFindings ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cumulative Insights</CardTitle>
        <CardDescription>
          Patterns learned across all optimization sessions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cumulative insights yet. Run optimization sessions to build
            insights.
          </p>
        ) : (
          <div className="space-y-4">
            {findings.map((finding, i) => (
              <div key={finding.knob}>
                {i > 0 && <Separator className="mb-4" />}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{finding.knob}</span>
                    <span className="text-xs text-muted-foreground">
                      ({finding.testedCount} test
                      {finding.testedCount !== 1 ? "s" : ""})
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {finding.finding}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
