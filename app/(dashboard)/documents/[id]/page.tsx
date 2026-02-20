import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { DocumentDetail } from "@/components/documents/document-detail";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // RLS scopes to user's orgs — no additional auth check needed
  const { data: document } = await supabase
    .from("documents")
    .select(
      "id, name, mime_type, file_size, status, chunk_count, created_at, updated_at, error_message, parsed_content"
    )
    .eq("id", id)
    .single();

  if (!document) {
    notFound();
  }

  // Fetch chunks ordered by index
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("id, chunk_index, content, token_count, metadata")
    .eq("document_id", id)
    .order("chunk_index", { ascending: true });

  return <DocumentDetail document={document} chunks={chunks ?? []} />;
}
