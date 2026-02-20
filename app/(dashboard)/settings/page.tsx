import { getModelRates, getSystemPrompt } from "./actions";
import { ModelRatesTable } from "@/components/settings/model-rates-table";
import { SystemPromptEditor } from "@/components/settings/system-prompt-editor";

export default async function SettingsPage() {
  const [rates, systemPrompt] = await Promise.all([
    getModelRates(),
    getSystemPrompt(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage model rates and configuration.
        </p>
      </div>
      <SystemPromptEditor initialPrompt={systemPrompt} />
      <ModelRatesTable rates={rates} />
    </div>
  );
}
