# Docling Document Preservation & Structured Extraction Pipeline

## Summary

Three enhancements to the RAG boilerplate's ingestion pipeline that make the platform more capable for any deployment that needs to extract structured information from unstructured documents — not just search them.

**Context:** These enhancements were identified while designing a Proposal Language Library for a defense consulting firm's BD team. But the mechanisms are general-purpose and belong in the boilerplate itself.

**Current state of Docling usage:** The boilerplate already leverages DoclingDocument's structural parsing — `doc.iterate_items()` walks the tree, extracts sections with heading hierarchy, tracks page provenance. But the full DoclingDocument is discarded after parsing, the built-in semantic chunkers aren't used, and there's no pipeline for extracting structured records from documents.

---

## The Problem These Enhancements Solve

The boilerplate today is a **search engine over documents** — upload docs, chunk them, embed them, search them, chat with them. That's powerful, but many real-world deployments need more than search. They need to **extract structured, human-curated records from unstructured documents**.

### The Pattern

Organizations accumulate knowledge in unstructured documents — proposals, contracts, reports, policies, manuals. That knowledge has implicit structure (a paragraph about past performance, a clause about liability, a section on compliance requirements) but it's trapped in document form. To make it reusable, someone has to:

1. Read the document
2. Identify meaningful passages
3. Classify each passage with metadata (what type is it? what topic? what category?)
4. Store the classified passage as a structured, searchable record
5. Repeat for every document, forever

This is exactly what the boilerplate's first real deployment needs: a BD team has 37 past proposal responses (RFIs, RFQs, SSNs, White Papers). One team member manually built an 848-entry Excel spreadsheet by reading each document, extracting reusable paragraphs, and tagging them with proposal section, category, department, doc type, and source document. It's painstaking, manual, and doesn't scale.

### Why the Boilerplate Should Solve This

The boilerplate already parses documents with Docling, which understands document structure (headings, paragraphs, lists, tables, reading order). All the raw material for automated extraction is there — it's just being discarded after chunking. These enhancements preserve that structural understanding and build a pipeline on top of it.

The value proposition shifts from "upload docs and chat with them" to "upload docs, chat with them immediately, AND the system proposes structured records that a human reviews and approves." RAG search is the floor; structured extraction is the ceiling.

### Concrete Use Cases Across Verticals

| Vertical | Documents | Extracted Records | Metadata |
|----------|-----------|-------------------|----------|
| **Proposal/BD** | Past RFIs, RFQs, white papers | Reusable proposal language entries | Proposal section, category, department, doc type, contractor |
| **Legal** | Contracts, agreements, case files | Clause library entries | Clause type, jurisdiction, risk level, applicability |
| **Compliance** | Regulations, audit reports, policies | Requirement records | Regulation, requirement type, effective date, applicability |
| **Knowledge Management** | Internal reports, research, playbooks | Knowledge base articles | Topic, audience, content type, freshness |
| **HR/Training** | SOPs, training materials, handbooks | Procedure records | Department, role, skill area, certification |
| **Insurance** | Policies, claims, underwriting docs | Coverage/exclusion records | Policy type, coverage area, risk class |

In every case, the pattern is identical: parse → identify semantic units → classify with domain metadata → human reviews → structured records. The boilerplate should own the mechanism; deployments bring their domain schema.

### The Two-Tier Value Model

These enhancements create a two-tier value model for every deployment:

**Tier 1 (immediate, no human effort):** Documents are uploaded, parsed, chunked, embedded, and searchable via RAG. Chat and MCP search work immediately. This is what the boilerplate does today.

**Tier 2 (accumulates over time, human-in-the-loop):** The system also proposes structured records from each document. A human reviews and approves them, building a curated, filterable knowledge base alongside the RAG corpus. The more documents uploaded, the richer the structured library becomes.

Tier 1 delivers value on day one. Tier 2 compounds over time. Both operate on the same source documents with no duplicate upload or processing.

---

## Enhancement 1: Persist DoclingDocument JSON

### What
Store the full DoclingDocument JSON alongside each source document after parsing.

### Why
DoclingDocument's JSON export is lossless — it preserves the complete structural representation including heading hierarchy, element labels, page provenance, bounding boxes, and reading order. Every other representation (Markdown, chunks, proposed entries) can be regenerated from it. Without persistence, re-processing a document requires re-parsing the original file with Docling's ML models, which is slow and expensive.

Concrete use cases:
- Re-run classification/extraction pipelines against already-parsed documents when the pipeline improves
- Debug chunking or extraction issues by inspecting the original structure
- Support future features (document comparison, structural search, section-level navigation) without re-parsing

### How

**Parser change** (`services/ingestion/src/parser.py`):
- The parser already holds the DoclingDocument in `ParseResult.docling_doc` (used for VLM extraction)
- Add `docling_json: dict | None` to `ParseResult` populated via `doc.export_to_dict()`
- No change to the parsing logic itself — just capture what's already there

