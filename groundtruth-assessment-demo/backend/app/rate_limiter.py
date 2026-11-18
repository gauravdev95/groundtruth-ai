"""Per-IP sliding-window rate limiting — stdlib only.

KNOWN BUG #1 (intentional, see README.md): the sliding window never
expires old entries. ``allow()`` appends every request timestamp but
never prunes timestamps older than ``window_seconds``, so once a key
has made ``limit`` requests it is blocked forever — even after the
window should have slid past. The fix is to drop entries with
``timestamp <= now - window_seconds`` before counting.
"""

from __future__ import annotations

import time


class SlidingWindowRateLimiter:
    """Allow at most ``limit`` requests per ``window_seconds`` per key.

    In this demo the key is the client IP (see ``backend/app/main.py``).
    There is deliberately NO per-user limiting — see README.md,
    "Missing feature".
    """

    def __init__(self, limit: int = 5, window_seconds: float = 60.0) -> None:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, list[float]] = {}

    def allow(self, key: str) -> bool:
        """Return True if a request from ``key`` is within the limit."""
        now = time.time()
        history = self._requests.setdefault(key, [])
        # BUG #1: old entries are never expired. A correct implementation
        # would prune here, e.g.:
        #   history[:] = [t for t in history if t > now - self.window_seconds]
        # Without that pruning, len(history) only ever grows, so once a
        # key reaches `limit` requests it is blocked forever.
        if len(history) >= self.limit:
            return False
        history.append(now)
        return True

    def count(self, key: str) -> int:
        """Number of recorded requests for ``key`` (unpruned — see bug)."""
        return len(self._requests.get(key, []))

    def reset(self, key: str | None = None) -> None:
        """Clear recorded requests for one key, or for all keys if None."""
        if key is None:
            self._requests.clear()
        else:
            self._requests.pop(key, None)
