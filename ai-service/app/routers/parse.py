"""POST /parse-resume — download a resume file, extract text, detect skills."""

import io

from fastapi import APIRouter, HTTPException
from pypdf import PdfReader

from ..cloudinary_client import download
from ..embeddings import detect_skills
from ..schemas import ParseResumeRequest, ParseResumeResponse

router = APIRouter()


def extract_text(data: bytes, content_hint: str = "") -> str:
    """Extract text from a PDF; fall back to plain-text decoding otherwise."""
    try:
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        if text.strip():
            return text
    except Exception:
        pass  # Not a readable PDF — try plain text below.
    try:
        return data.decode("utf-8", errors="replace")
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=422, detail=f"Could not extract text: {exc}")


@router.post("/parse-resume", response_model=ParseResumeResponse)
def parse_resume(req: ParseResumeRequest) -> ParseResumeResponse:
    try:
        data = download(str(req.cloudinary_url))
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not download file: {exc}"
        ) from exc
    text = extract_text(data)
    skills = detect_skills(text)
    return ParseResumeResponse(text=text, skills=skills, char_count=len(text))
