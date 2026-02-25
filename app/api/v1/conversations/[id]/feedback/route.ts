import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id: conversationId } = await params;

  let body: { messageId?: number; rating?: number; comment?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  const { messageId, rating, comment } = body;

  if (!messageId || !rating) {
    return apiError("bad_request", "messageId and rating are required", 400);
  }

  if (rating !== 1 && rating !== 5) {
    return apiError(
      "bad_request",
      "rating must be 1 (thumbs down) or 5 (thumbs up)",
      400
    );
  }

  const admin = createAdminClient();

  // Verify conversation belongs to org
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .single();

  if (!conv) return apiError("not_found", "Conversation not found", 404);

  // Insert feedback (user_id is null for API key auth)
  const { error } = await admin.from("message_feedback").insert({
    message_id: messageId,
    organization_id: organizationId,
    user_id: null,
    rating,
    comment: comment ?? null,
  });

  if (error)
    return apiError("internal_error", "Failed to submit feedback", 500);

  return apiSuccess({ submitted: true });
}
