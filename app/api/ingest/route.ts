import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processDocument } from "@/lib/rag/pipeline";

/**
 * POST /api/ingest
 *
 * Triggers document ingestion processing.
 * Called fire-and-forget from the client after a successful upload.
 * The response returns immediately; processing continues in the background.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Verify authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { documentId } = body;

  if (!documentId || typeof documentId !== "string") {
    return NextResponse.json(
      { error: "documentId is required" },
      { status: 400 }
    );
  }

  // Verify the document exists and belongs to the user's org
  const { data: doc } = await supabase
    .from("documents")
    .select("id, status")
    .eq("id", documentId)
    .single();

  if (!doc) {
    return NextResponse.json(
      { error: "Document not found" },
      { status: 404 }
    );
  }

  if (doc.status !== "pending") {
    return NextResponse.json(
      { error: `Document is already ${doc.status}` },
      { status: 409 }
    );
  }

  // Start processing — don't await so the response returns immediately
  processDocument(documentId).catch((err) => {
    console.error("Background ingestion failed:", err);
  });

  return NextResponse.json({ success: true, documentId });
}
