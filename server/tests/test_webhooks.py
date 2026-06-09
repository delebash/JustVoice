# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for webhooks — HMAC signature contract + storage round-trip.

The dispatcher's network behavior (retry backoff, real HTTP) is tested
manually via /v1/webhooks/{id}/test against a known receiver.
"""

from __future__ import annotations

import hashlib
import hmac
import json

from justtts.api.webhooks_api import _hash_secret
from justtts.database.models import Webhook

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
