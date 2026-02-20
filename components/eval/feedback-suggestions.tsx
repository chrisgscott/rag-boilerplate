"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  convertFeedbackToTestCase,
  type FeedbackSuggestion,
  type TestSetSummary,
} from "@/app/(dashboard)/eval/actions";

export function FeedbackSuggestions({
  suggestions,
  testSets,
}: {
  suggestions: FeedbackSuggestion[];
  testSets: TestSetSummary[];
}) {
  const [converting, setConverting] = useState<string | null>(null);
  const [targetSetId, setTargetSetId] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");

  if (suggestions.length === 0) {
    return null;
  }

  async function handleConvert(suggestion: FeedbackSuggestion) {
    if (!targetSetId) {
      toast.error("Select a test set");
      return;
    }

    const result = await convertFeedbackToTestCase(
      suggestion.feedbackId,
      targetSetId,
      suggestion.queryText,
      expectedAnswer
    );

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Converted to test case");
      setConverting(null);
      setExpectedAnswer("");
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Suggested from Feedback</h3>
      <p className="text-sm text-muted-foreground">
        These messages received negative feedback. Convert them to test cases to track improvements.
      </p>

      {suggestions.map((s) => (
        <Card key={s.feedbackId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Q: {s.queryText || "(no query text)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground truncate">
              A: {s.assistantAnswer}
            </p>
            {s.comment && (
              <p className="text-orange-600">
                Feedback: {s.comment}
              </p>
            )}

            {converting === s.feedbackId ? (
              <div className="space-y-2 border-t pt-2">
                <Select value={targetSetId} onValueChange={setTargetSetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select test set" />
                  </SelectTrigger>
                  <SelectContent>
                    {testSets.map((ts) => (
                      <SelectItem key={ts.id} value={ts.id}>
                        {ts.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={expectedAnswer}
                  onChange={(e) => setExpectedAnswer(e.target.value)}
                  placeholder="Write the expected answer..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleConvert(s)}>
                    Convert
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConverting(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConverting(s.feedbackId)}
              >
                Convert to Test Case
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
