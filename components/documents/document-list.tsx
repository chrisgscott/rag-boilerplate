"use client";

import Link from "next/link";
import { FileText, Trash2, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteDocument, reIngestAll } from "@/app/(dashboard)/documents/actions";
import { toast } from "sonner";
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type Document = {
  id: string;
  name: string;
  mime_type: string;
  file_size: number | null;
  status: string;
  chunk_count: number | null;
  created_at: string;
  error_message: string | null;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }
> = {
  pending: { label: "Pending", variant: "outline", icon: Clock },
  processing: { label: "Processing", variant: "secondary", icon: Loader2 },
  complete: { label: "Complete", variant: "default", icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", icon: AlertCircle },
};

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fileTypeLabel(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime === "text/markdown") return "Markdown";
  if (mime === "text/plain") return "Text";
  if (mime === "text/html") return "HTML";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "DOCX";
  return mime;
}

export function DocumentList({ documents }: { documents: Document[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isReingesting, startReingestionTransition] = useTransition();
  const router = useRouter();

  // Poll for status updates when any document is pending or processing
  const hasInProgress = documents.some(
    (d) => d.status === "pending" || d.status === "processing"
  );

  useEffect(() => {
    if (!hasInProgress) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [hasInProgress, router]);

  const handleDelete = async (doc: Document) => {
    setDeletingId(doc.id);
    const result = await deleteDocument(doc.id);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`"${doc.name}" deleted`);
    }
    setDeletingId(null);
  };

  const handleReingest = () => {
    startReingestionTransition(async () => {
      const result = await reIngestAll();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Re-ingesting ${result.enqueued} document(s)`);
      }
    });
  };

  if (documents.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
        <p className="text-sm">No documents yet. Upload one above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReingest}
          disabled={isReingesting}
        >
          {isReingesting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Re-ingest All
        </Button>
      </div>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Chunks</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead className="w-[50px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const status = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.pending;
          const StatusIcon = status.icon;
          return (
            <TableRow key={doc.id}>
              <TableCell className="font-medium max-w-[250px] truncate">
                <Link
                  href={`/documents/${doc.id}`}
                  className="hover:underline text-primary"
                >
                  {doc.name}
                </Link>
              </TableCell>
              <TableCell>{fileTypeLabel(doc.mime_type)}</TableCell>
              <TableCell>{formatSize(doc.file_size)}</TableCell>
              <TableCell>
                <Badge variant={status.variant} className="gap-1">
                  <StatusIcon
                    className={`h-3 w-3 ${doc.status === "processing" ? "animate-spin" : ""}`}
                  />
                  {status.label}
                </Badge>
                {doc.error_message && (
                  <p className="text-xs text-destructive mt-1 max-w-[200px] truncate">
                    {doc.error_message}
                  </p>
                )}
              </TableCell>
              <TableCell>{doc.chunk_count ?? "—"}</TableCell>
              <TableCell>{formatDate(doc.created_at)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(doc)}
                  disabled={deletingId === doc.id}
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );
}
