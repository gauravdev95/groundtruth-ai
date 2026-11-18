"""Tiny auth API — stdlib ``http.server`` only, no framework.

Endpoints (JSON in, JSON out):

* ``POST /register``  ``{"username", "password"}`` -> 201 + user, or
  400 on bad input / duplicate username.
* ``POST /login``     ``{"username", "password"}`` -> 200 + token, or
  401 on bad credentials. Rate-limited per IP (see below).
* ``GET  /me``        ``Authorization: Bearer <token>`` -> 200 + user,
  or 401 without a valid token.

Run from the project root::

    python3 -m backend.app.main

Rate limiting: ``/login`` (and ``/register``) are limited per client
IP by :class:`SlidingWindowRateLimiter` (5 requests / 60 s). There is
deliberately NO per-user limit — see README.md, "Missing feature":
an attacker can spread login guesses for one account across many
IPs (or stay under the per-IP cap) without ever hitting a per-user
limit. A good solution adds a stricter per-user limiter on /login.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.app.auth import DEMO_SECRET, hash_password, issue_token, verify_password, verify_token
from backend.app.rate_limiter import SlidingWindowRateLimiter
from backend.services.users import UserStore

HOST = "127.0.0.1"
PORT = 8000
MIN_PASSWORD_LENGTH = 8

# Shared state for the running server.
STORE_PATH = Path(__file__).resolve().parents[2] / "users.json"
store = UserStore(path=STORE_PATH)
# Per-IP limiter only — no per-user limiter exists (missing feature).
ip_limiter = SlidingWindowRateLimiter(limit=5, window_seconds=60.0)


def register_user(user_store: UserStore, username: str, password: str) -> dict:
    """Create a user. Raises ValueError on bad input or a duplicate."""
    if not username or not isinstance(username, str):
        raise ValueError("username must not be empty")
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"password must be at least {MIN_PASSWORD_LENGTH} characters"
        )
    return user_store.add_user(username, hash_password(password))


def login_user(user_store: UserStore, username: str, password: str,
               secret: str = DEMO_SECRET) -> str:
    """Return a token for valid credentials; raise ValueError otherwise."""
    user = user_store.get_user(username)
    if user is None or not verify_password(password, user["password_hash"]):
        raise ValueError("invalid username or password")
    return issue_token(username, secret=secret)


def _public_user(user: dict) -> dict:
    return {"username": user["username"], "created_at": user["created_at"]}


class Handler(BaseHTTPRequestHandler):
    """JSON handler for /register, /login and /me."""

    def log_message(self, fmt: str, *args: object) -> None:  # keep output quiet
        pass

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _client_ip(self) -> str:
        return self.client_address[0]

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        if self.path not in ("/register", "/login"):
            self._send_json(404, {"error": "not found"})
            return
        # Per-IP rate limiting only (no per-user limit — missing feature).
        if not ip_limiter.allow(self._client_ip()):
            self._send_json(429, {"error": "too many requests"})
            return
        data = self._read_json()
        username = data.get("username", "")
        password = data.get("password", "")
        try:
            if self.path == "/register":
                user = register_user(store, username, password)
                self._send_json(201, {"user": _public_user(user)})
            else:
                token = login_user(store, username, password)
                self._send_json(200, {"token": token})
        except ValueError as exc:
            status = 400 if self.path == "/register" else 401
            self._send_json(status, {"error": str(exc)})

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        if self.path != "/me":
            self._send_json(404, {"error": "not found"})
            return
        auth = self.headers.get("Authorization", "")
        token = auth[len("Bearer "):] if auth.startswith("Bearer ") else ""
        user_id = verify_token(token) if token else None
        if user_id is None:
            self._send_json(401, {"error": "invalid or missing token"})
            return
        user = store.get_user(user_id)
        if user is None:
            self._send_json(401, {"error": "unknown user"})
            return
        self._send_json(200, {"user": _public_user(user)})


def run(host: str = HOST, port: int = PORT) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving groundtruth-assessment-demo on http://{host}:{port}")
    print("Endpoints: POST /register, POST /login, GET /me")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
