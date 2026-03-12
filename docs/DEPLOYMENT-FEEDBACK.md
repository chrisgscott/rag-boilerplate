# Deployment Feedback Log

Real-world feedback from agents building on top of this boilerplate. This doc captures pain points, gaps, workarounds, and feature requests discovered during actual production deployments — things you can't know until you try to use the platform for real.

**Why this exists:** The boilerplate was built in isolation. The agents working in this repo know what they built, but not how it holds up when a separate codebase tries to consume the REST API, deploy a second instance, or integrate the ingestion pipeline into a larger product. This doc bridges that gap.

**How to use it:** If you're working in this repo and planning work, check here first. These are real blockers and friction points from real deployments, prioritized by impact.

---

## Active Deployment: TTI Proposal Language Library

**What it is:** A defense consulting firm's BD team replacing an 848-entry Excel boilerplate library with a web platform backed by a dedicated RAG Boilerplate instance. Source docs are past proposal responses (RFIs, RFQs, SSNs, White Papers). Platform UI lives in a separate Next.js app (sda-tools); this boilerplate instance is the backend.

**Design spec:** See `DOCLING-ENHANCEMENTS-PLAN.md` in this repo for boilerplate-level enhancements. The deployment-specific spec lives in the sda-tools repo at `docs/superpowers/specs/2026-03-12-proposal-language-library-design.md`.

**Integration pattern:** Server-side proxy. The consuming app's API routes call this boilerplate's REST API with a shared API key. No direct client-side calls.

---

## REST API Gaps

### 1. Upload endpoint doesn't accept metadata
**Severity:** Blocker for structured deployments
**Context:** When uploading a document via `POST /api/v1/documents`, there's no way to attach metadata (e.g., doc_type, department, source_name, date). The consuming app has to upload first, then make a separate call to update metadata — but there's no update endpoint either.
**What we need:** Accept an optional `metadata` JSON field on upload that gets stored alongside the document. This metadata should flow through to chunks so it's available during search/retrieval.

### 2. `uploaded_by` column is NOT NULL but API key uploads have no user
**Severity:** Blocker for API-first deployments
**Context:** The `documents` table has `uploaded_by uuid NOT NULL`. When a document is uploaded via API key (not a browser session), there's no authenticated user to populate this field. API key auth resolves to an organization, not a user.
**What we need:** Make `uploaded_by` nullable, or populate it with a sentinel value for API uploads, or add an optional `uploaded_by` field to the API request so the consuming app can pass through the acting user's ID.

### 3. No GET endpoint for document metadata
**Severity:** Important
**Context:** `GET /api/v1/documents/:id` returns the document record, but there's no way to retrieve the metadata that was (hypothetically) attached at upload time. The consuming app needs to read back metadata to display in its UI.
**What we need:** Include metadata in the document response.

### 4. No dedicated search endpoint
**Severity:** Important
**Context:** The only way to search the corpus is via the chat endpoint (`POST /api/v1/chat`), which runs a full LLM generation. For use cases that just need retrieval results (ranked chunks with sources), there's no lightweight option. The consuming app has to pay for an LLM call just to get search results.
**What we need:** `POST /api/v1/search` that runs the retrieval pipeline (embed query → hybrid search → rerank) and returns ranked chunks without LLM generation. Same auth, same filters.

### 5. No health check endpoint
**Severity:** Nice to have (but important for ops)
**Context:** The consuming app proxies to this service and needs to know if it's up. Currently there's no health check to call, so the proxy can't distinguish "boilerplate is down" from "bad request."
**What we need:** `GET /api/v1/health` returning `{ status: "ok" }` with no auth required.

---

## Ingestion Pipeline

### 6. DoclingDocument is discarded after parsing
**Severity:** Blocker for structured extraction
**Context:** Docling's full structural representation (heading hierarchy, element labels, page provenance, bounding boxes) is available during parsing but thrown away after chunking. Re-processing a document later (e.g., when the extraction pipeline improves) requires re-parsing with Docling's ML models, which is slow and expensive.
**What we need:** Persist the DoclingDocument JSON. See `DOCLING-ENHANCEMENTS-PLAN.md` Enhancement 1.

### 7. No semantic unit extraction
**Severity:** Blocker for structured extraction
**Context:** The chunker produces token-optimized RAG chunks, which are great for retrieval but don't correspond to meaningful document units. For structured extraction ("here's a paragraph from the Past Performance section — classify it"), we need one chunk per semantic element with its heading hierarchy attached.
**What we need:** Parallel extraction path using Docling's HierarchicalChunker. See `DOCLING-ENHANCEMENTS-PLAN.md` Enhancement 2.

### 8. No classification pipeline scaffold
**Severity:** Important for Tier 2 value
**Context:** The pattern "parse → identify passages → AI classifies → human reviews" is needed by this deployment and likely by others. The boilerplate should own the mechanism; deployments bring their domain schema.
**What we need:** Generic classification queue + review API. See `DOCLING-ENHANCEMENTS-PLAN.md` Enhancement 3.

---

## General Observations

### Things that worked well
- **REST API design** is clean and well-documented. Easy to plan a proxy layer against.
- **API key auth** with org scoping is exactly right for service-to-service integration.
- **Streaming support** with multiple formats (SSE, AI SDK, JSON) gives the consuming app flexibility.
- **Semantic caching** will be valuable — the BD team will ask similar questions repeatedly.
- **Eval toolkit** means we can measure quality for this specific corpus, not just the demo data.

### Things that were confusing or underdocumented
- The relationship between `documents`, `document_chunks`, and search results isn't immediately clear from the API docs alone. Had to read the code to understand what metadata flows where.
- Not obvious whether the auto-optimizer runs per-org or globally. For a multi-tenant deployment, per-org tuning matters.
- The contextual chunking feature's impact on search quality isn't benchmarked in the docs. Hard to know whether to enable it for a new deployment.

---

## How to Add Entries

When working on a deployment that consumes this boilerplate, add entries here with:
- **What you tried to do**
- **What went wrong or was missing**
- **What you worked around (if anything)**
- **What the boilerplate should provide instead**

Tag severity as: `Blocker`, `Important`, or `Nice to have`.
