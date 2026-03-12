import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const url = new URL(req.url);
  const documentId = url.searchParams.get("document_id");

  const admin = createAdminClient();

  let query = admin
    .from("classification_proposals")
    .select("status")
    .eq("organization_id", organizationId);

  if (documentId) query = query.eq("document_id", documentId);

  const { data, error } = await query;

  if (error) return apiError("internal_error", "Failed to get stats", 500);

  const counts = { pending: 0, approved: 0, modified: 0, rejected: 0 };
  for (const row of data ?? []) {
    const s = row.status as keyof typeof counts;
    if (s in counts) counts[s]++;
  }

  return apiSuccess(counts);
}
