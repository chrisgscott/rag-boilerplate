import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTestSets, getEvalResults, getFeedbackSuggestions } from "./actions";
import { TestSetManager } from "@/components/eval/test-set-manager";
import { EvalRunner } from "@/components/eval/eval-runner";
import { EvalResults } from "@/components/eval/eval-results";
import { FeedbackSuggestions } from "@/components/eval/feedback-suggestions";

export default async function EvalPage() {
  const [testSets, results, suggestions] = await Promise.all([
    getTestSets(),
    getEvalResults(),
    getFeedbackSuggestions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Evaluation</h1>
        <p className="text-muted-foreground">
          Measure retrieval quality and answer accuracy.
        </p>
      </div>

      <Tabs defaultValue="test-sets">
        <TabsList>
          <TabsTrigger value="test-sets">Test Sets</TabsTrigger>
          <TabsTrigger value="run">Run Evaluation</TabsTrigger>
          <TabsTrigger value="results">Results History</TabsTrigger>
        </TabsList>

        <TabsContent value="test-sets" className="mt-4 space-y-8">
          <TestSetManager testSets={testSets} />
          <FeedbackSuggestions suggestions={suggestions} testSets={testSets} />
        </TabsContent>

        <TabsContent value="run" className="mt-4">
          <EvalRunner testSets={testSets} />
        </TabsContent>

        <TabsContent value="results" className="mt-4">
          <EvalResults results={results} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
