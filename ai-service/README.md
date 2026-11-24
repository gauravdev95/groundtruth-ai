# Ground Truth AI — ai-service

Python 3.12 + FastAPI. Embeddings, resume parsing, repo analysis, matching.

## Run

```bash
cp .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health
python -m pytest tests -q
```

## Endpoints

- `GET /health` — liveness + DB reachability.
- `POST /embed` `{text, owner_type, owner_id}` → `{embedding, dim, model}`.
  Uses OpenAI `text-embedding-3-small` (dim 1536) when `OPENAI_API_KEY` is
  set; otherwise a deterministic local-hash dev fallback, clearly labelled
  `model="local-hash-dev-only"` — **dev only, never for production matching**.
- `POST /parse-resume` `{cloudinary_url}` — downloads the file, extracts
  text with pypdf, keyword-matches a built-in skill list.
- `POST /analyze-repo` `{repo_url}` — shallow-clones the repo (git CLI) and
  returns a language breakdown + file/commit counts. No invented data;
  errors are reported honestly.
- `POST /match` `{candidate_id, job_id}` — cosine similarity over the stored
  pgvector embeddings. If either embedding is missing, returns an honest
  503-style error — never a fabricated score.

## Cloudinary

`app/cloudinary_client.py` reads the same `CLOUDINARY_*` env vars as the
server and exposes the same three folders (`groundtruth/resumes`,
`groundtruth/certificates`, `groundtruth/evidence-reports`) plus a download
helper used by `/parse-resume`.
