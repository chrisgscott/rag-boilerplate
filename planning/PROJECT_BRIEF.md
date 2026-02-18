# Project Brief: RAG Boilerplate

## Executive Summary
A production-ready, code-ownership RAG boilerplate built on Next.js 15 + Supabase + pgvector. Developers purchase access to a private GitHub repo, fork it, and customize it to build AI-powered document Q&A features into their products. Ships with a PropTech demo (lease & HOA document Q&A) and production patterns including multi-tenancy, evaluation tooling, cost tracking, and security defaults. Positioned as "ShipFa.st for RAG apps."

## The Problem
Developers building RAG features — document Q&A, knowledge bases, AI support bots — face a 2-4 week setup journey that follows a predictable failure pattern:
1. Follow a LangChain/LlamaIndex tutorial → works on 3 documents
2. Try real-world documents → chunking breaks, retrieval quality is garbage
3. Spend weeks researching chunking strategies, hybrid search, reranking, cost management
4. Cobble together something that mostly works but has no eval, no cost tracking, no multi-tenancy

80% of RAG failures trace back to chunking decisions, not retrieval or generation. There is no production-ready starting point in the TypeScript/Next.js ecosystem.

## The Solution
A complete, working Next.js application that developers fork and own. Not a framework, not a library — a codebase with opinionated defaults that work out of the box on real-world documents. Includes:
- Document ingestion pipeline (PDF, Markdown) with smart chunking
- Hybrid search (vector + BM25) via pgvector
- Chat interface with streaming responses and source citations
- Built-in evaluation dashboard (the key differentiator)
- Cost tracking per query with projections
- Multi-tenant via Supabase RLS (every table, not just documents)
- Security defaults (prompt injection delimiters, output sanitization, cross-tenant isolation tests)
- PropTech demo content (sample lease, HOA docs, vertical-specific prompts)

## Target Users
**Primary:** Indie SaaS developers and small teams (2-5 devs) who already use Next.js + Supabase. Same buyer profile as ShipFa.st / Supastarter purchasers — technical founders who value speed-to-launch and will pay $149-$499 to skip boilerplate work.

**Secondary:** AI consultants and agencies building RAG-powered products repeatedly for clients. They need a reliable, customizable starting point for each engagement.

**Vertical focus:** Developers building PropTech tools (lease Q&A, property document search) — the demo and sample content speak directly to this audience.

## Key Features (MVP)
1. Document ingestion pipeline with PDF + Markdown support, recursive chunking (400-512 tokens), and OpenAI text-embedding-3-small embeddings
2. Hybrid search combining pgvector HNSW semantic search with BM25 full-text search via Reciprocal Rank Fusion
3. Chat interface with Vercel AI SDK streaming, source citations, and conversation history
4. Evaluation dashboard with golden test set management and retrieval quality metrics (Precision@k, Recall@k, MRR)
5. Cost tracking per query (embedding + LLM tokens) with usage dashboard and projections

## Success Criteria
- MVP shipped within 6 weeks
- First revenue within 2 months (target: $149-$499 per sale)
- 5-10 developers on waitlist or expressing purchase intent before launch
- Revenue potential: $28K-$183K/yr (SanityCheck estimate)

## Current Status
- **Phase:** Discovery Complete → Specs In Progress
- **Next Step:** Complete specifications, then begin Phase 1 (Foundation)

## Key Milestones
| Milestone | Description | Target |
|-----------|-------------|--------|
| Phase 1 | Foundation (Scaffolding, Auth, Core Schema) | Week 1 |
| Phase 2 | Ingestion Pipeline (Upload, Parse, Chunk, Embed) | Week 2 |
| Phase 3 | Search & Retrieval (Hybrid Search, Reranking) | Week 3 |
| Phase 4 | Chat Interface (Streaming, Citations, History) | Week 4 |
| Phase 5 | Eval & Cost Tracking (Dashboard, Metrics) | Week 5 |
| Phase 6 | Demo Content & Polish (PropTech, README, Docs) | Week 6 |
| Launch | Private GitHub repo, landing page, outreach | Week 7 |

## Technical Approach
- **Scaffolding:** `npx create-next-app . -e with-supabase` (auth out of the box)
- **Frontend:** Next.js 15 (App Router) + ShadCN/UI + TailwindCSS
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, pgvector)
- **AI/LLM:** Vercel AI SDK (provider-agnostic: Claude, OpenAI, etc.)
- **Embeddings:** OpenAI text-embedding-3-small (1536 dims, $0.02/1M tokens)
- **Search:** pgvector HNSW + Postgres tsvector (hybrid via RRF)
- **Distribution:** Private GitHub repo (buyers get repo access after purchase)
- **Hosting:** Vercel (frontend) + Supabase (backend)

## Open Questions
- Document parsing strategy: Docling vs LlamaParse vs Unstructured.io for PDF extraction
- Reranking: Include Cohere reranking in MVP or defer to post-MVP?
- Semantic caching: Include in MVP (high ROI per design guide) or defer?
- Landing page / payment: Gumroad, Lemonsqueezy, or custom Stripe?

## Out of Scope (for MVP)
- Agentic RAG (multiple retrieval tools with agent reasoning)
- Contextual chunking (Anthropic method — Phase 3 in design guide)
- Multi-query / HyDE retrieval
- CLI tools (`rag ingest`, `rag eval`, `rag cost-report`) — nice to have, not essential
- Multiple vertical editions (LegalTech, InsurTech — future product expansion)
- Self-hosted embedding models
- Course / educational content layer

---
*Generated by spec-driven-dev skill*
*Last updated: 2026-02-18*
