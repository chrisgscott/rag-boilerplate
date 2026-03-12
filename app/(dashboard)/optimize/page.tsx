import { getOptimizePageData } from "./actions";
import { OptimizeDashboard } from "./components/optimize-dashboard";

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

      <OptimizeDashboard initialData={data} />
    </div>
  );
}
