"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  upsertModelRate,
  deleteModelRate,
  seedDefaultRates,
  type ModelRate,
} from "@/app/(dashboard)/settings/actions";

function formatRate(rate: number): string {
  if (rate === 0) return "$0";
  const perMillion = rate * 1_000_000;
  return `$${perMillion.toFixed(2)}/M`;
}

export function ModelRatesTable({ rates }: { rates: ModelRate[] }) {
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSeed() {
    setLoading(true);
    const result = await seedDefaultRates();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Default rates loaded");
    }
  }

  async function handleDelete(id: string) {
    const result = await deleteModelRate(id);
    if (result.error) {
      toast.error(result.error);
    }
  }

  async function handleSubmit(formData: FormData) {
    const result = await upsertModelRate(formData);
    if (result.error) {
      toast.error(result.error);
    } else {
      setAdding(false);
      toast.success("Rate saved");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Model Rates</h2>
        <div className="flex gap-2">
          {rates.length === 0 && (
            <Button variant="outline" onClick={handleSeed} disabled={loading}>
              {loading ? "Loading..." : "Load Defaults"}
            </Button>
          )}
          <Button onClick={() => setAdding(true)} disabled={adding}>
            Add Rate
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Input Rate</TableHead>
            <TableHead>Output Rate</TableHead>
            <TableHead>Embedding Rate</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.map((rate) => (
            <TableRow key={rate.id}>
              <TableCell className="font-mono text-sm">{rate.model_id}</TableCell>
              <TableCell>{formatRate(rate.input_rate)}</TableCell>
              <TableCell>{formatRate(rate.output_rate)}</TableCell>
              <TableCell>
                {rate.embedding_rate !== null ? formatRate(rate.embedding_rate) : "—"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(rate.id)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {adding && (
            <TableRow>
              <TableCell colSpan={5}>
                <form action={handleSubmit} className="flex items-center gap-2">
                  <Input name="model_id" placeholder="model-id" required className="max-w-48" />
                  <Input
                    name="input_rate"
                    placeholder="Input (per token)"
                    type="number"
                    step="any"
                    required
                    className="max-w-36"
                  />
                  <Input
                    name="output_rate"
                    placeholder="Output (per token)"
                    type="number"
                    step="any"
                    required
                    className="max-w-36"
                  />
                  <Input
                    name="embedding_rate"
                    placeholder="Embed (optional)"
                    type="number"
                    step="any"
                    className="max-w-36"
                  />
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          )}
          {rates.length === 0 && !adding && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No model rates configured. Click &quot;Load Defaults&quot; to start.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
