import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api/response";

export type ApiAuthResult = {
  data?: { organizationId: string; apiKeyId: string };
  error?: Response;
};

/**
 * Authenticate an API request using a Bearer API key.
 * Hashes the key and looks it up in the api_keys table.
 * Returns { organizationId, apiKeyId } on success or an error Response.
 */
export async function authenticateApiKey(req: Request): Promise<ApiAuthResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: apiError("unauthorized", "Missing or invalid Authorization header", 401),
    };
  }

  const key = authHeader.slice(7); // Strip "Bearer "
  if (!key.startsWith("sk-") || key.length < 10) {
    return {
      error: apiError("unauthorized", "Invalid API key format", 401),
    };
  }

  // Hash the key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Look up in database
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, organization_id")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data) {
    return {
      error: apiError("unauthorized", "Invalid API key", 401),
    };
  }

  // Update last_used_at (fire-and-forget)
  void Promise.resolve(
    admin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id)
  ).catch(() => {});

  return {
    data: {
      organizationId: data.organization_id,
      apiKeyId: data.id,
    },
  };
}
