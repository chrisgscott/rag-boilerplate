# Inbox

Ideas, bugs, and improvements that came up during development but are out of current scope.
Triage weekly or at phase boundaries.

## To Triage

- [ ] Embeddable chat widget — `<script>` tag that injects iframe chat bubble (Intercom-style) for tenant portals / external sites. Key decisions: auth model (API key in iframe vs proxy endpoint), CORS, scope (chat only vs. history + feedback + sources). REST API backend is ready.
- [ ] Inline citations (Perplexity-style) — ShadCN `inline-citation` component already installed (`components/ai/inline-citation.tsx`). Needs custom Streamdown plugin to parse `[DocName]` bracket refs from LLM output and render as `InlineCitation` badges with hover cards linking to `/documents/{id}#chunk-{chunkId}`. See PLAN.md "Future Enhancements".
- [ ] OpenRouter as optional unified provider — single API key for all LLM touchpoints (chat, judge, contextualizer, VLM). Vercel AI SDK already supports OpenRouter as an openai-compatible provider. Key value: users pick best model per job via config, not code changes. Also enables embedding model flexibility (e.g., Gemini Embedding 2 for multimodal use cases). Constraint: embedding model swap requires full re-index, can't be toggled per-experiment. Env pattern: `OPENROUTER_API_KEY`, `CHAT_MODEL=anthropic/claude-sonnet-4-5`, `EMBEDDING_MODEL=openai/text-embedding-3-small`, etc.
- [ ] Model selection as auto-optimizer knob — if OpenRouter is the provider layer, model strings become tunable knobs the optimizer can experiment with (e.g., "does GPT-4o beat Claude Sonnet on faithfulness for this corpus?"). Applies to chat model, contextualizer model, and reranker. Embedding model and judge model must stay fixed within a session. Depends on: OpenRouter integration + auto-optimizer Phase 3 (agent Decide step).
- [ ] CLI tools: `rag ingest`, `rag eval`, `rag cost-report`
- [ ] Smart model routing (cheap model for simple queries, powerful for complex)
- [ ] Document versioning and diff tracking
- [ ] Agentic RAG with multiple retrieval tools
- [ ] Multi-query / HyDE retrieval for ambiguous queries
- [ ] Togglable web search — allow users to enable/disable web search per query so the LLM can incorporate outside context alongside document-grounded answers. Vercel AI SDK supports tool calling; OpenAI Responses API has built-in web search. Key decisions: UI toggle (per-message vs per-conversation vs org setting), how to blend web results with RAG context in the prompt, citation format for web vs document sources, cost implications.
- [ ] MCP server implementation — expose RAG operations (search, ingest, chat) as MCP tools so AI clients (Claude Desktop, Cursor, etc.) can interact directly
- [ ] LegalTech vertical edition (second vertical after PropTech)
- [ ] InsurTech vertical edition
- [ ] Course/educational content layer

## Completed

| Item | Phase | Notes |
|------|-------|-------|
| REST API routes | Phase 7 | `/api/v1/` — chat, documents, conversations, feedback. See `docs/api-guide.md` |
| Cohere reranking | Phase 5 | `lib/rag/reranker.ts`, opt-in via `COHERE_API_KEY` |
| VLM visual extraction | Phase 6 | GPT-4o-mini (not Gemini), opt-in via `VLM_ENABLED=true` |
| Docling for document parsing | Phase 2.5 | Python service at `services/ingestion/` |
| OCR support for scanned PDFs | Phase 2.5 | Built into Docling — no extra work needed |
| Semantic caching | Phase 8 | `lib/rag/cache.ts`, migration 00032, opt-in via `SEMANTIC_CACHE_ENABLED` |
| Contextual chunking | Phase 9 | `services/ingestion/src/contextualizer.py`, migration 00033, opt-in via `CONTEXTUAL_CHUNKING_ENABLED` |

## Deferred

| Item | Reason |
|------|--------|
| Supabase Realtime for status | Polling (3s) works fine — revisit if UX feedback warrants it |

---
*Review at the end of each phase*
