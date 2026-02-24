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

  // Extract unique page images from chunk metadata and generate signed URLs
  const pageImageMap = new Map<number, string>(); // page_no -> storage_path
  for (const chunk of chunks ?? []) {
    const meta = chunk.metadata as Record<string, unknown> | null;
    const paths = meta?.page_image_paths as Record<string, string> | undefined;
    if (paths) {
      for (const [pageNo, storagePath] of Object.entries(paths)) {
        pageImageMap.set(Number(pageNo), storagePath);
      }
    }
  }

  const pageImages: { pageNumber: number; url: string }[] = [];
  if (pageImageMap.size > 0) {
    const storagePaths = [...pageImageMap.values()];
    const { data: signedUrls } = await supabase.storage
      .from("documents")
      .createSignedUrls(storagePaths, 3600); // 1 hour expiry

    if (signedUrls) {
      const urlMap = new Map<string, string>();
      for (const item of signedUrls) {
        if (item.signedUrl) {
          urlMap.set(item.path ?? "", item.signedUrl);
        }
      }
      for (const [pageNo, storagePath] of pageImageMap.entries()) {
        const url = urlMap.get(storagePath);
        if (url) {
          pageImages.push({ pageNumber: pageNo, url });
        }
      }
      pageImages.sort((a, b) => a.pageNumber - b.pageNumber);
    }
  }

  return <DocumentDetail document={document} chunks={chunks ?? []} pageImages={pageImages} />;
}
