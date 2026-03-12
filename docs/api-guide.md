# REST API Guide

The RAG Boilerplate exposes a REST API at `/api/v1/` for building custom frontends, mobile apps, or integrations without using the bundled Next.js dashboard. All endpoints use API key authentication and return JSON.

## Base URL

```
https://your-deployment.example.com/api/v1
```

For local development:

```
http://localhost:3000/api/v1
```

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer sk-your-api-key-here
```

API keys are scoped to an organization. Every request is automatically filtered to only return data belonging to that organization.

### Creating an API key

1. Log into the dashboard
2. Go to **Settings**
3. Under **API Keys**, click **Create API Key**
4. Copy the key immediately — it's only shown once

### Error responses

If authentication fails, the API returns:

```json
// 401 — Missing or malformed header
{ "error": { "code": "unauthorized", "message": "Missing or invalid Authorization header" } }

// 401 — Invalid key
{ "error": { "code": "unauthorized", "message": "Invalid API key" } }
```

---

## Response format

All responses use a consistent JSON envelope:

**Success:**

```json
{
  "data": { ... }
}
```

**Error:**

```json
{
  "error": {
    "code": "error_code",
    "message": "Human-readable description"
  }
}
```

---

## Endpoints

### Documents

#### List documents

```
GET /api/v1/documents
```

Returns all documents for the organization, newest first.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "document.pdf",
      "mimeType": "application/pdf",
      "fileSize": 102400,
      "status": "complete",
      "createdAt": "2026-02-20T15:17:36.629Z",
      "updatedAt": "2026-02-20T15:17:39.914Z"
    }
  ]
}
```

**Document status values:** `pending`, `processing`, `complete`, `error`

**Example:**

```bash
curl -s https://your-app.com/api/v1/documents \
  -H "Authorization: Bearer sk-your-key"
```

---

#### Upload a document

```
POST /api/v1/documents
Content-Type: multipart/form-data
```

Upload a file for ingestion. The document is immediately queued for processing (chunking, embedding, indexing).

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | The document to upload |

**Supported file types:**

- `application/pdf` (.pdf)
- `text/markdown` (.md)
- `text/plain` (.txt)
- `text/html` (.html)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx)

**Limits:** 50 MB max file size.

**Response** (201):

```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "status": "pending",
    "createdAt": "2026-02-25T14:30:00.000Z"
  }
}
```

**Error codes:**

| Code | Status | Description |
|------|--------|-------------|
| `bad_request` | 400 | No file provided or not multipart/form-data |
| `unsupported_file_type` | 422 | File type not in the allowed list |
| `file_too_large` | 413 | File exceeds 50 MB |

**Example:**

```bash
curl -s https://your-app.com/api/v1/documents \
  -H "Authorization: Bearer sk-your-key" \
  -F "file=@/path/to/document.pdf"
```

---

#### Get document detail

```
GET /api/v1/documents/:id
```

Returns a single document with its chunk count.

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "mimeType": "application/pdf",
    "fileSize": 102400,
    "status": "complete",
    "chunkCount": 17,
    "createdAt": "2026-02-20T15:17:36.629Z",
    "updatedAt": "2026-02-20T15:17:39.914Z"
  }
}
```

**Example:**

```bash
curl -s https://your-app.com/api/v1/documents/ab1d938d-1e1a-4009-9061-1b98bad767e7 \
  -H "Authorization: Bearer sk-your-key"
```

---

#### Delete a document

```
DELETE /api/v1/documents/:id
```

Deletes a document, its storage file, and all associated chunks. Cannot delete a document while it's being processed.

**Response:**

```json
{ "data": { "deleted": true } }
```

**Error codes:**

| Code | Status | Description |
|------|--------|-------------|
| `not_found` | 404 | Document doesn't exist or belongs to a different org |
| `bad_request` | 400 | Document is currently being processed |

**Example:**

```bash
curl -s -X DELETE https://your-app.com/api/v1/documents/ab1d938d-... \
  -H "Authorization: Bearer sk-your-key"
```

---

### Conversations

#### List conversations

```
GET /api/v1/conversations
```

Returns all conversations for the organization, most recently updated first.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "How much is rent?",
      "updatedAt": "2026-02-20T18:48:29.074Z"
    }
  ]
}
```

**Example:**

```bash
curl -s https://your-app.com/api/v1/conversations \
  -H "Authorization: Bearer sk-your-key"
```

---

#### Get conversation detail

```
GET /api/v1/conversations/:id
```

