"""Cloudinary client for ai-service (mirrors server/src/config/cloudinary.ts).

Same env vars (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY /
CLOUDINARY_API_SECRET), same folders. Used here to download uploaded files
(e.g. a resume PDF) for parsing — uploads themselves go through the server.
"""

import httpx

from .config import settings

FOLDERS = {
    "resume": "groundtruth/resumes",
    "certificate": "groundtruth/certificates",
    "evidence-report": "groundtruth/evidence-reports",
}


def configured() -> bool:
    return settings.cloudinary_configured


def download(url: str, timeout: float = 30.0) -> bytes:
    """Download a file from a Cloudinary (or any https) URL. The caller
    validates the URL scheme via the Pydantic HttpUrl schema first."""
    resp = httpx.get(url, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    return resp.content
