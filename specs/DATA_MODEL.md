# Data Model: RAG Boilerplate

## Entity Relationship Diagram

```
auth.users (Supabase managed)
    │
    ├──── profiles (1:1)
    │
    └──── organization_members (M:M) ──── organizations
                                              │
                ┌─────────────────────────────┤
                │              │              │
           documents    conversations    usage_logs
                │              │
        document_chunks    messages
                │
        eval_test_sets ──── eval_test_cases ──── eval_results
```

## Tables

### profiles
User profile information, created automatically on signup via trigger.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK, FK → auth.users(id) | User ID |
| display_name | text | | User's display name |
| avatar_url | text | | Profile image URL |
| current_organization_id | uuid | FK → organizations(id) | Active org context |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | |

```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  current_organization_id uuid REFERENCES public.organizations(id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### organizations
Multi-tenant organization support.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Organization ID |
| name | text | NOT NULL | Organization name |
| slug | text | UNIQUE, NOT NULL | URL-safe identifier |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
```

### organization_members
Junction table for user-organization relationship.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| organization_id | uuid | PK, FK → organizations(id) | |
| user_id | uuid | PK, FK → auth.users(id) | |
| role | text | CHECK | owner, admin, member |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.organization_members (
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
```

### documents
Uploaded documents (the source files).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Document ID |
| organization_id | uuid | FK, NOT NULL | Tenant scope |
| uploaded_by | uuid | FK → auth.users(id), NOT NULL | Who uploaded |
| name | text | NOT NULL | Original filename |
| storage_path | text | NOT NULL | Supabase Storage path |
| mime_type | text | NOT NULL | application/pdf, text/markdown, etc. |
| file_size | bigint | | File size in bytes |
| content_hash | text | | SHA-256 hash for delta processing |
| status | text | NOT NULL, DEFAULT 'pending' | pending, processing, complete, error |
| error_message | text | | Error details if status = 'error' |
| chunk_count | integer | DEFAULT 0 | Number of chunks generated |
| metadata | jsonb | DEFAULT '{}' | Vertical-specific metadata |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint,
  content_hash text,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'complete', 'error')),
  error_message text,
  chunk_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX documents_organization_id_idx ON public.documents(organization_id);
CREATE INDEX documents_status_idx ON public.documents(status);

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

### document_chunks
Chunked content with embeddings and full-text search. The core RAG table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | bigint | PK, GENERATED ALWAYS AS IDENTITY | Chunk ID |
| document_id | uuid | FK → documents(id), NOT NULL | Parent document |
| organization_id | uuid | FK → organizations(id), NOT NULL | Denormalized for RLS performance |
| content | text | NOT NULL | Chunk text content |
| embedding | vector(1536) | | OpenAI text-embedding-3-small |
| fts | tsvector | GENERATED ALWAYS | Full-text search vector |
| chunk_index | integer | NOT NULL | Position within document |
| token_count | integer | | Approximate token count |
| metadata | jsonb | DEFAULT '{}' | Section headers, page number, etc. |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.document_chunks (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  chunk_index integer NOT NULL,
  token_count integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Vector similarity search index
CREATE INDEX document_chunks_embedding_idx
  ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 100);

-- Full-text search index
CREATE INDEX document_chunks_fts_idx ON public.document_chunks USING gin(fts);

-- Lookup by document (for cascade operations)
CREATE INDEX document_chunks_document_id_idx ON public.document_chunks(document_id);

-- RLS performance: filter by org before vector search
CREATE INDEX document_chunks_organization_id_idx ON public.document_chunks(organization_id);
```

### conversations
Chat conversation sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Conversation ID |
| organization_id | uuid | FK, NOT NULL | Tenant scope |
| user_id | uuid | FK → auth.users(id), NOT NULL | Conversation owner |
| title | text | | Auto-generated or user-set title |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX conversations_organization_id_idx ON public.conversations(organization_id);
CREATE INDEX conversations_user_id_idx ON public.conversations(user_id);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

### messages
Chat messages within conversations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Message ID |
| conversation_id | uuid | FK → conversations(id), NOT NULL | Parent conversation |
| organization_id | uuid | FK, NOT NULL | Denormalized for RLS |
| role | text | NOT NULL, CHECK | 'user' or 'assistant' |
| content | text | NOT NULL | Message text |
| sources | jsonb | | Array of source citations |
| token_count | integer | | Tokens used for this message |
| model | text | | Which LLM model was used |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  sources jsonb,
  token_count integer,
  model text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX messages_conversation_id_idx ON public.messages(conversation_id);
CREATE INDEX messages_organization_id_idx ON public.messages(organization_id);
```

### usage_logs
Per-query cost tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | bigint | PK, GENERATED ALWAYS AS IDENTITY | |
| organization_id | uuid | FK, NOT NULL | Tenant scope |
| user_id | uuid | FK → auth.users(id) | Who made the query |
| query_text | text | | The user's question (for audit) |
| embedding_tokens | integer | DEFAULT 0 | Tokens used for query embedding |
| llm_input_tokens | integer | DEFAULT 0 | Tokens sent to LLM |
| llm_output_tokens | integer | DEFAULT 0 | Tokens generated by LLM |
| embedding_cost | numeric(10,6) | DEFAULT 0 | Cost of embedding |
| llm_cost | numeric(10,6) | DEFAULT 0 | Cost of generation |
| total_cost | numeric(10,6) | GENERATED ALWAYS | Sum of embedding + llm cost |
| model | text | | Which LLM model was used |
| chunks_retrieved | integer | | Number of chunks returned by search |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.usage_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  query_text text,
  embedding_tokens integer DEFAULT 0,
  llm_input_tokens integer DEFAULT 0,
  llm_output_tokens integer DEFAULT 0,
  embedding_cost numeric(10,6) DEFAULT 0,
  llm_cost numeric(10,6) DEFAULT 0,
  total_cost numeric(10,6) GENERATED ALWAYS AS (embedding_cost + llm_cost) STORED,
  model text,
  chunks_retrieved integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX usage_logs_organization_id_idx ON public.usage_logs(organization_id);
CREATE INDEX usage_logs_created_at_idx ON public.usage_logs(created_at);
```

### eval_test_sets
Golden evaluation test sets.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Test set ID |
| organization_id | uuid | FK, NOT NULL | Tenant scope |
| name | text | NOT NULL | Test set name |
| description | text | | What this test set covers |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.eval_test_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_test_sets_organization_id_idx ON public.eval_test_sets(organization_id);
```

### eval_test_cases
Individual test cases within a test set.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Test case ID |
| test_set_id | uuid | FK → eval_test_sets(id), NOT NULL | Parent test set |
| question | text | NOT NULL | The query to test |
| expected_answer | text | | Expected answer (for generation eval) |
| expected_source_ids | uuid[] | | Document IDs that should be retrieved |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.eval_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE CASCADE NOT NULL,
  question text NOT NULL,
  expected_answer text,
  expected_source_ids uuid[],
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_test_cases_test_set_id_idx ON public.eval_test_cases(test_set_id);
```

### eval_results
Evaluation run results.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PK | Result ID |
| test_set_id | uuid | FK → eval_test_sets(id), NOT NULL | Which test set was run |
| organization_id | uuid | FK, NOT NULL | Tenant scope |
| config | jsonb | NOT NULL | Configuration used (top_k, chunk_size, etc.) |
| precision_at_k | numeric(5,4) | | Precision@k score |
| recall_at_k | numeric(5,4) | | Recall@k score |
| mrr | numeric(5,4) | | Mean Reciprocal Rank |
| per_case_results | jsonb | | Detailed per-test-case breakdown |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  config jsonb NOT NULL,
  precision_at_k numeric(5,4),
  recall_at_k numeric(5,4),
  mrr numeric(5,4),
  per_case_results jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_results_test_set_id_idx ON public.eval_results(test_set_id);
CREATE INDEX eval_results_organization_id_idx ON public.eval_results(organization_id);
```

### document_access_logs
Audit trail for document access (security requirement).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | bigint | PK, GENERATED ALWAYS AS IDENTITY | |
| organization_id | uuid | FK, NOT NULL | Tenant scope |
| user_id | uuid | FK → auth.users(id) | Who accessed |
| document_id | uuid | FK → documents(id) | Which document |
| query_text | text | | What they searched for |
| chunks_returned | integer | | How many chunks were in the result |
| created_at | timestamptz | NOT NULL | |

```sql
CREATE TABLE public.document_access_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  query_text text,
  chunks_returned integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX document_access_logs_org_idx ON public.document_access_logs(organization_id);
CREATE INDEX document_access_logs_created_idx ON public.document_access_logs(created_at);
```

## RPC Functions

### hybrid_search
The core retrieval function combining vector and full-text search.

```sql
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.0,
  rrf_k int DEFAULT 60
)
RETURNS TABLE (
  chunk_id bigint,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float,
  fts_rank float,
  rrf_score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH semantic AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      dc.metadata,
      1 - (dc.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank_ix
    FROM public.document_chunks dc
    WHERE dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  full_text AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      dc.metadata,
      ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) AS fts_rank,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) DESC) AS rank_ix
    FROM public.document_chunks dc
    WHERE dc.fts @@ websearch_to_tsquery('english', query_text)
    ORDER BY fts_rank DESC
    LIMIT match_count * 2
  )
  SELECT
    COALESCE(s.id, f.id) AS chunk_id,
    COALESCE(s.document_id, f.document_id) AS document_id,
    COALESCE(s.content, f.content) AS content,
    COALESCE(s.metadata, f.metadata) AS metadata,
    COALESCE(s.similarity, 0.0)::float AS similarity,
    COALESCE(f.fts_rank, 0.0)::float AS fts_rank,
    (
      COALESCE(semantic_weight / (rrf_k + s.rank_ix), 0.0) +
      COALESCE(full_text_weight / (rrf_k + f.rank_ix), 0.0)
    )::float AS rrf_score
  FROM semantic s
  FULL OUTER JOIN full_text f ON s.id = f.id
  ORDER BY rrf_score DESC
  LIMIT match_count;
