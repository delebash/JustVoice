# SPDX-License-Identifier: MIT
"""JustVoice's auth SEAM — the settings read behind the family bearer-auth
middleware (`llm_runner.platform.BearerAuthMiddleware`, wired in app.py).

The POLICY (token check, loopback bypass, the 2026-08-05 lockout escape) lives
once in the kit — P2 of the target tree (2026-08-08) ended the era of three
hand-synced copies. What stays here is the only genuinely per-app part: where
this app keeps its auth config — the SettingsStore's `auth` section
(tokens + require_for_loopback), read live per /v1 request.
"""

from __future__ import annotations

from .app_state import get_state


def read_auth() -> tuple[list[str], bool]:
    """(tokens, require_for_loopback) from settings. Never raises: before the
    AppState exists (early boot) — or on any read problem — it answers
    "no auth", so a config glitch can't lock the user out."""
    try:
        settings = get_state().settings.get()
    except RuntimeError:
        return [], False
    return list(settings.auth.tokens or []), bool(settings.auth.require_for_loopback)