Returns a conversation with its full message history (in chronological order). Each assistant message includes the sources that were used to generate the response.

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "title": "How much is rent?",
    "createdAt": "2026-02-20T15:33:39.241Z",
    "updatedAt": "2026-02-20T15:33:39.241Z",
    "messages": [
      {
        "id": 54,
        "role": "user",
        "content": "How much is rent?",
        "sources": null,
        "createdAt": "2026-02-20T15:33:39.500Z"
      },
      {
        "id": 55,
        "role": "assistant",
        "content": "The monthly rent is $1,450.00. [Residential-Lease-Agreement.md, Section 3]",
        "sources": [
          {
            "documentId": "uuid",
            "documentName": "Residential-Lease-Agreement.md",
            "chunkId": 53,
            "chunkIndex": 3,
            "content": "Section 3: Rent\n\nMonthly Rent: $1,450.00...",
            "similarity": 0.477
          }
        ],
        "createdAt": "2026-02-20T15:33:41.200Z"
      }
    ]
  }
}
```

**Example:**

```bash
curl -s https://your-app.com/api/v1/conversations/44cc434b-... \
  -H "Authorization: Bearer sk-your-key"
```

---

#### Delete a conversation

```
DELETE /api/v1/conversations/:id
```

Deletes a conversation and all its messages.

**Response:**

```json
{ "data": { "deleted": true } }
```

**Example:**

```bash
curl -s -X DELETE https://your-app.com/api/v1/conversations/44cc434b-... \
  -H "Authorization: Bearer sk-your-key"
