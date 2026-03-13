"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Get the current user's active organization ID.
 * Redirects to login if unauthenticated.
 */
async function getCurrentOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No active organization");
  }

  return { supabase, user, organizationId: profile.current_organization_id };
}

/**
 * Upload a document to Supabase Storage and create a document record.
 * Storage path: {organization_id}/{document_id}/{filename}
 */
export async function uploadDocument(formData: FormData) {
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return { error: "No file provided" };
  }

  const allowedTypes = [
    "application/pdf",
    "text/markdown",
    "text/plain",
    "text/html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (!allowedTypes.includes(file.type)) {
    return { error: "File type not supported. Upload PDF, Markdown, plain text, HTML, or DOCX files." };
  }

  const { supabase, user, organizationId } = await getCurrentOrg();

  // Compute content hash for delta processing (skip re-embedding unchanged files)
  const fileBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  const contentHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Generate a document ID upfront for the storage path
  const documentId = crypto.randomUUID();
  const storagePath = `${organizationId}/${documentId}/${file.name}`;

  // Upload to Supabase Storage (re-create File from buffer since we already consumed it)
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
    });

  if (uploadError) {
    console.error("Storage upload failed:", uploadError);
    return { error: "Failed to upload file" };
  }

  // Create document record with content hash
  const { error: insertError } = await supabase.from("documents").insert({
    id: documentId,
    organization_id: organizationId,
    uploaded_by: user.id,
    name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    content_hash: contentHash,
  });

  if (insertError) {
    // Clean up storage on DB insert failure
    await supabase.storage.from("documents").remove([storagePath]);
    console.error("Document insert failed:", insertError);
    return { error: "Failed to create document record" };
  }

  // Enqueue ingestion job via pgmq (Python worker will pick it up)
  const { error: queueError } = await supabase.rpc("enqueue_ingestion", {
    p_document_id: documentId,
  });

  if (queueError) {
    console.error("Failed to enqueue ingestion:", queueError);
    // Don't fail the upload — document is saved, just not queued
    // The pg_cron retry job will pick it up
  }

  revalidatePath("/documents");
  return { success: true, documentId };
}

/**
 * Delete a document and its storage file.
 * Chunks are cascade-deleted by the FK constraint.
 */
export async function deleteDocument(documentId: string) {
  const { supabase } = await getCurrentOrg();

  // Get document details before deleting
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, status, organization_id")
    .eq("id", documentId)
    .single();

  if (!doc) {
    return { error: "Document not found" };
  }

  if (doc.status === "processing") {
    return { error: "Cannot delete a document while it is being processed" };
  }

  // Delete from storage
  await supabase.storage.from("documents").remove([doc.storage_path]);

  // Delete document record (chunks cascade via FK)
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId);

  if (error) {
    console.error("Document delete failed:", error);
    return { error: "Failed to delete document" };
  }

  // Invalidate semantic cache — increment cache_version
  const { data: currentOrg } = await supabase
    .from("organizations")
    .select("cache_version")
    .eq("id", doc.organization_id)
    .single();

  if (currentOrg) {
    await supabase
      .from("organizations")
      .update({ cache_version: (currentOrg.cache_version ?? 1) + 1 })
      .eq("id", doc.organization_id);
  }

  revalidatePath("/documents");
  return { success: true };
}

/**
 * Re-ingest all documents for the current organization.
 * Sets all docs to "processing" and enqueues them via pgmq.
 * The Python worker will re-extract semantic units and re-embed.
 */
export async function reIngestAll() {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Get all documents for this org
  const { data: documents, error } = await admin
    .from("documents")
    .select("id")
    .eq("organization_id", organizationId);

  if (error) {
    return { error: `Failed to fetch documents: ${error.message}` };
  }
  if (!documents?.length) {
    return { error: "No documents to re-ingest" };
  }

  // Set all documents to "processing" status
  for (const doc of documents) {
    await admin
      .from("documents")
      .update({ status: "processing" })
      .eq("id", doc.id);
  }

  // Enqueue re-ingestion messages via pgmq — one per document
  for (const doc of documents) {
    const { error: enqueueError } = await admin.rpc("enqueue_ingestion", {
      p_document_id: doc.id,
    });
    if (enqueueError) {
      console.error(`Failed to enqueue ${doc.id}: ${enqueueError.message}`);
    }
  }

  // Bump cache version to invalidate stale cached responses
  const { data: currentOrg } = await admin
    .from("organizations")
    .select("cache_version")
    .eq("id", organizationId)
    .single();

  if (currentOrg) {
    await admin
      .from("organizations")
      .update({ cache_version: (currentOrg.cache_version ?? 1) + 1 })
      .eq("id", organizationId);
  }

  revalidatePath("/documents");
  return { success: true, enqueued: documents.length };
}
