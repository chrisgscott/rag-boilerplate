import { getOptimizePageData } from "./actions";
import { BestConfigPanel } from "./components/best-config-panel";
import { ExperimentHistoryPanel } from "./components/experiment-history-panel";
import { InsightsPanel } from "./components/insights-panel";
import { TestCasePanel } from "./components/test-case-panel";

export default async function OptimizePage() {
  const data = await getOptimizePageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Auto-Optimizer</h1>
        <p className="text-muted-foreground">
          Tune RAG pipeline configuration through iterative experiments.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BestConfigPanel bestConfig={data.bestConfig} />
        <TestCasePanel
          flaggedTestCases={data.flaggedTestCases}
          flaggedCount={data.flaggedCount}
        />
        <ExperimentHistoryPanel
          latestSessions={data.latestSessions}
          experiments={data.experiments}
        />
        <InsightsPanel insights={data.insights} />
      </div>
    </div>
  );
}
