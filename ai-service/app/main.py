"""FastAPI entrypoint for ai-service."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import ping_db
from .routers import analyze, embed, match, parse

app = FastAPI(title="Ground Truth AI — ai-service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(embed.router)
app.include_router(parse.router)
app.include_router(analyze.router)
app.include_router(match.router)


@app.get("/health")
def health() -> dict:
    db_ok = ping_db()
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "groundtruth-ai-service",
        "postgres": "ok" if db_ok else "unreachable",
    }
