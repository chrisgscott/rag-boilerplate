"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Ensures the current user has at least one organization.
 * If not, creates a default org and adds them as owner.
 * Called from the dashboard layout on every page load.
 */
export async function ensureOrganization() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Check if user has any organizations
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1);

  if (memberships && memberships.length > 0) {
    return; // User already has an org
  }

  // Create a default organization
  const displayName =
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "My";
  const orgName = `${displayName}'s Organization`;
  const suffix = user.id.slice(0, 8); // Use first 8 chars of user ID for uniqueness
  const slug = `${orgName}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: orgName, slug })
    .select("id")
    .single();

  if (orgError) {
    console.error("Failed to create organization:", orgError);
    return;
  }

  // Add user as owner
  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: user.id,
      role: "owner",
    });

  if (memberError) {
    console.error("Failed to add user to organization:", memberError);
    return;
  }

  // Set as current organization
  await supabase
    .from("profiles")
    .update({ current_organization_id: org.id })
    .eq("id", user.id);
}
