# Inbox

Ideas, bugs, and improvements that came up during development but are out of current scope.
Triage weekly or at phase boundaries.

## To Triage

- [ ] Semantic caching in pgvector (60-90% cost reduction — high priority post-MVP)
- [ ] Cohere reranking integration (20-40% accuracy improvement)
- [ ] Contextual chunking (Anthropic method — 35-67% failure reduction)
- [ ] CLI tools: `rag ingest`, `rag eval`, `rag cost-report`
- [ ] LegalTech vertical edition (second vertical after PropTech)
- [ ] InsurTech vertical edition
- [ ] Smart model routing (cheap model for simple queries, powerful for complex)
- [ ] Document versioning and diff tracking
- [ ] Agentic RAG with multiple retrieval tools
- [ ] Multi-query / HyDE retrieval for ambiguous queries
- [ ] Course/educational content layer
- [ ] REST API routes for headless/external frontend integration (search, documents, chat) — lets developers build any frontend on top
- [ ] MCP server implementation — expose RAG operations (search, ingest, chat) as MCP tools so AI clients (Claude Desktop, Cursor, etc.) can interact directly
- [ ] Inline citations (Perplexity-style) — ShadCN `inline-citation` component already installed (`components/ai/inline-citation.tsx`). Needs custom Streamdown plugin to parse `[DocName]` bracket refs from LLM output and render as `InlineCitation` badges with hover cards linking to `/documents/{id}#chunk-{chunkId}`. See PLAN.md "Future Enhancements".

## Triaged

| Item | Decision | Destination |
|------|----------|-------------|
| Docling for document parsing | Adopted in Phase 2.5 | Python service at `services/ingestion/` |
| OCR support for scanned PDFs | Included with Docling | Docling has built-in OCR — no extra work needed |
| Supabase Realtime for status | Deferred | Polling (3s) works fine for now — revisit if UX feedback warrants it |

---
*Review at the end of each phase*