```

---

### Feedback

#### Submit message feedback

```
POST /api/v1/conversations/:id/feedback
Content-Type: application/json
```

Submit a thumbs up or thumbs down rating on an assistant message.

**Request body:**

```json
{
  "messageId": 55,
  "rating": 5,
  "comment": "Optional text feedback"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messageId` | number | Yes | The message ID to rate |
| `rating` | number | Yes | `1` (thumbs down) or `5` (thumbs up) |
| `comment` | string | No | Free-text feedback |

**Response:**

```json
{ "data": { "submitted": true } }
```

**Example:**

```bash
curl -s https://your-app.com/api/v1/conversations/44cc434b-.../feedback \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"messageId": 55, "rating": 5}'
```

---

### Chat

#### Send a message

```
POST /api/v1/chat
Content-Type: application/json
```

Send a message and get a RAG-powered response. The API searches your organization's documents, retrieves relevant chunks, and generates an answer with source citations.

**Request body:**

```json
{
  "messages": [
    { "role": "user", "content": "How much is rent?" }
  ],
  "conversationId": "uuid",
  "stream": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `messages` | array | Yes | — | Message history. Each message has `role` ("user" or "assistant") and `content` (string). The last message is used as the query. |
| `conversationId` | string | No | auto-created | Continue an existing conversation. If omitted, a new conversation is created automatically. |
| `stream` | boolean | No | `true` | Set to `false` for a single JSON response instead of streaming. |

**Multi-turn conversations:** Include previous messages in the `messages` array for context. The API uses the last user message as the search query but sends the full history to the LLM for context.

```json
{
  "messages": [
    { "role": "user", "content": "How much is rent?" },
    { "role": "assistant", "content": "The monthly rent is $1,450.00." },
    { "role": "user", "content": "What about late fees?" }
  ],
  "conversationId": "uuid-from-first-response"
}
```

---

#### Response format: Non-streaming (`stream: false`)

Returns a single JSON response with the complete answer and sources.

**Response:**

```json
{
  "data": {
    "conversationId": "uuid",
    "message": "The monthly rent is $1,450.00. [Residential-Lease-Agreement.md, Section 3]",
    "sources": [
      {
        "documentId": "uuid",
        "documentName": "Residential-Lease-Agreement.md",
        "chunkId": 53,
        "chunkIndex": 3,
        "content": "Section 3: Rent\n\nMonthly Rent: $1,450.00...",
        "similarity": 0.477
      }
    ]
  }
}
```

**Example:**

```bash
curl -s https://your-app.com/api/v1/chat \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "How much is rent?"}], "stream": false}'
```

---

#### Response format: SSE streaming (default)

When `stream` is `true` (the default), the response is a Server-Sent Events stream with three event types:

**1. `text-delta`** — Streamed token-by-token as the LLM generates the response:

```
event: text-delta
data: {"content":"The"}

event: text-delta
data: {"content":" monthly"}

event: text-delta
data: {"content":" rent"}
```

**2. `sources`** — Sent once after all text deltas, contains the source chunks used:

```
event: sources
data: [{"documentId":"uuid","documentName":"Residential-Lease-Agreement.md","chunkId":53,"chunkIndex":3,"content":"...","similarity":0.477}]
```

**3. `done`** — Sent last, contains the conversation ID:

```
event: done
data: {"conversationId":"uuid"}
```

**Example:**

```bash
curl -N https://your-app.com/api/v1/chat \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is the pet policy?"}]}'
```

**JavaScript client example:**

```javascript
const response = await fetch("https://your-app.com/api/v1/chat", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk-your-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "How much is rent?" }],
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop(); // Keep incomplete line in buffer

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      const eventType = line.slice(7);
      // Next non-empty line is the data
      continue;
    }
    if (line.startsWith("data: ")) {
      const data = JSON.parse(line.slice(6));
      // Handle based on current event type
    }
  }
}
```

---

#### Response format: Vercel AI SDK streaming

If you're building with the [Vercel AI SDK](https://sdk.vercel.ai/), set the `Accept` header to get a compatible stream format:

```
Accept: text/x-vercel-ai-data-stream
```

The response uses the AI SDK's data stream protocol, which can be consumed directly by `useChat()`:

```javascript
import { useChat } from "ai/react";

const { messages, input, handleSubmit } = useChat({
  api: "https://your-app.com/api/v1/chat",
  headers: {
    "Authorization": "Bearer sk-your-key",
    "Accept": "text/x-vercel-ai-data-stream",
  },
});
```

The conversation ID and sources are available in response headers:
- `x-conversation-id` — The conversation UUID
- `x-sources` — JSON array of source objects (without `content` field to reduce header size)

---

#### Refusal behavior

If no documents pass the similarity threshold (default 0.3), the API returns a refusal instead of a hallucinated answer:

**Non-streaming:**

```json
{
  "data": {
    "conversationId": "uuid",
    "message": "I don't have enough information in the available documents to answer that question.",
    "sources": []
  }
}
```

**SSE streaming:** The refusal message is sent as a single `text-delta` event followed by empty `sources` and `done`.

---

## Error reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthorized` | 401 | Missing, malformed, or invalid API key |
| `bad_request` | 400 | Invalid request body or missing required fields |
| `not_found` | 404 | Resource doesn't exist or belongs to a different org |
| `unsupported_file_type` | 422 | Uploaded file type is not supported |
| `file_too_large` | 413 | Uploaded file exceeds 50 MB |
| `internal_error` | 500 | Server error — retry or contact support |

---

## Search

### `POST /api/v1/search`

Retrieval-only search — returns ranked document chunks without LLM generation. Useful for building custom UIs or pipelines.

```bash
curl -s https://your-app.com/api/v1/search \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "pet policy details", "topK": 5}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | Search query text |
| `topK` | number | No | Max results (default: 5) |
| `filters.documentIds` | string[] | No | Restrict to specific documents |
| `filters.mimeTypes` | string[] | No | Filter by MIME type |

**Response:**

```json
{
  "data": {
    "results": [
      {
        "chunkId": 123,
        "chunkIndex": 0,
        "documentId": "uuid",
        "documentName": "lease.pdf",
        "content": "The pet policy states...",
        "metadata": {},
        "similarity": 0.85,
        "rrfScore": 0.032
      }
    ],
    "queryTokenCount": 4
  }
}
```

---

## Health Check

### `GET /api/v1/health`

Returns service health status. **No authentication required.**

```bash
curl -s https://your-app.com/api/v1/health
```

**Response:**

```json
{ "status": "ok" }
```

---

## Classifications

The classification pipeline provides AI-proposed labels for semantic units extracted from documents. Deployments define their own label schemas; the boilerplate handles the review workflow.

### `GET /api/v1/classifications`

List classification proposals with optional filters.

```bash
curl -s "https://your-app.com/api/v1/classifications?status=pending&limit=20" \
  -H "Authorization: Bearer sk-your-key"
```

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status: pending, approved, modified, rejected |
| `document_id` | string | Filter by document UUID |
| `limit` | number | Max results (default: 50, max: 100) |
| `offset` | number | Pagination offset (default: 0) |

### `PUT /api/v1/classifications/:id`

Review a single classification proposal.

```bash
curl -s https://your-app.com/api/v1/classifications/42 \
  -X PUT \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | One of: approved, modified, rejected |
| `reviewerLabels` | object | No | Corrected labels (when status is "modified") |

### `PUT /api/v1/classifications/bulk`

Bulk review up to 100 proposals at once.

```bash
curl -s https://your-app.com/api/v1/classifications/bulk \
  -X PUT \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 3], "status": "approved"}'
```

### `GET /api/v1/classifications/stats`

Get aggregate counts by status.

```bash
curl -s "https://your-app.com/api/v1/classifications/stats" \
  -H "Authorization: Bearer sk-your-key"
```

**Response:**

```json
{
  "data": {
    "pending": 42,
    "approved": 15,
    "modified": 3,
    "rejected": 2
  }
}
```

---

## Rate limits

There are currently no rate limits enforced on the API. This may change in future versions.

---

## Quick start

```bash
# 1. Create an API key in the dashboard (Settings > API Keys)

# 2. List your documents
curl -s https://your-app.com/api/v1/documents \
  -H "Authorization: Bearer sk-your-key" | jq

# 3. Upload a document
curl -s https://your-app.com/api/v1/documents \
  -H "Authorization: Bearer sk-your-key" \
  -F "file=@lease-agreement.pdf" | jq

# 4. Ask a question (non-streaming)
curl -s https://your-app.com/api/v1/chat \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What are the key terms in my lease?"}], "stream": false}' | jq

# 5. Ask a question (streaming)
curl -N https://your-app.com/api/v1/chat \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is the pet policy?"}]}'
```
