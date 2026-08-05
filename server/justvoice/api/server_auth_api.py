"""GET/PUT /v1/server-auth — the bearer-token door, and the lockout escape.

The family shape (docgen built it first, 2026-08-05; the apps work the same —
user ruling): auth config gets its OWN route instead of riding the generic
settings API, so the middleware can exempt exactly THIS door (plus /v1/health)
for loopback clients. Without the exemption, require_for_loopback + a lost
token gated even the health probe and every way to fix it. The tokens already
sit in the locally readable settings store, so the loopback door exposes
nothing new. Wire shape matches the family door exactly:
{"tokens": [...], "requireForLoopback": bool}.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..app_state import get_state
from ..models import AuthSettings

router = APIRouter(prefix="/v1", tags=["admin"])


def _wire(a: AuthSettings) -> dict:
    return {"tokens": [t for t in a.tokens if isinstance(t, str) and t],
            "requireForLoopback": bool(a.require_for_loopback)}


@router.get("/server-auth", summary="Bearer-token config (loopback never locks out)")
async def get_server_auth() -> dict:
    return _wire(get_state().settings.get().auth)


@router.put("/server-auth", summary="Replace the bearer-token config")
async def put_server_auth(body: dict) -> dict:
    tokens = body.get("tokens")
    if not isinstance(tokens, list) or not all(isinstance(t, str) for t in tokens):
        raise HTTPException(400, "tokens must be a list of strings")
    state = get_state()
    current = state.settings.get()
    updated = current.model_copy(update={"auth": AuthSettings(
        tokens=[t for t in tokens if t.strip()],
        require_for_loopback=bool(body.get("requireForLoopback")),
    )})
    state.settings.set(updated)
    return _wire(updated.auth)
