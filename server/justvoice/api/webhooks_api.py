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
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    retry_if_result,
    stop_after_attempt,
    wait_chain,
    wait_fixed,
    wait_random,
)

from ..database import Webhook, get_db
from ..database import session as _db_session
from ..database.session import SessionLocal
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
_LOG_TAIL_CAP = 50  # rolling delivery-attempt log, per the module + model docstrings

# Replay the fixed [1s, 5s, 30s, 5m] backoff via tenacity (a prebuilt retry lib
# — chosen over the hand-rolled loop that swallowed every failure) with a touch
# of proportional jitter so a fleet of webhooks pointed at one downed endpoint
# doesn't retry in lockstep. wait_chain yields the Nth wait before the Nth retry.
_wait_ladder = wait_chain(
    *[wait_fixed(s) + wait_random(0, max(1.0, s * 0.1)) for s in _RETRY_DELAYS_S]
)


def _is_failure_status(status_code: int) -> bool:
    """A non-2xx response is a delivery failure worth retrying."""
    return not (200 <= status_code < 300)


def _summarize_exc(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:200]


def _open_bg_db() -> Optional[Session]:
    """Open a session for the detached dispatcher. It runs via create_task
    long after the request session that fanned it out has closed, so it can't
    borrow that one. SessionLocal is None until init_db() runs (the module
    import binds the pre-init value) — resolve lazily, the way
    render_chapter_api._open_db does; tests patch this module's SessionLocal."""
    factory = SessionLocal or _db_session.SessionLocal
    return factory() if factory is not None else None


def _record_attempt(webhook_id: str, status_code: Optional[int], error: Optional[str]) -> None:
    """Persist one delivery attempt: bump last_status_code + last_delivery_at
    and append a capped ``{timestamp, status, error?}`` entry to log_tail_json.

    This is the bookkeeping the module + Webhook-model docstrings promise —
    previously only the synchronous /test path recorded anything; the
    background dispatcher swallowed every outcome. Now every attempt (success
    AND failure) is recorded, the same way the sync path persists. Best-effort:
    a bookkeeping error must never crash delivery."""
    db = _open_bg_db()
    if db is None:
        return
    try:
        wh = db.query(Webhook).filter(Webhook.id == webhook_id).first()
        if wh is None:
            return
        wh.last_status_code = status_code
        wh.last_delivery_at = datetime.utcnow()
        try:
            tail = json.loads(wh.log_tail_json or "[]")
            if not isinstance(tail, list):
                tail = []
        except (ValueError, TypeError):
            tail = []
        entry: dict = {"timestamp": int(time.time()), "status": status_code}
        if error:
            entry["error"] = error
        tail.append(entry)
        wh.log_tail_json = json.dumps(tail[-_LOG_TAIL_CAP:])  # roll to the cap
        db.commit()
    except Exception:  # noqa: BLE001 — bookkeeping must not kill delivery
        db.rollback()
    finally:
        db.close()


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

    async def _attempt() -> int:
        # One delivery attempt. Records the outcome — status code, or the
        # exception summary for a transport failure — BEFORE returning/raising,
        # so last_status_code + log_tail reflect every attempt.
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, content=body_bytes, headers=headers)
        except Exception as exc:  # noqa: BLE001 — transport failure → retry + record
            _record_attempt(webhook_id, None, _summarize_exc(exc))
            raise
        _record_attempt(
            webhook_id,
            resp.status_code,
            f"HTTP {resp.status_code}" if _is_failure_status(resp.status_code) else None,
        )
        return resp.status_code

    # 5 attempts total: the first, then the [1,5,30,300]s ladder. Retry on any
    # transport exception OR a non-2xx status; on exhaustion tenacity raises
    # RetryError, which we swallow — delivery is fire-and-forget and every
    # attempt is already recorded above.
    retryer = AsyncRetrying(
        stop=stop_after_attempt(1 + len(_RETRY_DELAYS_S)),
        wait=_wait_ladder,
        retry=retry_if_exception_type() | retry_if_result(_is_failure_status),
        reraise=False,
    )
    try:
        await retryer(_attempt)
    except RetryError:
        pass
