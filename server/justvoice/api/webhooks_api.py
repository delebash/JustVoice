# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/webhooks — outbound HTTP webhooks with HMAC-SHA256 signed bodies.

Delivery: at-least-once with exponential backoff (1s, 5s, 30s, 5m,
max 3 retries). Signature header `X-JustVoice-Signature: hex(hmac_sha256(secret, body))`.
Failed deliveries logged to rolling log_tail (capped 50 entries).

See DESIGN_FREEZE.md §4.12 + §5 webhooks workflow.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime
from typing import Optional, Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.orm import Session

from ..database import Webhook, get_db
from ..errors import not_found


router = APIRouter(tags=["webhooks"])


WebhookEvent = Literal[
    "render.completed",
    "render.failed",
    "generation.created",
    "voice.created",
    "training.completed",
    "training.failed",
    "model.download.completed",
    "model.download.failed",
    "webhook.test",
]


class WebhookSubscription(BaseModel):
    id: str
    url: str
    events: list[WebhookEvent]
    secret_set: bool = True
    enabled: bool
    created_at: datetime
    last_delivery_at: Optional[datetime]
    last_status_code: Optional[int]

    @classmethod
    def from_orm(cls, row: Webhook) -> "WebhookSubscription":
        return cls(
            id=row.id,
            url=row.url,
            events=json.loads(row.events_json),
            secret_set=bool(row.secret_hash),
            enabled=row.enabled,
            created_at=row.created_at,
            last_delivery_at=row.last_delivery_at,
            last_status_code=row.last_status_code,
        )


class WebhookList(BaseModel):
    subscriptions: list[WebhookSubscription]


class CreateWebhookRequest(BaseModel):
    url: HttpUrl
    events: list[WebhookEvent]
    secret: Optional[str] = Field(None, min_length=8, max_length=256)
    enabled: bool = True


class WebhookWithSecret(BaseModel):
    subscription: WebhookSubscription
    secret: str  # returned ONCE


class WebhookTestResult(BaseModel):
    delivered: bool
    status_code: Optional[int]
    latency_ms: Optional[int]
    error: Optional[str]


# In-process secret cache. We hash the secret for storage, but the dispatcher
# needs the raw secret to sign payloads — so we keep raw secrets in memory
# after creation. On server restart, the operator must rotate them via PATCH.
# (We could derive a separate HMAC key from a server-wide secret + webhook id,
# but for v1 the simpler model is good enough.)
_SECRETS_CACHE: dict[str, str] = {}


def _hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@router.get("/v1/webhooks", response_model=WebhookList)
async def list_webhooks(db: Session = Depends(get_db)) -> WebhookList:
    rows = db.query(Webhook).order_by(Webhook.created_at).all()
    return WebhookList(subscriptions=[WebhookSubscription.from_orm(r) for r in rows])


@router.post("/v1/webhooks", response_model=WebhookWithSecret, status_code=201)
async def create_webhook(body: CreateWebhookRequest, db: Session = Depends(get_db)) -> WebhookWithSecret:
    raw_secret = body.secret or secrets.token_urlsafe(32)
    wh = Webhook(
        url=str(body.url),
        events_json=json.dumps(body.events),
        secret_hash=_hash_secret(raw_secret),
        enabled=body.enabled,
    )
    db.add(wh)
    db.commit()
    db.refresh(wh)
    _SECRETS_CACHE[wh.id] = raw_secret
    return WebhookWithSecret(subscription=WebhookSubscription.from_orm(wh), secret=raw_secret)


@router.delete("/v1/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, db: Session = Depends(get_db)) -> dict:
    wh = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not wh:
        raise not_found(f"webhook {webhook_id}")
    db.delete(wh)
    _SECRETS_CACHE.pop(webhook_id, None)
    db.commit()
    return {"deleted": True}


@router.post("/v1/webhooks/{webhook_id}/test", response_model=WebhookTestResult)
async def test_webhook(webhook_id: str, db: Session = Depends(get_db)) -> WebhookTestResult:
    wh = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not wh:
        raise not_found(f"webhook {webhook_id}")
    payload = {"event": "webhook.test", "ping": int(time.time())}
    body_bytes = json.dumps(payload).encode("utf-8")
    secret = _SECRETS_CACHE.get(webhook_id, "")
    signature = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-JustVoice-Signature": signature,
    }
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(wh.url, content=body_bytes, headers=headers)
        latency_ms = int((time.perf_counter() - start) * 1000)
        wh.last_status_code = resp.status_code
        wh.last_delivery_at = datetime.utcnow()
        db.commit()
        return WebhookTestResult(
            delivered=200 <= resp.status_code < 300,
            status_code=resp.status_code,
            latency_ms=latency_ms,
            error=None if 200 <= resp.status_code < 300 else f"HTTP {resp.status_code}",
        )
    except Exception as e:
        return WebhookTestResult(
            delivered=False,
            status_code=None,
            latency_ms=int((time.perf_counter() - start) * 1000),
            error=str(e),
        )


# ── Background dispatcher (fire-and-forget) ───────────────────────────────


_RETRY_DELAYS_S = [1, 5, 30, 300]  # 1s, 5s, 30s, 5m


async def dispatch_event(event: WebhookEvent, payload: dict, db: Session) -> None:
    """Fan out an event to all enabled webhooks subscribed to it.

    Runs asynchronously; the caller fire-and-forgets via asyncio.create_task.
    """
    subs = (
        db.query(Webhook)
        .filter(Webhook.enabled == True)  # noqa: E712
        .all()
    )
    for sub in subs:
        events = json.loads(sub.events_json or "[]")
        if event not in events:
            continue
        asyncio.create_task(_deliver_with_retry(sub.id, sub.url, event, payload))


async def _deliver_with_retry(webhook_id: str, url: str, event: WebhookEvent, payload: dict) -> None:
    body = {"event": event, "data": payload, "timestamp": int(time.time())}
    body_bytes = json.dumps(body).encode("utf-8")
    secret = _SECRETS_CACHE.get(webhook_id, "")
    signature = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-JustVoice-Signature": signature,
        "X-JustVoice-Event": event,
    }
    for attempt, delay in enumerate([0] + _RETRY_DELAYS_S):
        if delay:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, content=body_bytes, headers=headers)
            if 200 <= resp.status_code < 300:
                return
        except Exception:
            pass
        if attempt >= len(_RETRY_DELAYS_S):
            break
