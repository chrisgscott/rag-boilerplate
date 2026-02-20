"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createTestCase } from "@/app/(dashboard)/eval/actions";
import { toast } from "sonner";

export function TestCaseForm({
  testSetId,
  onDone,
}: {
  testSetId: string;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    formData.set("test_set_id", testSetId);
    const result = await createTestCase(formData);
    setLoading(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Test case added");
      onDone();
    }
  }

  return (
    <form action={handleSubmit} className="space-y-3 border rounded-lg p-4">
      <div>
        <Label htmlFor="question">Question</Label>
        <Input id="question" name="question" placeholder="What is the pet policy?" required />
      </div>
      <div>
        <Label htmlFor="expected_answer">Expected Answer</Label>
        <Textarea
          id="expected_answer"
          name="expected_answer"
          placeholder="Optional — required for answer quality evaluation"
        />
      </div>
      <div>
        <Label htmlFor="expected_source_ids">Expected Source Document IDs</Label>
        <Input
          id="expected_source_ids"
          name="expected_source_ids"
          placeholder="Comma-separated UUIDs (optional)"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? "Adding..." : "Add Test Case"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
