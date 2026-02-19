import { createClient } from "@/lib/supabase/server";
import { parseDocument } from "@/lib/parsers";
import { parseMarkdown } from "@/lib/parsers/markdown";
import { chunkText, type Chunk } from "./chunker";
import { embedTexts } from "./embedder";

const CHUNK_OPTIONS = {
  maxTokens: 512,
  overlap: 0.15,
};

/**
 * Process a document through the ingestion pipeline:
 * 1. Download file from Storage
 * 2. Parse text content
 * 3. Chunk into segments
 * 4. Generate embeddings
 * 5. Upsert chunks to document_chunks table
 * 6. Update document status
 */
export async function processDocument(documentId: string): Promise<void> {
  const supabase = await createClient();

  // Update status to processing
  await supabase
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  try {
    // 1. Fetch document record
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (fetchError || !doc) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // 2. Download file from Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    const buffer = new Uint8Array(await fileData.arrayBuffer());

    // 3. Parse document
    const parseResult = await parseDocument(buffer, doc.mime_type);

    // 4. Chunk text — use section-aware chunking for markdown
    let chunks: Chunk[];

    if (doc.mime_type === "text/markdown") {
      const mdResult = await parseMarkdown(buffer);
      chunks = [];
      for (const section of mdResult.sections) {
        const sectionChunks = chunkText(section.content, {
          ...CHUNK_OPTIONS,
          documentTitle: doc.name,
          sectionHeader: section.headers.join(" > "),
        });
        chunks.push(...sectionChunks);
      }
      // Re-index chunks sequentially
      chunks = chunks.map((c, i) => ({ ...c, index: i }));
    } else {
      chunks = chunkText(parseResult.text, {
        ...CHUNK_OPTIONS,
        documentTitle: doc.name,
      });
    }

    if (chunks.length === 0) {
      throw new Error("No chunks generated from document");
    }

    // 5. Generate embeddings
    const { embeddings, tokenCount } = await embedTexts(
      chunks.map((c) => c.content)
    );

    // 6. Upsert chunks to document_chunks table
    const chunkRows = chunks.map((chunk, i) => ({
      document_id: documentId,
      organization_id: doc.organization_id,
      content: chunk.content,
      embedding: JSON.stringify(embeddings[i]),
      chunk_index: chunk.index,
      token_count: chunk.tokenCount,
      metadata: {
        document_name: doc.name,
      },
    }));

    // Insert in batches of 50 to avoid payload limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunkRows.length; i += BATCH_SIZE) {
      const batch = chunkRows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from("document_chunks")
        .insert(batch);

      if (insertError) {
        throw new Error(`Failed to insert chunks: ${insertError.message}`);
      }
    }

    // 7. Update document status to complete
    await supabase
      .from("documents")
      .update({
        status: "complete",
        chunk_count: chunks.length,
        error_message: null,
      })
      .eq("id", documentId);
  } catch (error) {
    // Update document status to error
    const message =
      error instanceof Error ? error.message : "Unknown processing error";
    console.error(`Ingestion failed for document ${documentId}:`, message);

    await supabase
      .from("documents")
      .update({
        status: "error",
        error_message: message,
      })
      .eq("id", documentId);
  }
}
