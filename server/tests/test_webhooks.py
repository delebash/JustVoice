# SPDX-License-Identifier: MIT
"""Tests for webhooks — HMAC signature contract + storage round-trip, plus
the background dispatcher's delivery bookkeeping + retry ladder (HTTP mocked,
backoff patched to zero so the ladder runs instantly).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

import httpx
from tenacity import wait_fixed

from justvoice.api import webhooks_api as wh_api
from justvoice.api.webhooks_api import _hash_secret
from justvoice.database.models import Webhook

pytest_plugins = ["tests.conftest_db"]


def test_hash_secret_is_deterministic():
    h1 = _hash_secret("topsecret")
    h2 = _hash_secret("topsecret")
    h3 = _hash_secret("different")
    assert h1 == h2
    assert h1 != h3


def test_webhook_round_trip(db_session):
    w = Webhook(
        url="https://example.com/hook",
        events_json=json.dumps(["render.completed", "render.failed"]),
        secret_hash=_hash_secret("s"),
        enabled=True,
    )
    db_session.add(w)
    db_session.commit()
    fetched = db_session.query(Webhook).first()
    assert fetched.url == "https://example.com/hook"
    assert json.loads(fetched.events_json) == ["render.completed", "render.failed"]
    assert fetched.enabled is True


def test_hmac_signature_format():
    """X-JustVoice-Signature = hex(hmac_sha256(secret, body)). Verify the
    canonical computation that the dispatcher emits.
    """
    secret = "s3cret"
    body = json.dumps({"event": "render.completed", "data": {"id": "abc"}}).encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    assert len(expected) == 64  # SHA-256 hex = 64 chars
    assert all(c in "0123456789abcdef" for c in expected)


# ── Background dispatcher: bookkeeping + retry ladder ─────────────────────


class _FakeResp:
    def __init__(self, status_code: int):
        self.status_code = status_code


class _FakeClient:
    """Stand-in for httpx.AsyncClient. Yields the next scripted outcome per
    POST (a status int → response, or an Exception → raised) and counts calls
    via the shared `calls` dict."""

    def __init__(self, statuses, calls):
        self._statuses = statuses
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, content=None, headers=None):
        i = self._calls["n"]
        self._calls["n"] += 1
        val = self._statuses[min(i, len(self._statuses) - 1)]
        if isinstance(val, Exception):
            raise val
        return _FakeResp(val)


def _seed_webhook(session_factory, wid="wh-1"):
    db = session_factory()
    try:
        db.add(
            Webhook(
                id=wid,
                url="https://example.com/hook",
                events_json=json.dumps(["render.completed"]),
                secret_hash=_hash_secret("s"),
                enabled=True,
            )
        )
        db.commit()
    finally:
        db.close()
    return wid


def _patch_delivery(monkeypatch, session_factory, statuses):
    """Point the dispatcher at the test DB, zero the backoff, script the HTTP
    outcomes. Returns the shared call counter."""
    calls = {"n": 0}
    monkeypatch.setattr(wh_api, "SessionLocal", session_factory)
    monkeypatch.setattr(wh_api, "_wait_ladder", wait_fixed(0))
    monkeypatch.setattr(
        wh_api.httpx, "AsyncClient", lambda *a, **k: _FakeClient(statuses, calls)
    )
    return calls


def _fetch(session_factory, wid):
    db = session_factory()
    try:
        return db.query(Webhook).filter(Webhook.id == wid).first()
    finally:
        db.close()


def test_background_failure_recorded_and_ladder_retries(tmp_db, monkeypatch):
    """A persistently-failing endpoint: all 5 attempts fire (first + the
    [1,5,30,300] ladder) and EVERY failure is recorded — the exact gap left by
    the old `except Exception: pass` dispatcher."""
    session_factory, _engine = tmp_db
    wid = _seed_webhook(session_factory)
    calls = _patch_delivery(monkeypatch, session_factory, [500])

    asyncio.run(
        wh_api._deliver_with_retry(wid, "https://example.com/hook", "render.completed", {"k": "v"})
    )

    assert calls["n"] == 5  # 1 + len(_RETRY_DELAYS_S)
    wh = _fetch(session_factory, wid)
    assert wh.last_status_code == 500
    assert wh.last_delivery_at is not None
    tail = json.loads(wh.log_tail_json)
    assert len(tail) == 5
    assert all(e["status"] == 500 and e["error"] == "HTTP 500" for e in tail)


def test_background_success_records_once(tmp_db, monkeypatch):
    session_factory, _engine = tmp_db
    wid = _seed_webhook(session_factory)
    calls = _patch_delivery(monkeypatch, session_factory, [200])

    asyncio.run(
        wh_api._deliver_with_retry(wid, "https://example.com/hook", "render.completed", {"k": "v"})
    )

    assert calls["n"] == 1  # 2xx → no retry
    wh = _fetch(session_factory, wid)
    assert wh.last_status_code == 200
    tail = json.loads(wh.log_tail_json)
    assert len(tail) == 1
    assert tail[0]["status"] == 200 and "error" not in tail[0]


def test_background_recovers_on_second_attempt(tmp_db, monkeypatch):
    session_factory, _engine = tmp_db
    wid = _seed_webhook(session_factory)
    calls = _patch_delivery(monkeypatch, session_factory, [503, 200])

    asyncio.run(
        wh_api._deliver_with_retry(wid, "https://example.com/hook", "render.completed", {"k": "v"})
    )

    assert calls["n"] == 2  # fail, then succeed
    wh = _fetch(session_factory, wid)
    assert wh.last_status_code == 200  # final success wins
    tail = json.loads(wh.log_tail_json)
    assert [e["status"] for e in tail] == [503, 200]


def test_background_transport_exception_recorded(tmp_db, monkeypatch):
    """Network/transport errors (no HTTP status) also record — status None,
    the exception summary in the log tail — and retry the full ladder."""
    session_factory, _engine = tmp_db
    wid = _seed_webhook(session_factory)
    calls = _patch_delivery(monkeypatch, session_factory, [httpx.ConnectError("boom")])

    asyncio.run(
        wh_api._deliver_with_retry(wid, "https://example.com/hook", "render.completed", {"k": "v"})
    )

    assert calls["n"] == 5
    wh = _fetch(session_factory, wid)
    assert wh.last_status_code is None
    tail = json.loads(wh.log_tail_json)
    assert len(tail) == 5
    assert all("ConnectError" in e["error"] for e in tail)


def test_log_tail_capped_at_50(tmp_db, monkeypatch):
    """The rolling tail never grows past the cap, across many deliveries."""
    session_factory, _engine = tmp_db
    wid = _seed_webhook(session_factory)
    # Each call succeeds → one attempt, one tail entry. Run enough to overflow.
    _patch_delivery(monkeypatch, session_factory, [200])
    for _ in range(wh_api._LOG_TAIL_CAP + 10):
        asyncio.run(
            wh_api._deliver_with_retry(
                wid, "https://example.com/hook", "render.completed", {"k": "v"}
            )
        )
    wh = _fetch(session_factory, wid)
    assert len(json.loads(wh.log_tail_json)) == wh_api._LOG_TAIL_CAP
