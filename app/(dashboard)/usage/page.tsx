import { getUsageSummary, getRecentUsage } from "./actions";
import { UsageDashboard } from "@/components/usage/usage-dashboard";
import { UsageTable } from "@/components/usage/usage-table";

export default async function UsagePage() {
  const [summary, logs] = await Promise.all([
    getUsageSummary(),
    getRecentUsage(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
        <p className="text-muted-foreground">
          Track query costs and token usage.
        </p>
      </div>
      <UsageDashboard summary={summary} />
      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Queries</h2>
        <UsageTable logs={logs} />
      </div>
    </div>
  );
}
