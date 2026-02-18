# Product Requirements Document: RAG Boilerplate

## Overview

### Problem Statement
Developers building RAG (Retrieval-Augmented Generation) features face a painful 2-4 week setup journey. The TypeScript/Next.js ecosystem lacks a production-ready starting point — tutorials cover "hello world" RAG but fall apart on real documents, real scale, and real production requirements (multi-tenancy, evaluation, cost management, security). 80% of RAG failures trace back to chunking decisions, and most developers discover this the hard way.

### Solution
A code-ownership boilerplate (private GitHub repo, fork and customize) built on Next.js 15 + Supabase + pgvector that gives developers a production-ready RAG system out of the box. Ships with a PropTech demo (lease & HOA document Q&A), built-in evaluation tooling, cost tracking, and security defaults. Everything lives in one Supabase project — auth, storage, vectors, relational data — eliminating the data sync problems of separate vector databases.

### Target Users
**Primary:** Indie SaaS developers and small teams (2-5 devs) already using Next.js + Supabase who want to add AI-powered document Q&A, knowledge bases, or chat-over-documents features to their products.

**Secondary:** AI consultants and agencies building RAG-powered products repeatedly for different clients.

**Vertical focus (demo/marketing):** Developers building PropTech tools for property managers, landlords, and real estate agents.

## Goals & Success Metrics

### Primary Goals
1. Ship a production-ready RAG boilerplate that handles real-world documents (not just clean markdown)
2. Differentiate via built-in evaluation tooling — the only boilerplate that lets devs measure retrieval quality
3. Generate first revenue within 2 months of starting development
4. Validate the "vertical boilerplate" model with PropTech as the lead vertical

### Success Metrics
| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Time to MVP | 6 weeks | Development tracking |
| Waitlist signups (pre-launch) | 10+ developers | Landing page conversion |
| First sale | Within 2 months | Payment processor |
| Year 1 revenue | $28K-$183K | Cumulative sales |
| Demo-to-working-app time for buyer | < 30 minutes | User testing / feedback |

## Features

### MVP Features
| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Document Ingestion Pipeline | Upload PDFs and Markdown files, parse cleanly (preserving tables as units), chunk recursively at 400-512 tokens with 15% overlap, embed via text-embedding-3-small, store in pgvector with HNSW index. Async processing with status tracking. | Must Have |
| 2 | Hybrid Search | Combine pgvector HNSW semantic similarity search with Postgres BM25 full-text search (tsvector). Merge results via Reciprocal Rank Fusion (RRF). Metadata filtering via SQL WHERE clauses. Configurable top-k. | Must Have |
| 3 | Chat Interface | Streaming responses via Vercel AI SDK. System prompt with prompt injection delimiters. Source citations showing document name and chunk reference. Conversation history. Multi-model support (Claude, OpenAI) via AI SDK provider abstraction. Output sanitization via react-markdown + rehype-sanitize. | Must Have |
| 4 | Multi-Tenancy | Supabase RLS on ALL tables in the retrieval pipeline (documents, document_chunks, conversations, messages, cache, usage_logs). Organization-based data isolation. RPC functions that respect RLS (SECURITY INVOKER, not DEFINER). | Must Have |
| 5 | Evaluation Dashboard | CRUD for golden test sets (question + expected answer pairs). Run evaluation suite measuring Precision@k, Recall@k, and MRR. Display results with pass/fail thresholds. Compare configurations side-by-side. | Must Have |
| 6 | Cost Tracking | Per-query cost calculation (embedding tokens + LLM tokens). Usage dashboard showing total cost, cost per query, and projected monthly spend. Per-organization breakdown. | Must Have |
| 7 | Security Defaults | Prompt injection delimiters (XML-style [RETRIEVED_CONTEXT] tags). Content boundary instructions in system prompt. Output sanitization. Service role key isolation. Cross-tenant integration test fixture. Document access logging. Hard delete cascade on document removal. | Must Have |
| 8 | PropTech Demo Content | Sample lease agreement PDF, HOA rules document, property disclosure form. Pre-built property/unit metadata schema. Vertical-specific system prompts for lease Q&A. | Must Have |
| 9 | Developer Experience | README with quick start guide. Environment variable configuration with .env.example. Supabase migration files. TypeScript type generation from schema. Clear code comments on customization points. | Must Have |

