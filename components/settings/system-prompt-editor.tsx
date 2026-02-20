"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateSystemPrompt } from "@/app/(dashboard)/settings/actions";

export function SystemPromptEditor({
  initialPrompt,
}: {
  initialPrompt: string | null;
}) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(false);
    startTransition(async () => {
      const result = await updateSystemPrompt(prompt || null);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  };

  const handleReset = () => {
    setPrompt("");
    startTransition(async () => {
      await updateSystemPrompt(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">System Prompt</h2>
        <p className="text-sm text-muted-foreground">
          Customize the AI assistant&apos;s persona and domain expertise. Leave
          empty to use the default generic prompt.
        </p>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="You are a helpful assistant that answers questions based on the provided documents."
        rows={6}
        className="font-mono text-sm"
      />
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={isPending}>
          Reset to Default
        </Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>
    </div>
  );
}
