import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("conversations")
    .select("id, title, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (error) return apiError("internal_error", "Failed to list conversations", 500);

  return apiSuccess(
    (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updated_at,
    }))
  );
}