### Future Features (Post-MVP)
| # | Feature | Description | Phase |
|---|---------|-------------|-------|
| 1 | Reranking | Cohere Rerank API integration for 20-40% accuracy improvement on retrieval | Post-MVP (high priority) |
| 2 | Semantic Caching | Cache query embeddings + LLM responses in pgvector. Cosine similarity >0.85-0.95 returns cached response. 60-90% cost reduction. | Post-MVP (high priority) |
| 3 | Contextual Chunking | Anthropic method: prepend 50-100 token context snippet to each chunk before embedding. 35-67% retrieval failure reduction. | Post-MVP |
| 4 | Multi-Query Retrieval | Decompose complex queries into sub-queries, retrieve independently, merge results. Resolves ambiguous/complex queries. | Post-MVP |
| 5 | Agentic RAG | Multiple retrieval tools (vector search, document listing, full-file retrieval, SQL querying) with agent reasoning about which tool to use. | Post-MVP |
| 6 | CLI Tools | `rag ingest ./docs` for bulk ingestion, `rag eval` to run evaluation suite, `rag cost-report` for cost breakdown. | Post-MVP |
| 7 | Additional Verticals | LegalTech edition (contract Q&A), InsurTech edition (policy Q&A) with vertical-specific schemas, prompts, and sample docs. | Post-MVP |
| 8 | Smart Model Routing | Route simple queries to cheaper models (gpt-4o-mini) and complex queries to powerful models (claude-3.5-sonnet). 60-80% cost reduction. | Post-MVP |
| 9 | Document Versioning | Track document versions, show diffs, allow rollback to previous versions. | Post-MVP |

## User Stories

### Developer (Primary Buyer)
- As a developer, I want to fork the repo and have a working RAG app running locally in under 30 minutes so that I can evaluate whether this fits my use case
- As a developer, I want to upload my own PDFs and immediately search them so that I can validate the boilerplate works on my domain's documents
- As a developer, I want to see retrieval quality metrics so that I can objectively measure whether my RAG pipeline is producing good results
- As a developer, I want per-query cost tracking so that I can estimate production costs before launching to users
- As a developer, I want multi-tenant data isolation out of the box so that I can serve multiple customers without building authorization from scratch
- As a developer, I want to swap the LLM provider with a single line change so that I'm not locked into any vendor
- As a developer, I want clear customization points in the code so that I can adapt the boilerplate to my vertical without rewriting core pipeline logic

### End User (Developer's Customer)
- As an end user, I want to upload documents and ask questions about them in natural language so that I can find information without reading entire documents
- As an end user, I want to see which document and section the answer came from so that I can verify the AI's response
- As an end user, I want streaming responses so that I don't stare at a loading spinner for 10 seconds
- As an end user, I want my documents to be private to my organization so that other tenants can't see my data

## Functional Requirements

### Authentication & Authorization
- [x] Users can sign up with email/password (via Supabase Auth, provided by `create-next-app -e with-supabase`)
- [x] Users can log in/log out
- [x] Password reset functionality
- [x] Session persistence via Supabase SSR cookies
- [ ] Organization creation on first signup
- [ ] Organization invitation (add members by email)
- [ ] Role-based access within organizations (owner, admin, member)

### Document Ingestion
- [ ] File upload via Supabase Storage (PDF, Markdown)
- [ ] Async document processing with status tracking (pending → processing → complete → error)
- [ ] PDF parsing that preserves tables as complete units (never chunk through a table)
- [ ] Markdown parsing with header hierarchy preservation
- [ ] Recursive chunking at 400-512 tokens with 15% overlap
- [ ] Contextual chunk headers (document title + section hierarchy prepended)
- [ ] Embedding via OpenAI text-embedding-3-small (1536 dimensions)
- [ ] Batch embedding for bulk ingestion
- [ ] Content hash tracking per document (delta processing — never re-embed unchanged content)
- [ ] Document deletion cascades to all chunks and embeddings (hard delete)
- [ ] Document re-upload triggers full re-chunking and re-embedding (delete-then-reinsert pattern)

### Search & Retrieval
- [ ] Vector similarity search via pgvector HNSW index
- [ ] BM25 full-text search via Postgres tsvector (generated column)
- [ ] Hybrid search combining vector + BM25 via Reciprocal Rank Fusion (RRF)
- [ ] RPC function for hybrid search that respects RLS (SECURITY INVOKER)
- [ ] Metadata filtering via SQL WHERE clauses
- [ ] Configurable top-k (default: 5)
- [ ] Similarity score threshold below which the system refuses to answer (default: 0.7)