**Worker change** (`services/ingestion/src/worker.py`):
- After parsing, serialize `parse_result.docling_json` and store it
- Two storage options:
  - **Option A (recommended):** New JSONB column `docling_doc` on the `documents` table. Simple, queryable, backed up with the database. Size concern: a 50-page PDF might produce 200-500KB of JSON. For typical corpus sizes (hundreds of docs), this is negligible.
  - **Option B:** Store as a JSON file in Supabase Storage alongside the original document. Better for very large documents or corpora with thousands of docs where DB bloat matters.
- Add a config flag: `PERSIST_DOCLING_DOC=true` (default true for new deployments; existing deployments can opt in)

**Migration:**
```sql
ALTER TABLE public.documents
ADD COLUMN docling_doc jsonb;

COMMENT ON COLUMN public.documents.docling_doc IS
  'Lossless DoclingDocument JSON export. Preserves full structural representation for re-processing.';
```

**Effort:** Small. Parser already has the data; this just persists it.

---

## Enhancement 2: Semantic Unit Extraction via HierarchicalChunker

### What
Add a parallel extraction path that uses Docling's built-in `HierarchicalChunker` to produce one chunk per semantic unit (paragraph, list group, table, section) — separate from the existing token-optimized RAG chunks.

### Why
The current chunking pipeline (`chunker.py`) is optimized for RAG retrieval — it splits on paragraph/sentence/word boundaries and merges to a token budget. This produces chunks that are good for embedding and search but don't correspond to meaningful document units.

Docling's `HierarchicalChunker` produces one chunk per semantic element as identified by Docling's document understanding model. Each chunk:
- Corresponds to a natural document unit (a paragraph, a list, a table)
- Carries `chunk.meta.headings` — the full heading hierarchy above it
- Carries `chunk.meta.doc_items` — references back to the source DocItems with labels (`PARAGRAPH`, `LIST_ITEM`, `TABLE`, `SECTION_HEADER`, etc.)
- Has no token limit — it preserves the unit as-is

This is exactly what you need for structured extraction: "here's a paragraph from the Past Performance section — classify it."

### How

**New module** (`services/ingestion/src/semantic_units.py`):
```python
from docling_core.transforms.chunker.hierarchical_chunker import HierarchicalChunker

@dataclass
class SemanticUnit:
    content: str
    headings: list[str]           # ["Part 1", "Past Performance", "DTRA"]
    label: str                    # "paragraph", "list_item", "table", etc.
    page_numbers: list[int]
    unit_index: int               # Position in document reading order
    docling_ref: str              # JSON pointer back to DoclingDocument

def extract_semantic_units(docling_doc) -> list[SemanticUnit]:
    chunker = HierarchicalChunker()
    units = []
    for i, chunk in enumerate(chunker.chunk(dl_doc=docling_doc)):
        label = _infer_label(chunk.meta.doc_items)  # Map DocItem labels to simplified set
        units.append(SemanticUnit(
            content=chunk.text,
            headings=chunk.meta.headings,
            label=label,
            page_numbers=_extract_pages(chunk.meta.doc_items),
            unit_index=i,
            docling_ref=chunk.meta.doc_items[0].self_ref if chunk.meta.doc_items else None,
        ))
    return units
```

**Storage:** New table `document_semantic_units`:
```sql
CREATE TABLE public.document_semantic_units (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  content text NOT NULL,
  headings text[] NOT NULL,          -- Postgres array: ["Part 1", "Past Performance"]
  label text NOT NULL,               -- "paragraph", "list_item", "table", etc.
  page_numbers integer[],
  unit_index integer NOT NULL,
  docling_ref text,                  -- JSON pointer into docling_doc column
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- RLS: same pattern as document_chunks
ALTER TABLE public.document_semantic_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own org units"
  ON public.document_semantic_units FOR SELECT
  USING (organization_id = auth.jwt() -> 'app_metadata' ->> 'organization_id');

-- Indexes for common query patterns
CREATE INDEX idx_semantic_units_doc ON public.document_semantic_units(document_id);
CREATE INDEX idx_semantic_units_org ON public.document_semantic_units(organization_id);
CREATE INDEX idx_semantic_units_headings ON public.document_semantic_units USING GIN(headings);
CREATE INDEX idx_semantic_units_label ON public.document_semantic_units(label);
```

**Worker integration:** After Docling parsing, before chunking:
1. Extract semantic units from DoclingDocument
2. Store in `document_semantic_units`
3. Continue with existing chunking pipeline for RAG (unchanged)

**Config flag:** `EXTRACT_SEMANTIC_UNITS=true` (default false — opt-in per deployment)

**Relationship to existing chunks:** These are NOT replacements for RAG chunks. RAG chunks are optimized for retrieval (token-bounded, overlapping, contextualized). Semantic units are optimized for structured extraction (one unit = one meaningful passage). Both exist in parallel, both reference the same source document.

**Effort:** Medium. New module, new table, new step in worker pipeline. No changes to existing chunking or search.

---

## Enhancement 3: Classification Pipeline Scaffold

### What
A generic "classify & review" pipeline that takes semantic units from Enhancement 2, runs them through an AI classifier, and queues proposed classifications for human review.

