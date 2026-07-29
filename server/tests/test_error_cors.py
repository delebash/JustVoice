# SPDX-License-Identifier: MIT
"""Unhandled server errors must reach the browser as real 500s, not
'blocked by CORS'. Starlette runs bare-Exception handlers OUTSIDE
CORSMiddleware, so the fix is a catch-all middleware registered inside
it — this test pins that wiring by hitting a route that raises and
asserting the 500 carries the Access-Control-Allow-Origin header."""

from __future__ import annotations

from fastapi.testclient import TestClient

from justvoice.app import create_app


def test_unhandled_error_is_json_500_with_cors(tmp_path, monkeypatch):
    monkeypatch.setenv("JUSTVOICE_DATA_DIR", str(tmp_path))
    app = create_app()

    # Routes added after create_app land BEHIND the catch-all static
    # mount at "/", so insert at the front of the route table.
    from fastapi.routing import APIRoute

    async def boom():
        raise RuntimeError("kaboom for the test")

    app.router.routes.insert(0, APIRoute("/v1/_test/boom", boom, methods=["GET"]))

    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/v1/_test/boom", headers={"Origin": "http://localhost:1430"})
    assert r.status_code == 500
    # The whole point: the error response went through CORSMiddleware.
    assert r.headers.get("access-control-allow-origin") == "http://localhost:1430"
    body = r.json()
    assert "kaboom" in body["detail"]