### Chat & Generation
- [ ] Streaming responses via Vercel AI SDK `streamText()`
- [ ] Provider-agnostic LLM integration (Claude, OpenAI) via AI SDK
- [ ] System prompt with explicit data boundary instructions (prompt injection mitigation)
- [ ] Retrieved context injected via [RETRIEVED_CONTEXT] XML-style tags
- [ ] Source citations in response (document name, chunk reference, relevance score)
- [ ] Conversation history persistence
- [ ] "I don't have enough information" response when context is insufficient
- [ ] Conflicting source detection and flagging

### Evaluation
- [ ] CRUD for golden test sets (question + expected answer + expected source documents)
- [ ] Evaluation runner that measures: Precision@k (target ≥0.80), Recall@k (target ≥0.75), MRR (target ≥0.70)
- [ ] Results display with pass/fail against targets
- [ ] Historical eval results for tracking improvement over time
- [ ] Ability to run eval on different configurations (chunk sizes, top-k values)

### Cost Tracking
- [ ] Per-query cost calculation: embedding tokens × rate + LLM input tokens × rate + LLM output tokens × rate
- [ ] Cumulative cost tracking per organization
- [ ] Usage dashboard: total queries, total cost, average cost/query, projected monthly
- [ ] Model-specific cost rates configuration

### Admin & Management
- [ ] Document management UI (upload, list, view status, delete)
- [ ] Organization settings (name, members, roles)
- [ ] Usage/billing dashboard
- [ ] Eval dashboard

## Non-Functional Requirements

### Performance
- Chat response starts streaming within 2 seconds
- Hybrid search query returns results within 500ms (at <500K chunks)
- Document ingestion processes at least 10 pages/minute
- Support for up to 1M vectors per Supabase project (pgvector HNSW handles this well)

### Security
- All data encrypted in transit (HTTPS)
- Authentication via Supabase Auth (SSR cookies, not localStorage)
- Row-level security on EVERY table with user/organization data
- Prompt injection delimiters on all RAG prompts
- Content boundary instructions in system prompts
- Output sanitization via react-markdown + rehype-sanitize
- Service role key never exposed in browser bundle or client-facing API routes
- Cross-tenant isolation integration tests in test suite
- Document access logging (user_id, document_id, query, timestamp)
- Hard delete cascade on document removal (no orphaned vectors)

### Accessibility
- WCAG 2.1 AA compliance on chat interface
- Keyboard navigation support
- Screen reader compatible source citations

### Developer Experience
- `npx create-next-app . -e with-supabase` as foundation
- Under 30 minutes from fork to working local demo
- Clear .env.example with all required variables documented
- Supabase migrations run cleanly on fresh project
- TypeScript types auto-generated from schema
- Code comments marking customization points ("// CUSTOMIZE: ...")

## Constraints & Assumptions

### Technical Constraints
- Next.js 15 with App Router (scaffolded via `create-next-app -e with-supabase`)
- Supabase for all backend services (Postgres, Auth, Storage, Edge Functions)
- pgvector for vector storage (no separate vector DB)
- ShadCN/UI for components (accessible, customizable)
- Vercel AI SDK for LLM integration (provider-agnostic)
- Vercel for frontend hosting (optimized for Next.js)
- Use Supabase transaction pooler (port 6543) in serverless environments

### Assumptions
- Buyers are comfortable with Next.js and TypeScript
- Buyers have or will create a Supabase account
- OpenAI API key is available for embeddings (most accessible embedding API)
- Most use cases will involve <500K vectors (well within pgvector performance range)
- PDF is the primary document format for the target verticals (PropTech, LegalTech)

## Out of Scope
- Agentic RAG with multiple retrieval tools
- Contextual chunking (Anthropic method)
- Multi-query / HyDE retrieval strategies
- Self-hosted embedding models
- CLI tooling
- Additional vertical editions beyond PropTech
- Course / educational content
- Mobile app
- Real-time collaboration features
- Document OCR (scanned PDF support — defer to post-MVP)

## Open Questions
1. **PDF Parsing:** Docling (MIT, best table accuracy at 97.9%) vs LlamaParse (faster, commercial API) vs client-side parsing? Docling requires Python — does this complicate the JS-only stack?
2. **Reranking in MVP:** Cohere reranking adds 20-40% accuracy improvement but adds an API dependency and ~200ms latency. Include in MVP or defer?
3. **Semantic caching:** Design guide identifies this as highest-ROI cost optimization (60-90% reduction). Worth including in MVP given complexity?
4. **Payment/distribution:** Lemonsqueezy vs Gumroad vs custom Stripe for handling purchases and granting GitHub repo access?
5. **Iterative index scans:** pgvector 0.8.0 feature for faster filtered queries — is this available in Supabase's pgvector version?

---
*Generated by spec-driven-dev skill*
*Last updated: 2026-02-18*
