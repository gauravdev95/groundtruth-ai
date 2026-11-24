"""POST /match tests for ai-service.

The endpoint must never fabricate a score and must never answer a
dependency outage with an unhandled 500:
- database unreachable  -> 503 with a clear "unavailable" message
- embedding missing     -> 503 naming the missing side
- both embeddings exist -> 200 with the real cosine score

The database is mocked (no live Postgres needed): `get_conn` is replaced
with a fake context manager, so these tests run in CI without a DB.
"""

from contextlib import contextmanager

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.routers.match as match_router
from app.main import app

client = TestClient(app)

CANDIDATE_ID = "11111111-1111-1111-1111-111111111111"
JOB_ID = "22222222-2222-2222-2222-222222222222"


def _fake_conn(rows):
    """A fake get_conn() yielding a cursor whose fetchall() returns `rows`."""

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, *args, **kwargs):
            return None

        def fetchall(self):
            return rows

    class FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def cursor(self):
            return FakeCursor()

    @contextmanager
    def fake_get_conn():
        yield FakeConn()

    return fake_get_conn


def _row(owner_type, embedding):
    return {"owner_type": owner_type, "embedding": embedding, "model": "test-model"}


def _match_body():
    return client.post(
        "/match", json={"candidate_id": CANDIDATE_ID, "job_id": JOB_ID}
    )


def test_match_db_down_returns_503_not_500(monkeypatch):
    def broken_get_conn():
        raise psycopg.OperationalError("could not connect to server")

    monkeypatch.setattr(match_router, "get_conn", broken_get_conn)
    res = _match_body()
    assert res.status_code == 503
    assert "unavailable" in res.json()["detail"].lower()


def test_match_missing_embeddings_returns_503(monkeypatch):
    monkeypatch.setattr(match_router, "get_conn", _fake_conn([]))
    res = _match_body()
    assert res.status_code == 503
    assert "candidate" in res.json()["detail"]
    assert "job" in res.json()["detail"]


def test_match_one_side_missing_returns_503(monkeypatch):
    monkeypatch.setattr(
        match_router, "get_conn", _fake_conn([_row("candidate", "{1,0,0}")])
    )
    res = _match_body()
    assert res.status_code == 503
    assert "job" in res.json()["detail"]


def test_match_returns_real_cosine_score(monkeypatch):
    monkeypatch.setattr(
        match_router,
        "get_conn",
        _fake_conn([_row("candidate", "{1,0}"), _row("job", "{1,0}")]),
    )
    res = _match_body()
    assert res.status_code == 200
    body = res.json()
    assert body["candidate_id"] == CANDIDATE_ID
    assert body["job_id"] == JOB_ID
    assert body["score"] == pytest.approx(1.0)
    assert body["model"] == "test-model"


def test_match_parses_bracket_form_vectors(monkeypatch):
    # Regression (23 Nov 2026): pgvector returns vectors as "[1,0]" when
    # the row was inserted as a JSON array (the Express worker's insert),
    # not "{1,0}". The old parser stripped only braces and crashed with
    # ValueError -> HTTP 500 on real stored vectors.
    monkeypatch.setattr(
        match_router,
        "get_conn",
        _fake_conn([_row("candidate", "[1,0]"), _row("job", "[1,0]")]),
    )
    res = _match_body()
    assert res.status_code == 200
    assert res.json()["score"] == pytest.approx(1.0)


def test_match_orthogonal_vectors_score_zero(monkeypatch):
    monkeypatch.setattr(
        match_router,
        "get_conn",
        _fake_conn([_row("candidate", "{1,0}"), _row("job", "{0,1}")]),
    )
    res = _match_body()
    assert res.status_code == 200
    assert res.json()["score"] == pytest.approx(0.0)