END;
$$;
-- Note: No SECURITY DEFINER — defaults to SECURITY INVOKER, so RLS applies
```

### get_user_organizations
Helper function for RLS policies.

```sql
CREATE OR REPLACE FUNCTION public.get_user_organizations()
RETURNS SETOF uuid AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

## Row Level Security Policies

### Enable RLS on ALL tables
```sql
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eval_test_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eval_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_access_logs ENABLE ROW LEVEL SECURITY;
```

### profiles
```sql
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
```

### organizations
```sql
CREATE POLICY "Users can view their organizations"
  ON public.organizations FOR SELECT
  USING (id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Authenticated users can create organizations"
  ON public.organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
```

### organization_members
```sql
CREATE POLICY "Users can view org members"
  ON public.organization_members FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Org owners can manage members"
  ON public.organization_members FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );
```

### documents
```sql
CREATE POLICY "Users can view org documents"
  ON public.documents FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can upload to their org"
  ON public.documents FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can update org documents"
  ON public.documents FOR UPDATE
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can delete org documents"
  ON public.documents FOR DELETE
  USING (organization_id IN (SELECT public.get_user_organizations()));
```

### document_chunks
```sql
CREATE POLICY "Users can view org chunks"
  ON public.document_chunks FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can delete org chunks"
  ON public.document_chunks FOR DELETE
  USING (organization_id IN (SELECT public.get_user_organizations()));
```

