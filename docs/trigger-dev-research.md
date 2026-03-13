# Trigger.dev Deep Dive: Comprehensive Research Report

*Compiled February 20, 2026*

## Executive Summary

Trigger.dev is a TypeScript-native, open-source background job and workflow orchestration platform that also manages its own compute runtime. It's currently on v4 (GA'd August 2025), has 13,700+ GitHub stars, 30,000+ developers, raised a $16M Series A in December 2025, and is increasingly positioning itself as AI agent infrastructure. For your specific project — Next.js + Supabase + a Python/FastAPI ingestion worker polling pgmq — it's a compelling but probably unnecessary addition. Here's the full picture.

---

## 1. What It Is and Core Architecture

Trigger.dev is not just a job queue library. It's a full execution platform: it controls both the queue layer AND the compute layer. This dual ownership is what enables its most powerful features.

**The core execution flow:**

```
Your App (trigger) → Trigger.dev API → Queue → Worker pulls job
                                    ↑
                   Returns handle with run ID immediately
```

But the more interesting path involves its checkpoint-resume system:

**CRIU-based checkpoint/restore (v3, cloud only):**
1. Task runs in an isolated container
2. When the task hits `triggerAndWait()` or any `wait.for()`, CRIU snapshots the full process state (memory, CPU registers, open file descriptors)
3. Snapshot is compressed and stored to disk
4. The container is released — no CPU or RAM consumed, no billing
5. When the subtask completes, the snapshot is restored into a new execution environment
6. Execution resumes exactly where it paused

In v4, this is supplemented by **warm starts**: when a run finishes, the machine stays alive briefly. Subsequent runs for the same task version reuse the same warm machine, delivering 100–300ms starts versus cold starts of several seconds. MicroVMs are on the roadmap for sub-500ms cold starts.

**Build system:** Uses esbuild to bundle your TypeScript into ESM-format Docker images. The same pipeline runs in dev and production. Tasks are registered as Docker images pushed to a container registry.

**OpenTelemetry native:** Logs and traces are auto-correlated across parent and child tasks using OTel. You can wire your own exporters (e.g., Axiom) directly from `trigger.config.ts`.

---

## 2. Key Features

### Tasks

Tasks are defined with the `task()` function, which is clean and strongly typed:

```typescript
import { task } from "@trigger.dev/sdk/v3";

const processDocument = task({
  id: "process-document",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },
  machine: { preset: "medium-1x" }, // 1 vCPU, 2 GB RAM
  maxDuration: 300, // 5 minutes
  run: async (payload: { documentId: string }, { ctx }) => {
    // long-running work here — no timeout anxiety
    return { chunksCreated: 42 };
  },
});
```

Key task configuration options:
- `id` — unique string, used for triggering and dashboard visibility
- `retry` — exponential backoff with jitter, configurable per-task
- `queue` — named queue with `concurrencyLimit`
- `machine` — CPU/RAM preset (micro through large-2x)
- `maxDuration` — optional hard cap in seconds
- Lifecycle hooks: `onStartAttempt`, `onSuccess`, `onFailure`, `onComplete`, `onCancel`, `onWait`, `onResume`, `middleware`

### Triggering Patterns

```typescript
// Fire-and-forget from your Next.js Server Action
const handle = await tasks.trigger<typeof processDocument>(
  "process-document",
  { documentId: "abc-123" }
);

// With options
await tasks.trigger("process-document", payload, {
  delay: "10m",
  ttl: "1h",
  idempotencyKey: `doc-${documentId}`,
  concurrencyKey: `org-${orgId}`, // per-tenant queue isolation
  tags: ["ingestion", orgId],
  priority: 100,
});

// Trigger from inside another task and wait for result
const result = await childTask.triggerAndWait({ ... });
if (result.ok) { /* result.output */ }

// Fan-out pattern
const results = await chunkTask.batchTriggerAndWait(
  chunks.map(chunk => ({ payload: chunk }))
);

// Streaming batch (SDK 4.3.1+) — avoids loading all items into memory
async function* generateChunks() {
  for (const chunk of chunks) { yield { payload: chunk }; }
}
await chunkTask.batchTrigger(generateChunks());
```

**Important Next.js caveat:** Use type-only imports in Server Actions to avoid pulling task runtime code into the app bundle:

