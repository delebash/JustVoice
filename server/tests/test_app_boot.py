# SPDX-License-Identifier: MIT
"""Test that the FastAPI app boots cleanly and registers expected routes.

Smoke test — if create_app() raises, the server is broken. If the documented
contract endpoints are missing, the JustWrite consumer breaks.
"""

from __future__ import annotations

import pytest


def _route_paths(app) -> set[str]:
    """All registered API paths, robust across FastAPI versions.

    FastAPI >=0.137 wraps ``include_router`` results in opaque
    ``_IncludedRouter`` objects with no flat ``.path``, so iterating
    ``app.routes`` alone misses the whole /v1 surface. The OpenAPI schema is
    the version-stable public source of registered paths; union it with any
    directly-exposed ``.path``s (older FastAPI flattened included routers into
    ``APIRoute`` objects).
    """
    paths: set[str] = set()
    try:
        paths.update(app.openapi().get("paths", {}).keys())
    except Exception:  # noqa: BLE001 — fall back to route introspection
        pass
    for r in app.routes:
        p = getattr(r, "path", None)
        if isinstance(p, str):
            paths.add(p)
    return paths


def test_app_creates_without_error(tmp_path) -> None:
    from justvoice.app import create_app

    app = create_app(data_dir=tmp_path)
    assert app is not None
    assert hasattr(app, "routes")


def test_contract_endpoints_registered(tmp_path) -> None:
    """Sanity-check the CONTRACT.md endpoints exist after app boot."""
    from justvoice.app import create_app

    app = create_app(data_dir=tmp_path)
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


def test_no_v0_routes_leaked(tmp_path) -> None:
    """All API surface should be under /v1 (or /ui for the renderer)."""
    from justvoice.app import create_app

    app = create_app(data_dir=tmp_path)
    paths = _route_paths(app)
    for p in paths:
        if p.startswith("/api/v0") or p.startswith("/v0"):
            pytest.fail(f"Unexpected v0 route still registered: {p}")
