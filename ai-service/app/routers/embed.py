"""POST /embed — embed text (OpenAI, or labelled local-hash dev fallback)."""

from fastapi import APIRouter

from ..embeddings import embed_text
from ..schemas import EmbedRequest, EmbedResponse

router = APIRouter()


@router.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    embedding, model = embed_text(req.text)
    return EmbedResponse(embedding=embedding, dim=len(embedding), model=model)
