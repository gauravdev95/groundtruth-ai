"""Password hashing and token issue/verify — stdlib only.

Demo code only. The default token secret below is a placeholder for
local testing, not a production secret. Pass an explicit ``secret``
in real use; never commit a real secret.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

DEMO_SECRET = "demo-only-secret-do-not-use-in-production"
_PBKDF2_ITERATIONS = 100_000
_TOKEN_TTL_SECONDS = 3600


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Hash ``password`` with PBKDF2-HMAC-SHA256.

    Returns ``"<salt_hex>$<hash_hex>"`` so the salt travels with the hash.
    """
    if not password:
        raise ValueError("password must not be empty")
    salt = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Return True iff ``password`` matches the stored ``salt$hash`` value."""
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex),
        _PBKDF2_ITERATIONS,
    )
    return hmac.compare_digest(digest, expected)


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def issue_token(user_id: str, secret: str = DEMO_SECRET,
                ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str:
    """Issue a signed token for ``user_id``: ``payload.signature``.

    Payload is JSON ``{"sub": ..., "iat": ..., "exp": ...}``; the
    signature is HMAC-SHA256 over the base64 payload, keyed by ``secret``.
    """
    now = int(time.time())
    payload = {"sub": user_id, "iat": now, "exp": now + ttl_seconds}
    payload_b64 = _b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    signature = hmac.new(
        secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{signature}"


def verify_token(token: str, secret: str = DEMO_SECRET) -> str | None:
    """Return the ``user_id`` (``sub``) if ``token`` is valid, else None.

    A token is invalid if it is malformed, its signature does not match,
    or it has expired.
    """
    try:
        payload_b64, signature = token.split(".", 1)
        expected = hmac.new(
            secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_b64decode(payload_b64).decode("utf-8"))
        if int(payload["exp"]) < int(time.time()):
            return None
        return str(payload["sub"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None
