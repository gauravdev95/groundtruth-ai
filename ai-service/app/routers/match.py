"""POST /match — cosine similarity over stored pgvector embeddings.

If either side has no stored embedding, the endpoint returns 503 with an
honest message — it never fabricates a score.
"""

import math

from fastapi import APIRouter, HTTPException

from ..db import get_conn
from ..schemas import MatchRequest, MatchResponse

router = APIRouter()


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


@router.post("/match", response_model=MatchResponse)
def match(req: MatchRequest) -> MatchResponse:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT owner_type, embedding::text, model FROM embeddings "
                "WHERE (owner_type = 'candidate' AND owner_id = %s::uuid) "
                "   OR (owner_type = 'job' AND owner_id = %s::uuid)",
                (req.candidate_id, req.job_id),
            )
            rows = cur.fetchall()
    by_type: dict[str, dict] = {row["owner_type"]: row for row in rows}
    missing = [t for t in ("candidate", "job") if t not in by_type]
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"No embedding stored for: {', '.join(missing)}. "
            "Run vector re-embedding for both sides before matching.",
        )
    cand = by_type["candidate"]
    job = by_type["job"]
    # Parse the pgvector text form "{0.1,0.2,...}" into floats.
    cand_vec = [float(v) for v in str(cand["embedding"]).strip("{}").split(",") if v]
    job_vec = [float(v) for v in str(job["embedding"]).strip("{}").split(",") if v]
    score = _cosine(cand_vec, job_vec)
    return MatchResponse(
        candidate_id=req.candidate_id,
        job_id=req.job_id,
        score=score,
        model=str(cand["model"]),
    )
