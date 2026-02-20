import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client with the service_role key.
 * This client bypasses RLS — use ONLY in server-side admin operations
 * where the caller has already been authenticated at the application level.
 *
 * NEVER import this in client code or expose the service_role key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