```typescript
import type { processDocument } from "~/trigger/ingestion";
// Then call via:
await tasks.trigger<typeof processDocument>("process-document", payload);
```

### Debounce

Trigger.dev has native debounce support, which is genuinely useful:

```typescript
await tasks.trigger("reindex-org", payload, {
  debounce: {
    key: `org-${orgId}`,
    delay: "10s",
    mode: "trailing", // execute with the last payload
    maxDelay: "5m",   // guarantees execution within 5 min even under constant triggers
  }
});
```

### Concurrency Keys (Per-Tenant Isolation)

For multi-tenant workloads, `concurrencyKey` creates a sub-queue per value:

```typescript
// Each org gets its own concurrency slot — orgs don't block each other
await tasks.trigger("process-document", payload, {
  concurrencyKey: `org-${orgId}`,
  queue: { concurrencyLimit: 5 }, // 5 concurrent docs per org
});
```

### Queues (v4 change)

In v4, queues must be defined in code before deployment — you can no longer create them dynamically at trigger time. This was a deliberate breaking change to fix confusing behavior in v3 where dynamic queue creation led to unexpected concurrency limit issues. The new API includes `queues.pause()`, `queues.resume()`, and `queues.retrieve()` for programmatic control.

### Waitpoint Tokens (v4, Human-in-the-Loop)

```typescript
const { token, url } = await wait.createToken({
  timeout: "24h",
  idempotencyKey: `approval-${requestId}`,
});

// Pass `url` to your approval webhook handler
// When called, execution resumes
await wait.forToken(token); // run pauses here, billing stops
```

### Realtime

The Realtime API lets you stream run status to your frontend:

```typescript
// React hook (client side)
import { useRun } from "@trigger.dev/react-hooks";
const { run } = useRun(runId);
```

---

## 3. Self-Hosting vs Cloud

### Cloud

Full-featured managed service. Billing is compute-time based:

| Machine | vCPU | RAM | Cost/sec |
|---|---|---|---|
| Micro | 0.25 | 0.25 GB | $0.0000169 |
| Small 1x (default) | 0.5 | 0.5 GB | $0.0000338 |
| Medium 1x | 1 | 2 GB | $0.0000850 |
| Large 1x | 4 | 8 GB | $0.0003400 |

Plus $0.000025 per run invocation ($0.25 per 10,000 runs). Waiting tasks (checkpointed) do NOT count toward compute or concurrency billing. Dev runs are free.

### Pricing Tiers

| Plan | Price/mo | Included | Concurrent Runs | Retention |
|---|---|---|---|---|
| Free | $0 | $5 credit | 20 | 1 day |
| Hobby | $10 | $10 credit | 50 | 7 days |
| Pro | $50 | $50 credit | 200+ | 30 days |
| Enterprise | Custom | Custom | Custom | Custom |

The "included" credits roll off the plan fee — so Pro is $50/mo flat for the first $50 of compute, then pay-as-you-go beyond that.

### Self-Hosting

Trigger.dev is Apache 2.0 licensed and genuinely self-hostable. The v4 Docker setup is materially simpler than v3 was (no custom scripts, integrated registry and object storage, standard Compose).

**What you get with self-hosting:**
- Full webapp + dashboard
- Worker pool
- Built-in container registry
- Built-in object storage (no S3 needed)
- PostgreSQL (bundled or BYO)
- All core queueing, retry, scheduling features

**What you DON'T get (cloud-only):**
- Warm starts (cold starts only)
- Managed auto-scaling (manual container management)
- Checkpoints/CRIU-based pause (waits keep containers running, consuming RAM)
- Remote builds (must build and push images locally)
- Dedicated support

**Self-hosting hardware minimums:**
- 4 CPU cores, 8 GB RAM (single server)
- Kubernetes option available with official Helm chart (minimum ~6 vCPU, 12 GB RAM across cluster)
- Linux/Debian preferred; ARM not supported on legacy v3 (v4 status unclear)

