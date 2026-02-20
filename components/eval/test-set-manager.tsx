"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  createTestSet,
  deleteTestSet,
  getTestCases,
  deleteTestCase,
  type TestSetSummary,
  type TestCaseData,
} from "@/app/(dashboard)/eval/actions";
import { TestCaseForm } from "./test-case-form";

export function TestSetManager({ testSets }: { testSets: TestSetSummary[] }) {
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCaseData[]>([]);
  const [addingCase, setAddingCase] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (expandedId) {
      getTestCases(expandedId).then(setTestCases).catch(() => setTestCases([]));
    } else {
      setTestCases([]);
    }
  }, [expandedId]);

  async function handleCreate(formData: FormData) {
    setLoading(true);
    const result = await createTestSet(formData);
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      setCreating(false);
    }
  }

  async function handleDeleteSet(id: string) {
    const result = await deleteTestSet(id);
    if (result.error) toast.error(result.error);
    if (expandedId === id) setExpandedId(null);
  }

  async function handleDeleteCase(id: string) {
    const result = await deleteTestCase(id);
    if (result.error) {
      toast.error(result.error);
    } else {
      setTestCases((prev) => prev.filter((tc) => tc.id !== id));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Test Sets</h2>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          New Test Set
        </Button>
      </div>

      {creating && (
        <form action={handleCreate} className="flex gap-2 items-end">
          <Input name="name" placeholder="Test set name" required />
          <Input name="description" placeholder="Description (optional)" />
          <Button type="submit" disabled={loading}>Create</Button>
          <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
        </form>
      )}

      {testSets.length === 0 && !creating && (
        <p className="text-center text-muted-foreground py-8">
          No test sets yet. Create one to start evaluating.
        </p>
      )}

      {testSets.map((ts) => (
        <Card key={ts.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-2 text-left"
                onClick={() => setExpandedId(expandedId === ts.id ? null : ts.id)}
              >
                {expandedId === ts.id ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-base">{ts.name}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  ({ts.caseCount} cases)
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDeleteSet(ts.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {ts.description && (
              <p className="text-sm text-muted-foreground ml-6">{ts.description}</p>
            )}
          </CardHeader>
          {expandedId === ts.id && (
            <CardContent className="space-y-3">
              {testCases.map((tc) => (
                <div
                  key={tc.id}
                  className="flex items-start justify-between border rounded p-3 text-sm"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="font-medium">{tc.question}</p>
                    {tc.expectedAnswer && (
                      <p className="text-muted-foreground truncate">
                        Expected: {tc.expectedAnswer}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteCase(tc.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {addingCase ? (
                <TestCaseForm
                  testSetId={ts.id}
                  onDone={() => {
                    setAddingCase(false);
                    getTestCases(ts.id).then(setTestCases);
                  }}
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingCase(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Test Case
                </Button>
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
