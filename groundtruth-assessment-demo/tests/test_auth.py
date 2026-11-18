"""Tests for auth (hashing, tokens, register/login) and user persistence.

Run from the project root:
    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app.auth import (
    DEMO_SECRET,
    hash_password,
    issue_token,
    verify_password,
    verify_token,
)
from backend.app.main import login_user, register_user
from backend.services.users import UserStore


class TestPasswordHashing(unittest.TestCase):
    def test_hash_and_verify_roundtrip(self) -> None:
        stored = hash_password("correct horse battery")
        self.assertTrue(verify_password("correct horse battery", stored))

    def test_wrong_password_fails(self) -> None:
        stored = hash_password("correct horse battery")
        self.assertFalse(verify_password("wrong password", stored))

    def test_same_password_hashes_differ(self) -> None:
        # Random salt: two hashes of the same password must not be equal.
        self.assertNotEqual(hash_password("same"), hash_password("same"))


class TestTokens(unittest.TestCase):
    def test_token_verify_roundtrip(self) -> None:
        token = issue_token("alice", secret=DEMO_SECRET)
        self.assertEqual(verify_token(token, secret=DEMO_SECRET), "alice")

    def test_tampered_token_rejected(self) -> None:
        token = issue_token("alice", secret=DEMO_SECRET)
        payload, _sig = token.split(".", 1)
        self.assertIsNone(verify_token(payload + ".0000", secret=DEMO_SECRET))

    def test_expired_token_rejected(self) -> None:
        token = issue_token("alice", secret=DEMO_SECRET, ttl_seconds=-10)
        self.assertIsNone(verify_token(token, secret=DEMO_SECRET))


class TestRegisterLogin(unittest.TestCase):
    def setUp(self) -> None:
        self.store = UserStore(path=None)  # in-memory only

    def test_register_and_login_success(self) -> None:
        register_user(self.store, "alice", "password123")
        token = login_user(self.store, "alice", "password123")
        self.assertEqual(verify_token(token), "alice")

    def test_register_duplicate_fails(self) -> None:
        register_user(self.store, "alice", "password123")
        with self.assertRaises(ValueError):
            register_user(self.store, "alice", "password123")

    def test_login_wrong_password_fails(self) -> None:
        register_user(self.store, "alice", "password123")
        with self.assertRaises(ValueError):
            login_user(self.store, "alice", "not-the-password")

    def test_login_unknown_user_fails(self) -> None:
        with self.assertRaises(ValueError):
            login_user(self.store, "ghost", "password123")


class TestUserPersistence(unittest.TestCase):
    def test_user_survives_store_reload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "users.json"
            store = UserStore(path=path)
            register_user(store, "alice", "password123")
            self.assertTrue(path.exists())
            # Fresh store over the same file must see the same user.
            reloaded = UserStore(path=path)
            self.assertIsNotNone(reloaded.get_user("alice"))
            token = login_user(reloaded, "alice", "password123")
            self.assertEqual(verify_token(token), "alice")


if __name__ == "__main__":
    unittest.main()
