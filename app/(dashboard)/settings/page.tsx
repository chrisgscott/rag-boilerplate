import { getModelRates } from "./actions";
import { ModelRatesTable } from "@/components/settings/model-rates-table";

export default async function SettingsPage() {
  const rates = await getModelRates();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage model rates and configuration.
        </p>
      </div>
      <ModelRatesTable rates={rates} />
    </div>
  );
}