**Known self-hosting gotchas:**
- `.env` misconfiguration is the #1 setup failure point
- Tutorial bugs in v4 guide: `.env.example` doesn't match `docker-compose.yml` postgres config
- No resource limits enforced on containers by default — tasks can starve other services
- VPC/private networking connection errors reported
- `npx trigger.dev init` must be run in your project root, not the Docker directory
- Without checkpoints, long waits consume RAM continuously (containers frozen, not killed)
- GitHub OAuth not recommended for self-hosted (can't restrict by email/account)
- "Not production-ready" per their own docs — intended for evaluation

**Bottom line on self-hosting:** It works, but you're owning the operational burden with no managed scaling and missing the headline performance features (warm starts, checkpoints). For a solo developer on Render, the cloud free tier or Hobby plan is almost certainly the right starting point.

---

## 4. Developer Experience

The SDK is TypeScript-first and genuinely well-designed. Highlights:

**`trigger.config.ts`** is the central config file:

```typescript
export const config: TriggerConfig = {
  project: "proj_xxx",
  runtime: "node-22",  // or "bun"
  defaultMachine: "small-1x",
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  telemetry: {
    instrumentations: [new OpenAIInstrumentation()],
  },
  build: {
    external: ["sharp"],  // native binaries must be external
  },
};
```

**Dev mode:** `npx trigger.dev@latest dev` — watches your `/trigger` directory, auto-restarts workers on file changes, communicates with the Trigger.dev server (cloud or local) for scheduling. Each task runs in a separate process for parallel execution. Dev runs are free.

**`schemaTask`:** Zod-validated payloads:

```typescript
const processDoc = schemaTask({
  id: "process-doc",
  schema: z.object({ documentId: z.string().uuid() }),
  run: async (payload) => { /* payload is typed */ }
});
```

**`locals` API:** Clean way to pass DB connections through middleware without leaking across wait boundaries:

```typescript
const DbLocal = locals.create<DbType>("db");
// In middleware: locals.set(DbLocal, db)
// In run: const db = locals.getOrThrow(DbLocal)
```

**`ai.tool(schemaTask)`:** Converts any task into a Vercel AI SDK tool — this is genuinely useful for the RAG AI agent pattern.

**Build extensions** let you install system packages in the container image:

```typescript
import { aptGet } from "@trigger.dev/build/extensions";
// Installs at image build time
extensions: [aptGet({ packages: ["poppler-utils", "pandoc"] })]
```

**One legitimate DX complaint:** In v3→v4, the lifecycle hook signatures changed:

```typescript
// v3
onStart: (payload, { ctx }) => {}

// v4
onStart: ({ payload, ctx }) => {}
```

This is a real breaking change, though the migration guide exists and the team says "most migrations take under 5 minutes."

---

## 5. Integrations

**Officially listed integrations (first-party or documented):**
- Vercel AI SDK (v4, v5, v6 all supported)
- OpenAI / DALL-E
- Anthropic (via AI SDK)
- Supabase (explicitly listed on their homepage)
- Resend
- Fal.ai, Deepgram, Firecrawl, Browserbase
- Sentry (via OTel)
- Prisma (via OTel instrumentation)
- AWS SDK (via OTel)
- Puppeteer, Playwright, FFmpeg, LibreOffice, Sharp (via build extensions)

**Next.js integration:** No separate package needed. Use `tasks.trigger()` from Server Actions or Route Handlers with type-only imports. The `trigger.dev@latest dev` CLI runs alongside `next dev`. Works on Vercel (serverless) or Render (long-running).

**Supabase:** No dedicated Supabase SDK integration, but there's nothing preventing you from using the Supabase JS client inside tasks. The documented pattern is just importing and using `createClient()` normally within a task's `run` function.

**Vercel:** Native Vercel integration is on the roadmap (env var sync, preview branch sync). Currently works on Vercel but requires manual env var setup.

**Render:** Should work fine — your Next.js app on Render triggers tasks via `tasks.trigger()`, tasks execute on Trigger.dev's own workers. No special Render integration required.

---

## 6. v2 vs v3 vs v4

| Feature | v2 | v3 | v4 |
|---|---|---|---|
| Execution model | In-process (serverless fn) | Isolated Docker containers | Docker containers + warm starts |
| Timeouts | Yes (serverless limits) | No | No |
| Checkpoints | No | Yes (CRIU, cloud only) | Yes (CRIU, cloud only) |
| Build system | None (ran in your app) | esbuild → Docker | esbuild → Docker (improved) |
| Queue definition | Static | Dynamic at trigger-time | Must be defined in code pre-deploy |
| Self-hosting | Simple (single container) | Harder (multi-component) | Docker Compose, Helm chart |
| Status | EOL Jan 31, 2025 | Deprecated | Current (GA Aug 2025) |

**v2 is dead.** It was shut down January 31, 2025. v3 is the stable baseline, and v4 is the current recommended version with warm starts and the new Run Engine.

The architectural shift from v2→v3 was a fundamental rewrite: they moved from running tasks inside your existing serverless functions (which caused timeout issues and cold start dependencies) to running tasks in their own isolated Docker containers on their own infrastructure. This is the correct architectural decision but it also means Trigger.dev is now more like a managed compute platform than a library.

---

## 7. Community and Adoption

- **GitHub:** 13,700+ stars, 1,016+ forks — meaningfully ahead of Inngest (~4,850 stars)
- **Users:** 30,000+ developers on the platform
- **Scale:** Hundreds of millions of agent runs per month
- **Funding:** $16M Series A (December 2025), backed by Y Combinator, Dalton Caldwell, Paul Buchheit
- **Release cadence:** 1–4 changelog entries per week — actively developed
- **Discord:** Active community, team is responsive
- **v2 EOL managed well:** Migration guide provided, given several months notice, gradual migration path

**Who's using it:** MagicSchool (EdTech AI), Icon.com, DavidAI, and the broader AI/startup space. The 6,000 documents/month ingestion use case mentioned in their own docs is directly analogous to a RAG pipeline.

---

## 8. Limitations and Known Gotchas

**Platform gotchas:**
1. **No Python support.** Trigger.dev is TypeScript/Node.js only. Your Python/FastAPI ingestion service cannot be a Trigger.dev task. This is the single biggest limitation for your specific project.
2. **Vendor lock-in on runtime.** Your tasks run on their workers. You cannot use arbitrary compute environments. Build extensions help, but you're still building Docker images that run on their infrastructure.
3. **Cold starts on self-hosted.** Without warm starts (cloud-only), self-hosted tasks have cold start latency on every run.
4. **Queue definition is now pre-deploy.** The v4 change to require queues defined in code (not dynamically) is a good design decision but is a migration blocker and requires planning around queue structure upfront.
5. **Self-hosted checkpoints don't work well.** Without CRIU checkpoints, `triggerAndWait()` keeps containers running (consuming RAM) during waits. For long-wait patterns, this is expensive on your own hardware.
6. **esbuild bundling quirks.** Native binaries (sharp, re2, sqlite3, WASM modules) must be explicitly marked `external` or they'll fail to bundle. This is not unique to Trigger.dev but is a paper cut.
7. **API rate limits.** Free tier: 60 requests/min. Paid: 1,500 requests/min. High-frequency triggering (e.g., per-request RAG ingestion) needs the paid tier.
8. **Payload limits.** 512KB auto-offloaded to object storage. 10MB hard limit for payloads, 100MB for outputs. For large document ingestion, you'd pass S3/Supabase Storage URLs rather than raw content.
9. **Log retention.** Free: 1 day. Hobby: 7 days. Pro: 30 days. Debugging production issues on the free tier is painful.
10. **v2→v3 migration was painful** (though v3→v4 was deliberately designed to be easier).

---

## 9. Comparison to Alternatives

### Trigger.dev vs Inngest

| Dimension | Trigger.dev | Inngest |
|---|---|---|
| Architecture | Manages its own compute | Event-driven, runs inside your serverless functions |
| Timeouts | No limit | Depends on your function host (Vercel = 60s on hobby) |
| System packages | Yes (build extensions, apt-get) | No — limited by serverless bundle size |
| Python support | No | No |
| Atomic versioning | Yes | Yes |
| GitHub stars | 13,700+ | ~4,850 |
| Self-hosting | Yes (Docker/Kubernetes) | Yes |
| Step functions | Via subtasks | Native `step.run()` inside single function |
| Inngest's model | — | Steps inside one function that checkpoint themselves |
| Best for | Long-running, compute-heavy, AI pipelines | Event-driven workflows, multi-tenant SaaS |

Inngest's model is notably different: you write steps inside a single function definition, and Inngest handles checkpointing between steps within your existing serverless infrastructure. This means no separate worker pool — it runs inside your Vercel/Netlify/etc. functions. Trigger.dev's model gives you more power (longer runs, custom system packages, more machine sizes) at the cost of more infrastructure complexity.

### Trigger.dev vs BullMQ

| Dimension | Trigger.dev | BullMQ |
|---|---|---|
| Infrastructure | Managed (Cloud) or Docker | Self-hosted, requires Redis |
| Language | TypeScript only | TypeScript/Node.js |
| Observability | Built-in dashboard | DIY (Bull Board plugin exists) |
| Timeouts | None | Node.js process limits |
| Retries | Built-in | Built-in |
| Scheduling | Built-in | Bull's CRON |
| Deployment | Separate from your app | Runs in your app process |
| Complexity | High (separate service) | Low (just Redis + library) |

BullMQ is simpler if you already have Redis and want workers co-located with your app. Trigger.dev is better if you want managed infrastructure, observability, and no timeout anxiety.

### Trigger.dev vs Your Current pgmq Stack

Your current setup: Python/FastAPI worker polling a pgmq queue in Supabase.

| Dimension | pgmq + Python Worker | Trigger.dev |
|---|---|---|
| Language | Python (can use any Python library) | TypeScript only |
| Infrastructure | Already have it (Supabase) | Additional service |
| Observability | DIY | Built-in dashboard |
| Retries | Manual (visibility timeout + re-enqueue) | Automatic |
| Scheduling | DIY | Built-in cron |
| Cost | Supabase compute only | Trigger.dev compute pricing |
| Timeouts | None (long-polling) | None |
| Vendor dependency | Supabase (already a dependency) | New vendor |

**The honest assessment for your project:** Your existing pgmq + Python worker is already solving the core problem (durable, long-running ingestion without timeouts). Trigger.dev would replace it with something more opinionated and observable, but at the cost of a language switch to TypeScript and a new vendor dependency. The Python ingestion worker is a genuine architectural advantage — you can use libraries like `docling`, `pypdf`, `unstructured`, etc. that have no TypeScript equivalent.

### Trigger.dev vs Temporal

Temporal is the spiritual predecessor in the "durable execution" space. Trigger.dev's team explicitly positions it as "an easier-to-use Temporal with integrations." Temporal is more powerful (multi-language, more complex workflow patterns, stronger consistency guarantees) but significantly harder to operate. For most applications, Trigger.dev's simpler model is sufficient and the DX is dramatically better.

---

## 10. Relevance to Your Specific Project

Your stack: Next.js 15 + Supabase + Python/FastAPI ingestion worker + pgmq.

**Where Trigger.dev would help:**

- The TypeScript side of your ingestion pipeline (triggering ingestion from Server Actions, tracking status, real-time progress in the UI via the Realtime hooks)
- Document processing tasks that can be written in TypeScript (if you replace Python with TypeScript parsers)
- Eval runs, scheduled jobs, anything you'd currently build with a cron + Next.js API route
- Observability — right now your pgmq worker has no built-in dashboard; Trigger.dev gives you one for free
- Retry semantics — your current pgmq visibility timeout mechanism is manual; Trigger.dev makes retries declarative

**Where Trigger.dev would NOT help (or would make things worse):**

- Your Python worker. Trigger.dev has no Python SDK. You'd have to rewrite the ingestion logic in TypeScript. Given you're using Docling (a Python-only library), this is a non-starter unless you're prepared to use TypeScript alternatives.
- Supabase pgmq queue replacement — Trigger.dev handles its own internal queue; you'd give up direct Postgres visibility into your job queue
- Adding complexity without clear benefit — you already have a working queue, it's just less observable

**The most realistic integration path:**

Rather than replacing your Python worker with Trigger.dev, you could use Trigger.dev for TypeScript-side jobs while keeping the Python worker:

1. User uploads document → Next.js Server Action calls `tasks.trigger("queue-for-ingestion", { documentId })`
2. Trigger.dev task inserts a record into pgmq (your existing Python queue mechanism)
3. Python worker processes it as before
4. Python worker updates Supabase DB when done
5. Trigger.dev task polls/waits for completion and updates status

This gives you the Trigger.dev dashboard and retry semantics on the coordination layer without replacing Python. But honestly, this is adding a layer to solve a problem you already solve with Supabase + pgmq directly from the Next.js Server Action.

**The real value proposition for your boilerplate:** If you wanted to ship a boilerplate where buyers can run long jobs without worrying about Vercel's 60-second timeout, Trigger.dev is compelling. But you're already on Render (which has no such limit), and you already have pgmq. The marginal value is observability and DX polish — not unblocking a hard technical problem.

---

## Final Verdict

**Trigger.dev is genuinely excellent** for what it is: a TypeScript-native, managed background job platform with excellent DX, no timeout anxiety, built-in observability, and strong AI agent tooling. The $16M Series A and 30,000 developers suggest it's not going anywhere. The v4 architecture (warm starts, Run Engine) is mature.

**But it's likely premature for your project today**, for three reasons:

1. **Python wall:** Your ingestion worker is Python. Trigger.dev can't touch it.
2. **Redundancy:** pgmq already handles your queueing. Adding Trigger.dev means two queuing systems with unclear ownership boundaries.
3. **Complexity cost:** You'd add a new vendor, new CLI, new deploy pipeline, and new runtime — for a boilerplate that's already selling infrastructure simplicity.

**When it would make sense to revisit:** If you ever port the ingestion pipeline to TypeScript (e.g., using `pdf-parse`, `langchain`'s JS document loaders, or Vercel's AI SDK for extraction), Trigger.dev becomes a very natural fit. The `aptGet` build extension means you could install system-level tools. The Supabase integration is explicitly documented. The AI SDK compatibility is first-class. And the observability story for a paid boilerplate ("here's your job dashboard") is a real selling point.

---

## Addendum: Nate Herk Video Synthesis

*From a YouTube transcript shared during the same session*

The transcript validates several things the docs claim:

1. **Time-to-value is real.** He built 6 working tasks (3 tools + 3 scheduled) in ~90 minutes with zero prior Trigger.dev experience. One-shot prompted via Claude Code.

2. **The dev → prod workflow is clean.** `npx trigger.dev@latest dev` for local testing, push to GitHub, GitHub syncs to Trigger.dev production automatically. Very similar to Vercel's deploy-on-push model.

3. **Observability out of the box.** He demos watching agents execute live — seeing each tool call, each step's duration, retries with backoff. This is the dashboard you'd have to build yourself with pgmq.

4. **Claude Code + Trigger.dev = natural pairing.** Claude Code writes the TypeScript tasks, you push to Trigger.dev. The `CLAUDE.md` + `trigger-ref.md` pattern he uses is essentially giving Claude Code an API reference to write tasks correctly.

5. **The rough edges are real too.** Deduplication didn't work on first try. Yelp API was dead. He had to iterate on the plan. His summary: "this really shows the importance of using plan mode."

6. **The use case that shines: agentic loops in the cloud.** His ClickUp research agent is non-deterministic — it decides which tools to call, when to loop, when to stop. Trigger.dev handles the scheduling, retries, and observability around that. This is where it's genuinely better than a cron + API route.

---

## Sources

- [Trigger.dev Introduction](https://trigger.dev/docs/introduction)
- [Trigger.dev: How It Works](https://trigger.dev/docs/how-it-works)
- [Trigger.dev Tasks Overview](https://trigger.dev/docs/tasks/overview)
- [Trigger.dev Self-Hosting (Legacy Docker)](https://trigger.dev/docs/open-source-self-hosting)
- [Trigger.dev Pricing](https://trigger.dev/pricing)
- [Trigger.dev v4 GA Launch Week](https://trigger.dev/launchweek/2/trigger-v4-ga)
- [Self-Hosting v4 Docker Guide](https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker)
- [Trigger.dev Series A ($16M)](https://trigger.dev/blog/series-a)
- [Trigger.dev Roadmap](https://trigger.dev/blog/our-roadmap-for-the-next-3-months)
- [Trigger.dev Changelog](https://trigger.dev/changelog)
- [Trigger.dev config-file docs](https://trigger.dev/docs/config/config-file)
- [HN: Trigger.dev vs Inngest discussion](https://news.ycombinator.com/item?id=45252099)
- [BullMQ vs Trigger.dev GitHub Discussion](https://github.com/triggerdotdev/trigger.dev/discussions/922)
- [Trigger.dev v3 Self-Hosting Bug Report](https://github.com/triggerdotdev/trigger.dev/issues/2186)
- [PGMQ: Supabase Docs](https://supabase.com/docs/guides/database/extensions/pgmq)
- [PGMQ GitHub](https://github.com/pgmq/pgmq)
- [Inngest vs Trigger.dev Comparison - OpenAlternative](https://openalternative.co/compare/inngest/vs/trigger)
- [TypeScript Orchestration Guide (Temporal vs Trigger.dev vs Inngest)](https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d)
