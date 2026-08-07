# SPDX-License-Identifier: MIT
"""CSRF hardening — reject cross-site browser requests to the mutating API.

JustWrite's csrf.py is the donor (its docstring records the user's deciding
factor: "prefer not locking anyone out, do the vector directly"). The server is
a localhost sidecar; the real CSRF threat is a page in the user's OTHER browser
tab POSTing to 127.0.0.1:17494. This middleware rejects a MUTATING `/v1`
request whose `Origin` marks it cross-site, UNLESS the origin is the app's own.
It needs NO token, so it can never lock a user out; the only failure mode is a
missing app origin blocking the app itself — which the Playwright smoke catches
immediately.

Allowed:
- no `Origin` header — non-browser clients AND the Tauri webview (server calls
  go through the Tauri HTTP plugin / reqwest, which sends no browser `Origin`);
- SAME-ORIGIN — the `Origin` equals the server's own origin, derived
  per-request from the URL so any host/port works. This is the headless mode
  (`justvoice-server serve` + a browser on the /ui/ mount): browsers DO send
  `Origin` on same-origin mutations, so without this every write from the
  self-hosted UI would 403 (JustWrite hit exactly that, 2026-07-15).
- an `Origin` in the app allowlist — the dev + Tauri origins PLUS the
  `settings.cors.origins` list AND `settings.cors.origin_regex`. One
  allowlist, reused, not a second list: JV's documented CORS posture
  deliberately admits any loopback origin (the regex), and CSRF honours the
  same rule — so every documented local flow keeps working and only foreign
  web origins are blocked.
- any non-mutating method (GET/HEAD/OPTIONS) — not the CSRF vector.
Rejected: a mutating `/v1` request carrying any other browser origin → 403.
"""

from __future__ import annotations

import re

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# The app's own front-end origins. The packaged Tauri webview serves from
# tauri://localhost (macOS/Linux) or http(s)://tauri.localhost (Windows) and
# normally reaches the server with NO Origin (via the Tauri HTTP plugin) —
# these cover the dev server (Vite :1430 — NOT JustWrite's 1420) and are
# belt-and-suspenders for any webview that does send one.
_APP_ORIGINS = frozenset({
    "http://localhost:1430",
    "http://127.0.0.1:1430",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
})

_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class CsrfOriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, extra_origins=(), origin_regex: str = ""):
        super().__init__(app)
        self._allow = _APP_ORIGINS | frozenset(o for o in (extra_origins or ()) if o)
        self._regex = re.compile(origin_regex) if origin_regex else None

    def _same_origin(self, request) -> str:
        """The server's OWN origin for this request (scheme://host[:port]) — a
        page we served ourselves. Read from the URL so it follows whatever
        host/port the server actually runs on (17494, a test port, a LAN bind)."""
        return f"{request.url.scheme}://{request.url.netloc}"

    def _allowed(self, request, origin: str) -> bool:
        if origin in self._allow or origin == self._same_origin(request):
            return True
        return bool(self._regex and self._regex.match(origin))

    async def dispatch(self, request, call_next):
        if request.method in _MUTATING and request.url.path.startswith("/v1"):
            origin = request.headers.get("origin")
            if origin and not self._allowed(request, origin):
                return JSONResponse(
                    status_code=403,
                    content={
                        "type": "https://justvoice.dev/errors/cross-origin",
                        "title": "Forbidden",
                        "status": 403,
                        "detail": "cross-origin request rejected",
                        "instance": request.url.path,
                    },
                    media_type="application/problem+json",
                )
        return await call_next(request)
