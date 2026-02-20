import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { organizationId } = await req.json();

  if (!organizationId) {
    return NextResponse.json({ error: "Organization ID required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify user is a member of this org
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });
  }

  // Update current org
  const { error } = await supabase
    .from("profiles")
    .update({ current_organization_id: organizationId })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Failed to switch organization" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
