import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const documentId = url.searchParams.get("document_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const admin = createAdminClient();

  let query = admin
    .from("classification_proposals")
    .select(
      "id, document_id, semantic_unit_id, content, headings, proposed_labels, confidence, status, reviewer_labels, reviewed_at, created_at"
    )
    .eq("organization_id", organizationId);

  if (status) query = query.eq("status", status);
  if (documentId) query = query.eq("document_id", documentId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error)
    return apiError("internal_error", "Failed to list classifications", 500);

  return apiSuccess(
    (data ?? []).map((p) => ({
      id: p.id,
      documentId: p.document_id,
      semanticUnitId: p.semantic_unit_id,
      content: p.content,
      headings: p.headings,
      proposedLabels: p.proposed_labels,
      confidence: p.confidence,
      status: p.status,
      reviewerLabels: p.reviewer_labels,
      reviewedAt: p.reviewed_at,
      createdAt: p.created_at,
    }))
  );
}
