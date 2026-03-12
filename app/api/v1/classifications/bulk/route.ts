import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PUT(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Expected JSON body", 400);
  }

  const ids = body.ids as number[] | undefined;
  const status = body.status as string | undefined;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return apiError("bad_request", "ids must be a non-empty array", 400);
  }
  if (ids.length > 100) {
    return apiError(
      "bad_request",
      "Maximum 100 ids per bulk operation",
      400
    );
  }
  if (!status || !["approved", "modified", "rejected"].includes(status)) {
    return apiError(
      "bad_request",
      "status must be one of: approved, modified, rejected",
      400
    );
  }

  const admin = createAdminClient();

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
    .in("id", ids)
    .eq("organization_id", organizationId);

  if (error)
    return apiError("internal_error", "Failed to update proposals", 500);

  return apiSuccess({ updated: ids.length, status });
}
