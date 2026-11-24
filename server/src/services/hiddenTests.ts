// ── Server-side hidden tests ───────────────────────────────────────────────
// Hidden tests are NEVER sent to the client and never live in the candidate
// workspace. They are injected into the sandbox only at submission time,
// run, and removed again. Each entry is keyed by the challenge task type
// produced by services/challenge.ts. The test code itself is written by us
// (not by an LLM) and checks behaviour the candidate cannot see in advance.
//
// For task types with no registry entry, the hidden suite falls back to
// re-running the visible suite — recorded honestly as such.

export interface HiddenTest {
  /** File path inside the workspace, under the _gt_hidden/ directory. */
  path: string;
  /** Full file content. */
  content: string;
  /** Command to run it (argv, allowlisted by the sandbox). */
  command: string[];
  description: string;
}

const RATE_LIMITER_HIDDEN: HiddenTest = {
  path: "_gt_hidden/test_hidden.py",
  content: `"""Hidden grading tests for the rate-limiter challenge.

These tests are injected at submission time only. They verify the two
behaviours the challenge requires: (1) the sliding window actually expires
old entries, and (2) per-user limits exist in addition to per-IP limits.
"""
import sys
import time
import unittest

sys.path.insert(0, "backend")

from app.rate_limiter import SlidingWindowRateLimiter


class TestHiddenWindowExpiry(unittest.TestCase):
    def test_window_expires_after_long_idle(self):
        limiter = SlidingWindowRateLimiter(limit=2, window_seconds=1)
        self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertTrue(limiter.allow("10.0.0.1"))
        self.assertFalse(limiter.allow("10.0.0.1"))
        time.sleep(1.2)
        self.assertTrue(
            limiter.allow("10.0.0.1"),
            "window did not expire after 1s idle",
        )

    def test_old_entries_pruned_not_counted(self):
        limiter = SlidingWindowRateLimiter(limit=3, window_seconds=1)
        for _ in range(3):
            self.assertTrue(limiter.allow("10.0.0.2"))
        time.sleep(1.2)
        for _ in range(3):
            self.assertTrue(limiter.allow("10.0.0.2"))
        self.assertFalse(limiter.allow("10.0.0.2"))


class TestHiddenPerUserLimit(unittest.TestCase):
    def test_per_user_limit_blocks_one_user_only(self):
        # The fixed implementation must expose a per-user limiter. If the
        # candidate implemented it as allow_user(username), use it; if they
        # implemented it another way, this test fails and the evaluation
        # records the missing feature honestly.
        limiter = SlidingWindowRateLimiter(limit=5, window_seconds=60)
        allow_user = getattr(limiter, "allow_user", None)
        self.assertIsNotNone(
            allow_user, "no per-user limit API found on the limiter"
        )
        for _ in range(5):
            self.assertTrue(allow_user("alice"))
        self.assertFalse(allow_user("alice"))
        self.assertTrue(allow_user("bob"))


if __name__ == "__main__":
    unittest.main()
`,
  command: ["python3", "-m", "unittest", "_gt_hidden.test_hidden", "-v"],
  description:
    "Hidden tests verify the sliding window expires and a per-user limit exists.",
};

const REGISTRY: Record<string, HiddenTest[]> = {
  // Task-type strings must match ChallengeTaskType in services/challenge.ts.
  "fix-rate-limit-bug": [RATE_LIMITER_HIDDEN],
};

export function getHiddenTests(taskType: string): HiddenTest[] {
  return REGISTRY[taskType] ?? [];
}

/** Task types the generator can produce (kept in sync with challenge.ts). */
export function hiddenTestsAvailable(taskType: string): boolean {
  return (REGISTRY[taskType] ?? []).length > 0;
}
