"""In-memory user store with optional JSON-file persistence — stdlib only.

A user record is a plain dict::

    {"username": str, "password_hash": str, "created_at": float}

Persistence is a single JSON file (default ``users.json`` at the
project root when the server runs). The file is gitignored.
"""

from __future__ import annotations

import json
import time
from pathlib import Path


class UserStore:
    """Dict-backed user store, optionally persisted to a JSON file."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path is not None else None
        self._users: dict[str, dict] = {}
        if self.path is not None:
            self.load()

    def add_user(self, username: str, password_hash: str) -> dict:
        """Add a user; raises ValueError if ``username`` already exists."""
        if not username:
            raise ValueError("username must not be empty")
        if username in self._users:
            raise ValueError(f"user {username!r} already exists")
        user = {
            "username": username,
            "password_hash": password_hash,
            "created_at": time.time(),
        }
        self._users[username] = user
        self.save()
        return dict(user)

    def get_user(self, username: str) -> dict | None:
        """Return a copy of the user record, or None if not found."""
        user = self._users.get(username)
        return dict(user) if user is not None else None

    def user_exists(self, username: str) -> bool:
        return username in self._users

    def list_usernames(self) -> list[str]:
        return sorted(self._users)

    def save(self) -> None:
        """Write the store to ``self.path`` (no-op when path is None)."""
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self._users, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    def load(self) -> None:
        """Reload the store from ``self.path`` (no-op if file is absent)."""
        if self.path is None or not self.path.exists():
            return
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("user store file must contain a JSON object")
        self._users = {str(k): dict(v) for k, v in data.items()}
