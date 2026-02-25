import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  // Get conversation
  const { data: conv, error: convError } = await admin
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (convError || !conv) return apiError("not_found", "Conversation not found", 404);

  // Get messages
  const { data: messages, error: msgError } = await admin
    .from("messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (msgError) return apiError("internal_error", "Failed to load messages", 500);

  return apiSuccess({
    id: conv.id,
    title: conv.title,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
      createdAt: m.created_at,
    })),
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  // Verify conversation belongs to org
  const { data: conv, error: fetchError } = await admin
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !conv) return apiError("not_found", "Conversation not found", 404);

  const { error } = await admin.from("conversations").delete().eq("id", id);

  if (error) return apiError("internal_error", "Failed to delete conversation", 500);

  return apiSuccess({ deleted: true });
}
