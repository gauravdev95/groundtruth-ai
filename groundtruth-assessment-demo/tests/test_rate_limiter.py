"""Tests for the sliding-window rate limiter.

Run from the project root:
    python3 -m unittest discover -s tests -v

NOTE: test_window_expires is the INTENTIONAL FAILING TEST for known
bug #1 (see README.md): the sliding window never expires old entries,
so a key blocked once stays blocked forever. That test is expected to
FAIL until the bug is fixed; the other tests in this file pass.
"""

from __future__ import annotations

import time
import unittest

from backend.app.rate_limiter import SlidingWindowRateLimiter


class TestRateLimiter(unittest.TestCase):
    def test_requests_under_limit_pass(self) -> None:
        limiter = SlidingWindowRateLimiter(limit=3, window_seconds=60)
        self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertTrue(limiter.allow("10.0.0.1"))

    def test_requests_over_limit_blocked(self) -> None:
        limiter = SlidingWindowRateLimiter(limit=3, window_seconds=60)
        for _ in range(3):
            self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertFalse(limiter.allow("10.0.0.1"))
        self.assertFalse(limiter.allow("10.0.0.1"))

    def test_different_ips_have_separate_limits(self) -> None:
        limiter = SlidingWindowRateLimiter(limit=2, window_seconds=60)
        self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertFalse(limiter.allow("10.0.0.1"))
        # A different IP is unaffected.
        self.assertTrue(limiter.allow("10.0.0.2"))

    def test_window_expires(self) -> None:
        """INTENTIONAL FAILING TEST — known bug #1.

        After the 1-second window passes, the limiter should allow
        requests again. It does not: old entries are never pruned, so
        this assertion fails (blocked forever) until the bug is fixed.
        """
        limiter = SlidingWindowRateLimiter(limit=3, window_seconds=1)
        for _ in range(3):
            self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertFalse(limiter.allow("10.0.0.1"))
        time.sleep(1.1)  # window should now have slid past
        self.assertTrue(
            limiter.allow("10.0.0.1"),
            "expected the window to expire after 1s, but the request "
            "was still blocked (known bug #1: entries never expire)",
        )


if __name__ == "__main__":
    unittest.main()
