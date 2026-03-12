import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_TYPES = [
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("documents")
    .select("id, name, mime_type, file_size, status, metadata, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) return apiError("internal_error", "Failed to list documents", 500);

  return apiSuccess(
    (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mime_type,
      fileSize: d.file_size,
      status: d.status,
      metadata: d.metadata ?? {},
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }))
  );
}

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError("bad_request", "Expected multipart/form-data", 400);
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return apiError("bad_request", "No file provided", 400);
  }

  const metadataRaw = formData.get("metadata") as string | null;
  let metadata: Record<string, unknown> | undefined;
  if (metadataRaw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(metadataRaw);
    } catch {
      return apiError("bad_request", "metadata must be valid JSON", 400);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return apiError("bad_request", "metadata must be a JSON object", 400);
    }
    metadata = parsed as Record<string, unknown>;
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return apiError(
      "unsupported_file_type",
      "File type not supported. Upload PDF, Markdown, plain text, HTML, or DOCX files.",
      422
    );
  }

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  if (file.size > MAX_FILE_SIZE) {
    return apiError("file_too_large", "File exceeds maximum size of 50MB", 413);
  }

  const admin = createAdminClient();
  const fileBuffer = await file.arrayBuffer();

  // Content hash for delta processing
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  const contentHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const documentId = crypto.randomUUID();
  const storagePath = `${organizationId}/${documentId}/${file.name}`;

  // Upload to storage
  const { error: uploadError } = await admin.storage
    .from("documents")
    .upload(storagePath, fileBuffer, { contentType: file.type });

  if (uploadError) {
    return apiError("internal_error", "Failed to upload file", 500);
  }

  // Create document record (no uploaded_by for API key auth — no user)
  const { error: insertError } = await admin.from("documents").insert({
    id: documentId,
    organization_id: organizationId,
    name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    content_hash: contentHash,
    ...(metadata !== undefined && { metadata }),
  });

  if (insertError) {
    await admin.storage.from("documents").remove([storagePath]);
    return apiError("internal_error", "Failed to create document record", 500);
  }

  // Enqueue ingestion (fire-and-forget)
  void Promise.resolve(
    admin.rpc("enqueue_ingestion", { p_document_id: documentId })
  ).catch((err: unknown) => {
    console.error("Failed to enqueue ingestion:", err);
  });

  return apiSuccess(
    { id: documentId, name: file.name, status: "pending", createdAt: new Date().toISOString() },
    201
  );
}
