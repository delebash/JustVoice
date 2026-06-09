# Webhooks

JustVoice sends HMAC-SHA256-signed outbound notifications to URLs you configure. Useful for CI integrations, JustWrite render-complete notifications, custom dashboards.

## Add a subscription

Webhooks tab → "+ Add webhook":

1. **URL** — the endpoint JustVoice POSTs to.
2. **Events** — checkboxes for the events you want delivered.
3. **Secret** — auto-generated 32 random bytes if blank. JustVoice shows the plaintext secret **exactly once** at creation — copy it now, it's not retrievable later.
4. **Enabled** — toggle delivery without deleting the row.

## Event catalog

| Event | When it fires |
|---|---|
| `render.completed` | A chapter / project render finishes successfully. |
| `render.failed` | A render fails. Body includes error details. |
| `generation.created` | A new Block render lands in the DB. High-frequency. |
| `voice.created` | A new voice profile is added. |
| `training.completed` | A LoRA training job finishes. |
| `training.failed` | A training job fails. |
| `model.download.completed` | An engine model finishes downloading. |
| `model.download.failed` | A model download fails. |

## HMAC signing

Every POST carries an `X-JustVoice-Signature` header: `sha256=<hex>` of `HMAC(secret, body)`. Receivers verify by recomputing and comparing in constant time. JustVoice also sends `X-JustVoice-Event` (event name) and `X-JustVoice-Delivery` (per-delivery UUID).

Example receiver (Python / FastAPI):

    import hmac, hashlib
    @app.post("/webhook")
    async def receive(request: Request):
        body = await request.body()
        sig = request.headers.get("x-justvoice-signature", "").removeprefix("sha256=")
        want = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, want):
            raise HTTPException(401)
        ...

## Retry policy

At-least-once delivery. If the receiver returns non-2xx or times out (10s), JustVoice retries with exponential backoff:

- 1s, 5s, 30s, 5min (4 retries total → 5 attempts including the initial).

After exhaustion the delivery is marked **failed** + visible in the webhooks table with the last response code or error message.

## Test before shipping

Each webhook row has a **Test** button that fires a synthetic event with payload `{ test: true, timestamp: <iso> }`. Useful to verify URL + signature + receiver are wired up before depending on a real render.

## Bulk delivery view

Settings → Webhooks → Recent deliveries shows the last 100 attempts across all subscriptions with status code + latency. Filter by webhook URL or status to find failures fast.

## Disabling vs deleting

Toggle a webhook to **Enabled: off** to stop deliveries without losing the secret + URL. Useful while debugging the receiver. Delete the webhook only when you're done with it permanently — there's no undo.
