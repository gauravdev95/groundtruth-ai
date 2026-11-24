# Architecture — Ground Truth AI (Phase 0)

## Services

| Service | Stack | Role |
| --- | --- | --- |
| client | Next.js 14 App Router, React 18, TypeScript | Landing page, jobs list; talks to server only |
| server | Node 20, Express, TypeScript, pg, BullMQ, ioredis | REST API, Postgres access, queue producer + workers (Phase 0) |
| ai-service | Python 3.12, FastAPI, pgvector via psycopg, pypdf | Embeddings, resume parsing, repo analysis, matching |
| postgres | PostgreSQL 16 + pgvector | Relational records + `vector(1536)` embeddings in one DB |
| redis | Redis 7 | BullMQ job queues |
| Cloudinary | SaaS object storage | Raw resume PDFs, certificates, generated evidence reports |

## Data flow: resume upload → parse → embed → match

```
Candidate uploads resume (PDF)
  → POST /api/uploads (server, multer, 10 MB, PDF/JPG/PNG)
  → stored in Cloudinary folder groundtruth/resumes
  → row in resumes table (cloudinary_url, public_id)
  → enqueue llm-parsing job (202 + jobId; UI never blocks)
      → worker calls ai-service POST /parse-resume {cloudinary_url}
      → ai-service downloads the file, extracts text (pypdf),
        keyword-matches a built-in skill list
      → worker writes candidate_skills + extracted text back to Postgres
  → enqueue vector-reembedding job
      → worker calls ai-service POST /embed {text, owner_type, owner_id}
      → ai-service returns a 1536-dim embedding
        (OpenAI text-embedding-3-small if OPENAI_API_KEY is set,
         else deterministic local-hash dev fallback, labelled as such)
      → worker upserts embeddings(owner_type='candidate', owner_id, embedding)
  → match: POST /match {candidate_id, job_id} in ai-service
      → cosine similarity over stored pgvector embeddings
      → if either embedding is missing, an honest 503-style error —
        never a fabricated score
```

## Queue flow (BullMQ, Redis)

Three queues, all created in `server/src/queues/index.ts`:

| Queue | Concurrency | Producer | Worker does |
| --- | --- | --- | --- |
| `github-analysis` | 5 | `enqueueGithubAnalysis(repoUrl, candidateId)` | calls ai-service `POST /analyze-repo`, stores verification result |
| `llm-parsing` | 3 | `enqueueResumeParsing(resumeId, cloudinaryUrl)` | calls ai-service `POST /parse-resume`, stores skills/text |
| `vector-reembedding` | 5 | `enqueueReembedding(ownerType, ownerId)` | calls ai-service `POST /embed`, upserts `embeddings` row |

Default job options: `attempts: 3`, exponential backoff (delay grows
2s → 4s → 8s). Workers log start/finish per job. All enqueue sites return
HTTP 202 with a `jobId` immediately; heavy work never runs in the request
path, so the UI never freezes.

## Storage layout (Cloudinary)

- `groundtruth/resumes` — raw resume PDFs
- `groundtruth/certificates` — uploaded certificates (PDF/JPG/PNG)
- `groundtruth/evidence-reports` — generated evidence-report PDFs
  (see `src/services/cloudinary.ts#uploadEvidenceReport`)

## Database

Schema: `infra/postgres/001_init.sql` — `vector` extension, 14 tables,
uuid PKs, timestamptz, FKs + indexes. The `embeddings` table stores
`embedding vector(1536)` with an `ivfflat` index for approximate nearest
neighbour search. Demo data: `infra/postgres/002_seed.sql` (idempotent,
`ON CONFLICT DO NOTHING`, clearly marked demo).

## Phase 1 notes

- Split BullMQ workers out of the server process into standalone workers.
- Replace the placeholder API-key auth with real JWT/OAuth.
- Replace the local-hash embedding fallback with a real embedding provider
  (or a self-hosted embedding model) before any production matching.
