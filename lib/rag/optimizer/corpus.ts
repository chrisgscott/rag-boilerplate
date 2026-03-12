import type { SupabaseClient } from "@supabase/supabase-js";

export type CorpusFingerprint = {
  docCount: number;
  chunkCount: number;
  lastIngestedAt: string | null;
};

export async function getCorpusFingerprint(
  supabase: SupabaseClient,
  organizationId: string
): Promise<CorpusFingerprint> {
  const [docsResult, chunksResult, latestDocResult] = await Promise.all([
    supabase
      .from("documents")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("document_chunks")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("documents")
      .select("created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (docsResult.error) throw new Error(docsResult.error.message);
  if (chunksResult.error) throw new Error(chunksResult.error.message);

  return {
    docCount: docsResult.count ?? 0,
    chunkCount: chunksResult.count ?? 0,
    lastIngestedAt: latestDocResult.data?.created_at ?? null,
  };
}
