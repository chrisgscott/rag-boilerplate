# REST API Layer Design

**Goal:** Expose the RAG boilerplate's core functionality (chat, documents, conversations) as a clean REST API so developers can build custom frontends without the bundled Next.js dashboard.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Tier 1: Chat, Documents, Conversations | Core RAG operations. Eval, usage, settings stay dashboard-only. |
| Auth | Org-scoped API keys | Universal (mobile, SPA, server, curl). No Supabase coupling for external clients. |
| Streaming | Both SSE and AI SDK format | SSE default for universal compatibility. AI SDK format for Next.js/AI SDK developers. |
| Architecture | Same Next.js app, `/api/v1/` routes | One repo, shared lib code, simple deployment. |
| Document upload | Direct multipart through API | Matches dashboard pattern. Typical doc sizes (PDFs, DOCX) are under 50MB. |
| Auth pattern | Shared helper function | `authenticateApiKey(req)` — explicit, debuggable, one line per route. |

## API Key System

### Database

New `api_keys` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `organization_id` | uuid | FK → organizations |
| `name` | text | Developer-chosen label ("Production", "Mobile App") |
| `key_hash` | text, unique | SHA-256 hash (never store plaintext) |
| `key_prefix` | text | First 8 chars for display (`sk-abc123...`) |
| `last_used_at` | timestamptz | Nullable, updated on use |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

RLS: org members can manage their org's keys.

### Key Format

`sk-<32 random hex chars>` (e.g., `sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`). Full key shown once at creation, then only prefix is visible.

### Auth Flow

1. Request includes `Authorization: Bearer sk-...`
2. `authenticateApiKey(req)` hashes the key, looks up hash in `api_keys`
3. Returns `{ organizationId, apiKeyId }`
4. Updates `last_used_at` (fire-and-forget)
5. All DB queries use service role client, filtered by `organization_id`

### Key Management

Stays in the dashboard via Server Actions (create, list, revoke). Not exposed through the API.

## API Endpoints

All routes under `/api/v1/`. JSON request/response except document upload (multipart).

### Chat

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/chat` | Send a message, get a RAG response |

Request:
```json
{
  "messages": [{"role": "user", "content": "What's the pet policy?"}],
  "conversationId": "optional-uuid",
  "stream": true
}
```

- `stream: true` (default) — SSE or AI SDK stream based on `Accept` header
- `stream: false` — complete JSON response
- `Accept: text/event-stream` (default) — standard SSE
- `Accept: text/x-vercel-ai-data-stream` — AI SDK UIMessage stream

Non-streaming response:
```json
{
  "data": {
    "conversationId": "uuid",
    "message": "Electric grills only on balconies...",
    "sources": [{"documentId": "...", "documentName": "...", "chunkIndex": 3, "content": "..."}]
  }
}
```

### Documents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/documents` | List documents |
| `POST` | `/api/v1/documents` | Upload (multipart/form-data) |
| `GET` | `/api/v1/documents/:id` | Document details + status |
| `DELETE` | `/api/v1/documents/:id` | Delete document |

### Conversations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/conversations` | List conversations |
| `GET` | `/api/v1/conversations/:id` | Conversation with messages |
| `DELETE` | `/api/v1/conversations/:id` | Delete conversation |
| `POST` | `/api/v1/conversations/:id/feedback` | Submit message feedback |

## Response Format

### Success

```json
// Single resource
{"data": {"id": "uuid", "name": "lease.pdf", "status": "ready"}}

// Collection
{"data": [{"id": "...", ...}, {"id": "...", ...}]}
```

### Errors

```json
{
  "error": {
    "code": "not_found",
    "message": "Document not found"
  }
}
```

| Status | Code | When |
|--------|------|------|
| 401 | `unauthorized` | Missing/invalid API key |
| 400 | `bad_request` | Validation failures |
| 403 | `forbidden` | Key valid but can't access resource |
| 404 | `not_found` | Resource doesn't exist |
| 413 | `file_too_large` | Upload exceeds limit |
| 422 | `unsupported_file_type` | File type not allowed |
| 429 | `rate_limited` | Future — shape ready |
| 500 | `internal_error` | Server error |

### SSE Stream Events

```
event: text-delta
data: {"content": "Electric"}

event: text-delta
data: {"content": " grills only"}

event: sources
data: [{"documentId": "...", "documentName": "...", "chunkIndex": 3}]

event: done
data: {"conversationId": "uuid"}
```

Sources sent as a single event after text stream completes (in-band, no header reading needed).

## File Structure

```
lib/api/
  auth.ts              — authenticateApiKey()
  response.ts          — success/error response helpers

app/api/v1/
  chat/route.ts        — POST
  documents/route.ts   — GET (list), POST (upload)
  documents/[id]/route.ts — GET (detail), DELETE
  conversations/route.ts — GET (list)
  conversations/[id]/route.ts — GET (with messages), DELETE
  conversations/[id]/feedback/route.ts — POST
```

## Code Reuse

API routes call the same `lib/rag/*` functions the dashboard uses: `hybridSearch()`, `buildSystemPrompt()`, `getLLMProvider()`, `trackUsage()`. New code is auth, serialization, and the SSE adapter.

Since API key auth has no Supabase user session, all DB queries use the service role client (`lib/supabase/admin.ts`) filtered by org ID from the API key.

## Dashboard Key Management

Two new Server Actions in `app/(dashboard)/settings/actions.ts`:
- `createApiKey(name)` — generates key, stores hash, returns plaintext once
- `revokeApiKey(id)` — deletes the key row

Simple UI section on Settings page: existing keys (prefix + name + last used) with create/revoke.

One new migration for `api_keys` table + RLS.

## Out of Scope

- **No rate limiting** — error shape supports `429` for future use
- **No API key scopes/permissions** — every key gets full Tier 1 access
- **No pagination** — list endpoints return all results (fine for typical doc counts)
- **No webhooks** — clients poll `GET /api/v1/documents/:id` for processing status
- **No Tier 2 endpoints** — eval, usage, settings, admin stay dashboard-only
- **No CORS auto-configuration** — developers configure themselves, we document it
- **No versioning beyond `/v1/`** — new routes if we ever need `/v2/`
