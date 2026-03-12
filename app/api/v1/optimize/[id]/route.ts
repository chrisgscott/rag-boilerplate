import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;
  const { organizationId } = auth.data!;
  const { id } = await params;

  const admin = createAdminClient();

  // Get session
  const { data: session, error: sessionError } = await admin
    .from("optimization_runs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (sessionError || !session) {
    return apiError("not_found", "Optimization session not found", 404);
  }

  // Get experiments for this session
  const { data: experiments } = await admin
    .from("optimization_experiments")
    .select("*")
    .eq("run_id", id)
    .order("experiment_index", { ascending: true });

  return apiSuccess({
    session,
    experiments: experiments ?? [],
  });
}
