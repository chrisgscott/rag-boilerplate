"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runEval, type TestSetSummary } from "@/app/(dashboard)/eval/actions";

export function EvalRunner({ testSets }: { testSets: TestSetSummary[] }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [running, setRunning] = useState(false);

  async function handleRun() {
    if (!selectedId) {
      toast.error("Select a test set first");
      return;
    }

    setRunning(true);
    const result = await runEval(selectedId);
    setRunning(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Evaluation complete! Check the Results tab.");
    }
  }

  if (testSets.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        Create a test set first, then come back to run an evaluation.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Evaluation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-4">
          <div className="flex-1 max-w-sm">
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a test set" />
              </SelectTrigger>
              <SelectContent>
                {testSets.map((ts) => (
                  <SelectItem key={ts.id} value={ts.id}>
                    {ts.name} ({ts.caseCount} cases)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleRun} disabled={running || !selectedId}>
            {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {running ? "Running..." : "Run Evaluation"}
          </Button>
        </div>
        {running && (
          <p className="text-sm text-muted-foreground">
            Running retrieval + answer quality evaluation. This may take a minute...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
