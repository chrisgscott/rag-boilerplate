"use client";

import { useEffect, useState, useCallback } from "react";
import { BestConfigPanel } from "./best-config-panel";
import { ExperimentHistoryPanel } from "./experiment-history-panel";
import { InsightsPanel } from "./insights-panel";
import { TestCasePanel } from "./test-case-panel";
import type { OptimizePageData } from "../actions";
import { getOptimizePageData } from "../actions";

const POLL_INTERVAL_MS = 5_000;

type Props = {
  initialData: OptimizePageData;
};

export function OptimizeDashboard({ initialData }: Props) {
  const [data, setData] = useState(initialData);

  const hasActiveSession = data.latestSessions.some(
    (s) => s.status === "pending" || s.status === "running"
  );

  const refresh = useCallback(async () => {
    try {
      const fresh = await getOptimizePageData();
      setData(fresh);
    } catch {
      // Silently ignore — will retry on next interval
    }
  }, []);

  useEffect(() => {
    if (!hasActiveSession) return;

    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasActiveSession, refresh]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <BestConfigPanel bestConfig={data.bestConfig} metrics={data.bestConfigMetrics} />
      <TestCasePanel
        flaggedTestCases={data.flaggedTestCases}
        flaggedCount={data.flaggedCount}
        onMutate={refresh}
      />
      <ExperimentHistoryPanel
        latestSessions={data.latestSessions}
        experiments={data.experiments}
      />
      <InsightsPanel insights={data.insights} />
    </div>
  );
}
