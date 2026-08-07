# SPDX-License-Identifier: MIT
"""CSRF Origin guard (csrf.py) — the no-token "do the vector directly" hardening.

JW's test_csrf.py is the donor. JV addition: the loopback origin_regex from
settings.cors is part of the ONE allowlist, so a local page on any loopback
port stays allowed (JV's documented CORS posture) while a foreign web origin
is rejected on mutations.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def test_cross_site_mutation_rejected(client):
    # A malicious page's cross-site mutating request is rejected (the CSRF vector).
    r = client.post("/v1/projects", json={"name": "T", "project_type": "custom"},
                    headers={"origin": "http://evil.example"})
    assert r.status_code == 403
    assert r.json()["type"].endswith("/cross-origin")


def test_no_origin_and_app_origin_allowed(client):
    # No Origin (non-browser client / the Tauri HTTP-plugin path) → allowed.
    assert client.post("/v1/projects", json={"name": "A", "project_type": "custom"}).status_code == 201
    # The app's own dev origin (Vite :1430) → allowed.
    assert client.post("/v1/projects", json={"name": "B", "project_type": "custom"},
                       headers={"origin": "http://localhost:1430"}).status_code == 201


def test_loopback_regex_origin_allowed(client):
    """JV's CORS posture deliberately admits any loopback origin (the
    settings.cors.origin_regex); CSRF honours the same one allowlist, so a
    local page on an arbitrary port keeps working."""
    r = client.post("/v1/projects", json={"name": "C", "project_type": "custom"},
                    headers={"origin": "http://localhost:9999"})
    assert r.status_code == 201


def test_same_origin_mutation_allowed(client):
    """The SERVER-HOSTED UI (headless mode: `serve` + a browser on the /ui/
    mount) is same-origin, and browsers DO send Origin on same-origin
    mutations — without this allowance every write from that UI would 403
    (JW hit exactly that, 2026-07-15). Derived per-request, so any host/port."""
    r = client.post("/v1/projects", json={"name": "S", "project_type": "custom"},
                    headers={"origin": "http://testserver"})
    assert r.status_code == 201


def test_cross_site_read_allowed(client):
    # GET is not the CSRF vector (and CORS blocks the page from reading the body).
    r = client.get("/v1/projects", headers={"origin": "http://evil.example"})
    assert r.status_code == 200
