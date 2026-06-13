# SPDX-License-Identifier: GPL-3.0-or-later
"""GET /v1/logs/download — the Settings → Logs download button's target
(wiring-audit W4: the UI requested /v1/logs/download?hours=24 from a
route that didn't exist)."""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def test_download_serves_ring_as_attachment(client):
    # warning level — the test env's root logger sits at WARNING, so
    # info() records would never reach the ring handler.
    logging.getLogger("justvoice.test").warning("wiring-audit-w4-marker")

    r = client.get("/v1/logs/download")

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert "attachment" in r.headers["content-disposition"]
    assert "justvoice-logs-" in r.headers["content-disposition"]
    assert "wiring-audit-w4-marker" in r.text


def test_download_matches_tail_content(client):
    logging.getLogger("justvoice.test").warning("tail-parity-marker")

    tail = client.get("/v1/logs/tail?lines=500").json()["text"]
    download = client.get("/v1/logs/download").text

    assert "tail-parity-marker" in tail
    assert tail == download
