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
- [ ] Supabase Realtime for document processing status (replace polling)
- [ ] Document versioning and diff tracking
- [ ] Agentic RAG with multiple retrieval tools
- [ ] Multi-query / HyDE retrieval for ambiguous queries
- [ ] Course/educational content layer
- [ ] REST API routes for headless/external frontend integration (search, documents, chat) — lets developers build any frontend on top
- [ ] MCP server implementation — expose RAG operations (search, ingest, chat) as MCP tools so AI clients (Claude Desktop, Cursor, etc.) can interact directly

## Triaged

| Item | Decision | Destination |
|------|----------|-------------|
| OCR support for scanned PDFs | Adopted — Docling includes OCR | Phase 2.5 (Docling migration) |
| Supabase Realtime for ingestion status | Deferred — polling works fine | Post-MVP backlog |
| Queue-based ingestion | Adopted — pgmq (Supabase Queues) | Phase 2.5 (Decision #010) |

---
*Review at the end of each phase*
