import { getModelRates, getSystemPrompt, getApiKeys } from "./actions";
import { ModelRatesTable } from "@/components/settings/model-rates-table";
import { SystemPromptEditor } from "@/components/settings/system-prompt-editor";
import { ApiKeysSection } from "@/components/settings/api-keys-section";

export default async function SettingsPage() {
  const [rates, systemPrompt, apiKeys] = await Promise.all([
    getModelRates(),
    getSystemPrompt(),
    getApiKeys(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage model rates and configuration.
        </p>
      </div>
      <ApiKeysSection keys={apiKeys} />
      <SystemPromptEditor initialPrompt={systemPrompt} />
      <ModelRatesTable rates={rates} />
    </div>
  );
}
