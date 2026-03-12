import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Expected JSON body", 400);
  }

  const status = body.status as string | undefined;
  if (!status || !["approved", "modified", "rejected"].includes(status)) {
    return apiError(
      "bad_request",
      "status must be one of: approved, modified, rejected",
      400
    );
  }

  // Verify proposal belongs to org
  const { data: existing, error: fetchError } = await admin
    .from("classification_proposals")
    .select("id, organization_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !existing) {
    return apiError("not_found", "Classification proposal not found", 404);
  }

  const updatePayload: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
  };

  if (body.reviewerLabels) {
    updatePayload.reviewer_labels = body.reviewerLabels;
  }

  const { error } = await admin
    .from("classification_proposals")
    .update(updatePayload)
    .eq("id", id);

  if (error)
    return apiError("internal_error", "Failed to update proposal", 500);

  return apiSuccess({ id: Number(id), status });
}
