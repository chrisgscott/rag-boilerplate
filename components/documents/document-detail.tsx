"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  ArrowLeft,
  FileText,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Document = {
  id: string;
  name: string;
  mime_type: string;
  file_size: number | null;
  status: string;
  chunk_count: number | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  parsed_content: string | null;
};

type Chunk = {
  id: number;
  chunk_index: number;
  content: string;
  token_count: number | null;
  metadata: unknown;
};

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: typeof Clock;
  }
> = {
  pending: { label: "Pending", variant: "outline", icon: Clock },
  processing: { label: "Processing", variant: "secondary", icon: Loader2 },
  complete: { label: "Complete", variant: "default", icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", icon: AlertCircle },
};

function formatSize(bytes: number | null) {
  if (!bytes) return "\u2014";
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
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "DOCX";
  return mime;
}

export function DocumentDetail({
  document,
  chunks,
}: {
  document: Document;
  chunks: Chunk[];
}) {
  const status = STATUS_CONFIG[document.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = status.icon;

  return (
    <div className="space-y-6">
      <Link
        href="/documents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Documents
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{document.name}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <span>{fileTypeLabel(document.mime_type)}</span>
            <span>{formatSize(document.file_size)}</span>
            <span>{document.chunk_count ?? 0} chunks</span>
            <span>Uploaded {formatDate(document.created_at)}</span>
          </div>
        </div>
        <Badge variant={status.variant} className="gap-1">
          <StatusIcon
            className={`h-3 w-3 ${document.status === "processing" ? "animate-spin" : ""}`}
          />
          {status.label}
        </Badge>
      </div>

      {document.error_message && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {document.error_message}
        </div>
      )}

      <Tabs defaultValue="parsed">
        <TabsList>
          <TabsTrigger value="parsed">Parsed Content</TabsTrigger>
          <TabsTrigger value="chunks">Chunks ({chunks.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="parsed" className="mt-4">
          {document.parsed_content ? (
            <Card>
              <CardContent className="pt-6">
                <div className="prose dark:prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                  >
                    {document.parsed_content}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">
                {document.status === "complete"
                  ? "Parsed content not available for this document. It may have been processed before this feature was added."
                  : "Parsed content will be available after processing completes."}
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="chunks" className="mt-4">
          {chunks.length > 0 ? (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <Card key={chunk.id}>
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        Chunk {chunk.chunk_index + 1}
                      </CardTitle>
                      {chunk.token_count && (
                        <Badge variant="outline" className="text-xs">
                          {chunk.token_count} tokens
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-0">
                    <pre className="whitespace-pre-wrap text-sm text-muted-foreground font-mono bg-muted/50 rounded-md p-3 overflow-x-auto">
                      {chunk.content}
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">
                No chunks yet. Content will be chunked during processing.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
