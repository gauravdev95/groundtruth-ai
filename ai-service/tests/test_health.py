"""Health + embedding fallback tests for ai-service.

The health test tolerates an unreachable DB (returns 'degraded' instead of
'ok') so CI passes without a live Postgres; the embedding test pins the
dev-only fallback label so a local-hash vector can never pass as a real one.
"""

from fastapi.testclient import TestClient

from app.embeddings import LOCAL_HASH_MODEL, embed_text, local_hash_embedding
from app.main import app

client = TestClient(app)


def test_health_returns_service_status():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["service"] == "groundtruth-ai-service"
    assert body["status"] in ("ok", "degraded")
    assert body["postgres"] in ("ok", "unreachable")


def test_embed_returns_local_hash_fallback_without_openai_key():
    # No OPENAI_API_KEY in CI/dev env → deterministic dev fallback.
    res = client.post(
        "/embed",
        json={"text": "Python FastAPI developer", "owner_type": "candidate",
              "owner_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["dim"] == 1536
    assert body["model"] == LOCAL_HASH_MODEL
    assert len(body["embedding"]) == 1536


def test_local_hash_embedding_is_deterministic_and_normalised():
    a = local_hash_embedding("hello world")
    b = local_hash_embedding("hello world")
    assert a == b
    assert abs(sum(v * v for v in a) - 1.0) < 1e-6


def test_embed_rejects_empty_text():
    res = client.post(
        "/embed",
        json={"text": "", "owner_type": "job",
              "owner_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 422
