"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { seedDemo, deleteDemo } from "@/app/(dashboard)/admin/actions";
import type { DemoStatus } from "@/app/(dashboard)/admin/actions";

export function DemoManager({ status }: { status: DemoStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const handleSeed = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await seedDemo();
      if (result.error) {
        setMessage(result.error);
      } else {
        setMessage(
          "Demo data seeded. Documents are being processed by the ingestion pipeline — this may take a minute."
        );
        router.refresh();
      }
    });
  };

  const handleDelete = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteDemo();
      if (result.error) {
        setMessage(result.error);
      } else {
        setMessage("Demo data deleted.");
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demo Data</CardTitle>
        <CardDescription>
          Seed or remove the PropTech demo (Sunrise Properties). Seeding creates
          a demo organization with sample lease, HOA, and community documents
          plus evaluation test cases.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.exists ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Organization:</span>{" "}
                {status.orgName}
              </div>
              <div>
                <span className="text-muted-foreground">Documents:</span>{" "}
                {status.documentCount}
              </div>
              <div>
                <span className="text-muted-foreground">Conversations:</span>{" "}
                {status.conversationCount}
              </div>
              <div>
                <span className="text-muted-foreground">Eval Test Sets:</span>{" "}
                {status.evalTestSetCount}
              </div>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isPending}>
                  {isPending ? "Deleting..." : "Delete Demo Data"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all demo data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the &quot;{status.orgName}&quot;
                    organization and all associated data: {status.documentCount}{" "}
                    documents, {status.conversationCount} conversations, and{" "}
                    {status.evalTestSetCount} eval test sets. This action cannot
                    be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <Button onClick={handleSeed} disabled={isPending}>
            {isPending ? "Seeding..." : "Seed Demo Data"}
          </Button>
        )}

        {message && (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
      </CardContent>
    </Card>
  );
}