### conversations & messages
```sql
CREATE POLICY "Users can view org conversations"
  ON public.conversations FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can create conversations in their org"
  ON public.conversations FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can delete own conversations"
  ON public.conversations FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can view org messages"
  ON public.messages FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can create messages in their org"
  ON public.messages FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
```

### usage_logs & document_access_logs
```sql
CREATE POLICY "Users can view org usage"
  ON public.usage_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "System can insert usage logs"
  ON public.usage_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can view org access logs"
  ON public.document_access_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "System can insert access logs"
  ON public.document_access_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
```

### eval tables
```sql
CREATE POLICY "Users can manage org test sets"
  ON public.eval_test_sets FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can manage test cases in their org's test sets"
  ON public.eval_test_cases FOR ALL
  USING (test_set_id IN (
    SELECT id FROM public.eval_test_sets
    WHERE organization_id IN (SELECT public.get_user_organizations())
  ));

CREATE POLICY "Users can view org eval results"
  ON public.eval_results FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
```

## Migrations Order

1. Enable extensions (moddatetime, pgcrypto, vector)
2. Create profiles table + trigger + signup function
3. Create organizations + organization_members + helper function
4. Create documents table
5. Create document_chunks table with indexes (HNSW, GIN, btree)
6. Create conversations + messages tables
7. Create eval tables (test_sets, test_cases, results)
8. Create usage_logs + document_access_logs tables
9. Enable RLS on ALL tables
10. Create RLS policies
11. Create RPC functions (hybrid_search, get_user_organizations)
12. Seed PropTech demo data (optional)

## PropTech Demo Metadata Schema

The `metadata` jsonb column on `documents` and `document_chunks` supports vertical-specific fields:

```json
// documents.metadata (PropTech)
{
  "document_type": "lease_agreement",
  "property_address": "123 Main St, Unit 4B",
  "effective_date": "2025-01-01",
  "expiry_date": "2026-12-31",
  "parties": ["Landlord LLC", "Jane Tenant"]
}

// document_chunks.metadata
{
  "section_header": "Section 12: Maintenance and Repairs",
  "page_number": 8,
  "chunk_type": "text",
  "document_name": "Lease Agreement - 123 Main St"
}
```

---
*Generated by spec-driven-dev skill*
*Last updated: 2026-02-18*