### Why
The pattern "parse document → identify passages → classify with metadata → human reviews" is common across verticals:
- **Proposal/BD:** Classify by proposal section, category, department, doc type
- **Legal:** Classify by clause type, jurisdiction, risk level
- **Compliance:** Classify by regulation, requirement type, applicability
- **Knowledge management:** Classify by topic, audience, content type

The boilerplate should provide the mechanism (classification pipeline + review queue) while letting each deployment define its own metadata schema.

### How

**Classification is deployment-specific, but the scaffold is generic.**

The scaffold provides:

1. **Classification job queue** — After semantic units are extracted, a classification job is enqueued (pgmq). This decouples extraction from classification, allowing different classifiers per deployment.

2. **Classification result storage:**
```sql
CREATE TABLE public.classification_proposals (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  semantic_unit_id bigint REFERENCES public.document_semantic_units(id) ON DELETE CASCADE,
  content text NOT NULL,                    -- The passage text (denormalized for review UI)
  headings text[],                          -- From semantic unit (context for reviewer)
  proposed_labels jsonb NOT NULL,           -- Deployment-specific: {"section": "PAST PERFORMANCE", "category": "SDA", ...}
  confidence float,                         -- Classifier's confidence (0-1)
  status text NOT NULL DEFAULT 'pending',   -- pending | approved | modified | rejected
  reviewer_labels jsonb,                    -- What the human approved (may differ from proposed)
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_proposals_status ON public.classification_proposals(status);
CREATE INDEX idx_proposals_doc ON public.classification_proposals(document_id);
CREATE INDEX idx_proposals_org ON public.classification_proposals(organization_id);
```

3. **Classifier interface** — A Python protocol/abstract class that deployments implement:
```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class ClassificationResult:
    proposed_labels: dict        # Deployment-specific metadata
    confidence: float            # 0-1

class BaseClassifier(ABC):
    @abstractmethod
    async def classify(self, content: str, headings: list[str], label: str,
                       document_context: dict) -> ClassificationResult:
        """Classify a semantic unit. Returns proposed labels + confidence."""
        ...
```

Deployments implement this interface with their domain-specific prompt and label schema. The scaffold handles queuing, storage, status tracking, and the review API.

4. **Review API endpoints** (Next.js):
```
GET  /api/v1/classifications?status=pending&document_id=...
PUT  /api/v1/classifications/:id    { status: "approved", reviewer_labels: {...} }
PUT  /api/v1/classifications/bulk   { ids: [...], status: "approved" }
```

These endpoints are generic — they don't know what the labels mean. The review UI (built per-deployment) renders the labels appropriately.

5. **Aggregate statistics:**
```
GET  /api/v1/classifications/stats
  → { pending: 142, approved: 806, modified: 34, rejected: 8 }
GET  /api/v1/classifications/stats?document_id=...
  → { pending: 12, approved: 0, modified: 0, rejected: 0 }
```

**What the scaffold does NOT include:**
- The actual classifier implementation (deployment-specific)
- The review UI (deployment-specific — different label schemas need different UIs)
- The destination table for approved records (deployment-specific — e.g., `proposal_entries` for BD)

**Config flag:** `CLASSIFICATION_PIPELINE_ENABLED=false` (opt-in — most deployments won't need this)

**Effort:** Medium-large. New table, new queue, new API endpoints, abstract classifier interface. But well-scoped — no deployment-specific logic.

---

## Implementation Order

1. **Enhancement 1 (persist DoclingDocument)** — smallest, zero risk, enables the others. Do first.
2. **Enhancement 2 (semantic unit extraction)** — depends on Enhancement 1 (uses stored DoclingDocument for re-processing). Core data layer for Enhancement 3.
3. **Enhancement 3 (classification scaffold)** — depends on Enhancement 2 (classifies semantic units). Most complex but highest value.

**Relationship to auto-optimizer:** These enhancements are orthogonal to the auto-optimizer. The optimizer tunes RAG search quality; these enhancements add a structured extraction layer alongside RAG. No conflicts, no dependencies.

**Relationship to existing features:** All additive. The existing ingestion pipeline (parse → chunk → embed) is unchanged. Semantic units and classification are parallel paths through the same parsed document.

---

## Open Questions

1. **DoclingDocument storage size:** Need to profile a few real proposal PDFs to confirm JSON size is reasonable for JSONB storage vs. file storage.
2. **Semantic unit granularity:** HierarchicalChunker by default produces one chunk per element. Should we merge consecutive list items into a single unit (it supports `merge_list_items=True`)? For proposal extraction, probably yes — a bulleted list of capabilities is one logical entry.
3. **Classification queue priority:** Should recently uploaded documents jump ahead of older ones in the classification queue? Gabe uploads 5 docs for Monday's RFI — those should classify before the backlog.
4. **Confidence threshold for auto-approve:** Should high-confidence classifications (e.g., >0.95) be auto-approved to reduce Gabe's review burden? Or always require human review? Could be a deployment-level config.
5. **Re-classification on pipeline improvement:** When the classifier prompt improves, should existing approved records be flagged for re-review? Or only apply to new documents?
