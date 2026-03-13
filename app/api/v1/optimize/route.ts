import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { startOptimizationSession } from "@/lib/rag/optimizer/wire";

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;
  const { organizationId } = auth.data!;

  // Check if auto-optimize is enabled
  if (process.env.AUTO_OPTIMIZE_ENABLED !== "true") {
    return apiError(
      "forbidden",
      "Auto-optimization is not enabled. Set AUTO_OPTIMIZE_ENABLED=true",
      403
    );
  }

  const admin = createAdminClient();

  // Check for active session
  const { data: activeRun } = await admin
    .from("optimization_runs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (activeRun) {
    return apiError("conflict", "An optimization session is already running", 409);
  }

  try {
    await startOptimizationSession(admin, organizationId);
    return apiSuccess({ status: "started" }, 201);
  } catch (err) {
    return apiError(
      "internal_error",
      err instanceof Error ? err.message : "Failed to start optimization session",
      500
    );
  }
}

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;
  const { organizationId } = auth.data!;

  const admin = createAdminClient();

  // Get latest session
  const { data: latestSession } = await admin
    .from("optimization_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get best config
  const { data: bestConfig } = await admin
    .from("optimization_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return apiSuccess({
    latestSession: latestSession ?? null,
    bestConfig: bestConfig ?? null,
  });
}
