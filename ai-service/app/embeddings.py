"""Embedding provider.

If OPENAI_API_KEY is set, calls OpenAI text-embedding-3-small (dim 1536).
Otherwise a deterministic local-hash fallback is used, clearly labelled
model="local-hash-dev-only". The fallback is for local development ONLY:
hash embeddings carry no semantic meaning and must never drive production
matching. The label travels with every vector so a dev vector can never be
mistaken for a real one.
"""

import hashlib
import math

import httpx

from .config import settings

LOCAL_HASH_MODEL = "local-hash-dev-only"

# Small built-in skill list used by /parse-resume keyword matching.
KNOWN_SKILLS = [
    "Python", "JavaScript", "TypeScript", "C++", "Java", "Go", "Rust", "SQL",
    "React", "Next.js", "Node.js", "Express.js", "FastAPI", "Django", "Flask",
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes",
    "AWS", "Git", "GitHub", "REST APIs", "GraphQL", "Celery", "Kafka",
    "Pandas", "NumPy", "Scikit-learn", "PyTorch", "TensorFlow",
    "Machine Learning", "LLM", "RAG", "Generative AI",
]


def detect_skills(text: str) -> list[str]:
    """Case-insensitive keyword match of KNOWN_SKILLS against extracted text."""
    lowered = text.lower()
    return [skill for skill in KNOWN_SKILLS if skill.lower() in lowered]


def local_hash_embedding(text: str, dim: int = 1536) -> list[float]:
    """Deterministic dev-only embedding: hash n-grams into `dim` buckets.

    Stable for the same input (so dev matching is reproducible), but with
    no semantic content — two unrelated texts can collide, and similar texts
    are not near each other. Dev only.
    """
    vec = [0.0] * dim
    words = text.lower().split()
    tokens = words + [" ".join(words[i : i + 2]) for i in range(max(0, len(words) - 1))]
    for token in tokens:
        digest = hashlib.sha256(token.encode()).digest()
        idx = int.from_bytes(digest[:4], "big") % dim
        vec[idx] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed_text(text: str) -> tuple[list[float], str]:
    """Return (embedding, model). Raises on OpenAI failure — never silently
    falls back to the hash embedding when a real key is configured."""
    if not settings.openai_api_key:
        return local_hash_embedding(text, settings.embedding_dim), LOCAL_HASH_MODEL
    resp = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {settings.openai_api_key}"},
        json={"model": settings.embedding_model, "input": text},
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()["data"][0]["embedding"]
    return [float(v) for v in data], settings.embedding_model
