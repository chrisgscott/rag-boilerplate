import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("documents")
    .select("id, name, mime_type, file_size, status, chunk_count, created_at, updated_at")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) return apiError("not_found", "Document not found", 404);

  return apiSuccess({
    id: data.id,
    name: data.name,
    mimeType: data.mime_type,
    fileSize: data.file_size,
    status: data.status,
    chunkCount: data.chunk_count,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  // Get document to check ownership and get storage path
  const { data: doc, error: fetchError } = await admin
    .from("documents")
    .select("storage_path, status")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !doc) return apiError("not_found", "Document not found", 404);

  if (doc.status === "processing") {
    return apiError("bad_request", "Cannot delete a document while it is being processed", 400);
  }

  // Delete storage file
  await admin.storage.from("documents").remove([doc.storage_path]);

  // Delete document record (chunks cascade via FK)
  const { error } = await admin.from("documents").delete().eq("id", id);

  if (error) return apiError("internal_error", "Failed to delete document", 500);

  return apiSuccess({ deleted: true });
}
