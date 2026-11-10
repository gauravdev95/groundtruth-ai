"""Request/response schemas for ai-service endpoints."""

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class EmbedRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    owner_type: Literal["candidate", "job"]
    owner_id: str


class EmbedResponse(BaseModel):
    embedding: list[float]
    dim: int
    model: str


class ParseResumeRequest(BaseModel):
    cloudinary_url: HttpUrl


class ParseResumeResponse(BaseModel):
    text: str
    skills: list[str]
    char_count: int


class AnalyzeRepoRequest(BaseModel):
    repo_url: HttpUrl


class AnalyzeRepoResponse(BaseModel):
    repo_url: str
    languages: dict[str, int]
    file_count: int
    commit_count: int | None
    default_branch: str | None


class MatchRequest(BaseModel):
    candidate_id: str
    job_id: str


class MatchResponse(BaseModel):
    candidate_id: str
    job_id: str
    score: float
    model: str
