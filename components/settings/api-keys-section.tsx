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
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyData,
} from "@/app/(dashboard)/settings/actions";
import { Copy, Trash2, Plus, Key } from "lucide-react";

export function ApiKeysSection({ keys: initialKeys }: { keys: ApiKeyData[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const result = await createApiKey(newKeyName);
    setCreating(false);

    if ("key" in result) {
      setCreatedKey(result.key);
      setNewKeyName("");
      // Refresh the list by adding a placeholder — will be replaced on next server render
      setKeys((prev) => [
        {
          id: crypto.randomUUID(),
          name: newKeyName,
          keyPrefix: result.key.substring(0, 10),
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  }

  async function handleRevoke(keyId: string) {
    await revokeApiKey(keyId);
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Key className="h-5 w-5" /> API Keys
        </h2>
        <p className="text-sm text-muted-foreground">
          Create API keys for external applications to access the REST API.
        </p>
      </div>

      {/* Create new key */}
      <div className="flex gap-2">
        <Input
          placeholder="Key name (e.g., Production, Mobile App)"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Create
        </Button>
      </div>

      {/* Show created key (once only) */}
      {createdKey && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 space-y-2">
          <p className="text-sm font-medium">
            Copy your API key now. It won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
              {createdKey}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1" /> {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCreatedKey(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Keys table */}
      {keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell>
                  <code className="text-sm text-muted-foreground">
                    {k.keyPrefix}...
                  </code>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {k.lastUsedAt
                    ? new Date(k.lastUsedAt).toLocaleDateString()
                    : "Never"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(k.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(k.id)}
                    title="Revoke key"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground py-4">
          No API keys yet. Create one to start using the REST API.
        </p>
      )}
    </div>
  );
}
