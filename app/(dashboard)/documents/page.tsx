import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { UploadForm } from "@/components/documents/upload-form";
import { DocumentList } from "@/components/documents/document-list";

export default async function DocumentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  const orgId = profile?.current_organization_id;

  const { data: documents } = await supabase
    .from("documents")
    .select("id, name, mime_type, file_size, status, chunk_count, created_at, error_message")
    .eq("organization_id", orgId!)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Documents</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Upload and manage documents for your knowledge base.
        </p>
      </div>

      <UploadForm />

      <DocumentList documents={documents ?? []} />
    </div>
  );
}
