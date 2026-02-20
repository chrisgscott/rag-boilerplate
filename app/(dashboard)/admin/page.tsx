import { getDemoStatus } from "./actions";
import { DemoManager } from "@/components/admin/demo-manager";

export default async function AdminPage() {
  const status = await getDemoStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">
          Manage demo data and system configuration.
        </p>
      </div>
      <DemoManager status={status} />
    </div>
  );
}
