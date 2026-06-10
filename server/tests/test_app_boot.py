# SPDX-License-Identifier: GPL-3.0-or-later
"""Test that the FastAPI app boots cleanly and registers expected routes.

Smoke test — if create_app() raises, the server is broken. If the documented
contract endpoints are missing, the JustWrite consumer breaks.
"""

from __future__ import annotations

import pytest


def _route_paths(app) -> set[str]:
    paths = set()
    for r in app.routes:
        if hasattr(r, "path"):
            paths.add(r.path)
    return paths


def test_app_creates_without_error() -> None:
    from justvoice.app import create_app

    app = create_app()
    assert app is not None
    assert hasattr(app, "routes")


def test_contract_endpoints_registered() -> None:
    """Sanity-check the CONTRACT.md endpoints exist after app boot."""
    from justvoice.app import create_app

    app = create_app()
    paths = _route_paths(app)
    # Spot-check the most load-bearing CONTRACT.md endpoints.
    contract = {
        "/v1/voices",
        "/v1/lexicons",
        "/v1/personas",
        "/v1/settings",
        "/v1/engines",
    }
    missing = contract - paths
    assert not missing, f"CONTRACT.md endpoints missing from app: {missing}"


def test_no_v0_routes_leaked() -> None:
    """All API surface should be under /v1 (or /ui for the renderer)."""
    from justvoice.app import create_app

    app = create_app()
    paths = _route_paths(app)
    for p in paths:
        if p.startswith("/api/v0") or p.startswith("/v0"):
            pytest.fail(f"Unexpected v0 route still registered: {p}")
