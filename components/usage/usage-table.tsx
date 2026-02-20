import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UsageLogEntry } from "@/app/(dashboard)/usage/actions";

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function UsageTable({ logs }: { logs: UsageLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No usage data yet. Start chatting to see cost tracking here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Query</TableHead>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="max-w-xs truncate">
              {log.queryText ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {log.model ?? "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {(log.llmInputTokens + log.llmOutputTokens).toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCost(log.totalCost)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(log.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
