"""POST /analyze-repo — shallow-clone a repo and report real repo stats.

No data is invented: language breakdown, file count, and commit count all
come from the clone itself. Private/unreachable/invalid repos return an
honest error instead of fabricated numbers.
"""

import os
import subprocess
import tempfile
from collections import Counter

from fastapi import APIRouter, HTTPException

from ..schemas import AnalyzeRepoRequest, AnalyzeRepoResponse

router = APIRouter()

# Extension → language label for the breakdown. Deliberately small; unknown
# extensions are grouped under "Other".
EXT_TO_LANG = {
    ".py": "Python", ".js": "JavaScript", ".ts": "TypeScript",
    ".tsx": "TypeScript", ".jsx": "JavaScript", ".java": "Java",
    ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
    ".c": "C", ".cpp": "C++", ".h": "C/C++", ".cs": "C#",
    ".html": "HTML", ".css": "CSS", ".sql": "SQL",
    ".md": "Markdown", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML",
    ".sh": "Shell",
}

IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}


def _language_breakdown(root: str) -> tuple[dict[str, int], int]:
    counts: Counter[str] = Counter()
    file_count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for name in filenames:
            file_count += 1
            ext = os.path.splitext(name)[1].lower()
            counts[EXT_TO_LANG.get(ext, "Other")] += 1
    return dict(counts), file_count


@router.post("/analyze-repo", response_model=AnalyzeRepoResponse)
def analyze_repo(req: AnalyzeRepoRequest) -> AnalyzeRepoResponse:
    repo_url = str(req.repo_url)
    with tempfile.TemporaryDirectory(prefix="gt-repo-") as tmp:
        clone_dir = os.path.join(tmp, "repo")
        clone = subprocess.run(
            ["git", "clone", "--depth", "1", repo_url, clone_dir],
            capture_output=True, text=True, timeout=120,
        )
        if clone.returncode != 0:
            raise HTTPException(
                status_code=502,
                detail=f"Could not clone repo (is it public and valid?): {clone.stderr.strip()[:300]}",
            )
        languages, file_count = _language_breakdown(clone_dir)
        branch = subprocess.run(
            ["git", "-C", clone_dir, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=15,
        )
        commits = subprocess.run(
            ["git", "-C", clone_dir, "rev-list", "--count", "HEAD"],
            capture_output=True, text=True, timeout=15,
        )
        return AnalyzeRepoResponse(
            repo_url=repo_url,
            languages=languages,
            file_count=file_count,
            commit_count=int(commits.stdout.strip()) if commits.returncode == 0 else None,
            default_branch=branch.stdout.strip() if branch.returncode == 0 else None,
        )
