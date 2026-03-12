import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { hybridSearch } from "@/lib/rag/search";

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Expected JSON body", 400);
  }

  const query = body.query as string | undefined;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return apiError("bad_request", "query is required and must be a non-empty string", 400);
  }

  const topK = typeof body.topK === "number" ? body.topK : 5;
  const filters = body.filters as Record<string, unknown> | undefined;

  const admin = createAdminClient();

  try {
    const searchResponse = await hybridSearch(admin, {
      query: query.trim(),
      organizationId,
      matchCount: topK,
      filters: filters
        ? {
            documentIds: Array.isArray(filters.documentIds) ? filters.documentIds : undefined,
            mimeTypes: Array.isArray(filters.mimeTypes) ? filters.mimeTypes : undefined,
            dateFrom: typeof filters.dateFrom === "string" ? filters.dateFrom : undefined,
            dateTo: typeof filters.dateTo === "string" ? filters.dateTo : undefined,
          }
        : undefined,
    });

    return apiSuccess({
      results: searchResponse.results.map((r) => ({
        chunkId: r.chunkId,
        chunkIndex: r.chunkIndex,
        documentId: r.documentId,
        documentName: r.documentName,
        content: r.content,
        metadata: r.metadata,
        similarity: r.similarity,
        rrfScore: r.rrfScore,
      })),
      queryTokenCount: searchResponse.queryTokenCount,
    });
  } catch (err) {
    console.error("Search error:", err);
    return apiError("internal_error", "Search failed", 500);
  }
}
