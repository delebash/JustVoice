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
| `model.download.completed` | An engine model finishes downloading. |
| `model.download.failed` | A model download fails. |

## HMAC signing

Every POST carries an `X-JustVoice-Signature` header: the hex of `HMAC-SHA256(secret, body)` (no prefix). Receivers verify by recomputing and comparing in constant time. JustVoice also sends `X-JustVoice-Event` (event name) and `X-JustVoice-Delivery` (per-delivery UUID).

Example receiver (Node):

    import { createHmac, timingSafeEqual } from "node:crypto";
    import { createServer } from "node:http";

    createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const sig = Buffer.from(String(req.headers["x-justvoice-signature"] || ""));
      const want = Buffer.from(createHmac("sha256", SECRET).update(body).digest("hex"));
      if (sig.length !== want.length || !timingSafeEqual(sig, want)) return res.writeHead(401).end();
      // ... handle JSON.parse(body)
      res.writeHead(204).end();
    }).listen(9000);

## Retry policy

At-least-once delivery. If the receiver returns non-2xx or times out (15 s; 10 s for the Test button), JustVoice retries with exponential backoff:

- 1s, 5s, 30s, 5min (4 retries total → 5 attempts including the initial).

After exhaustion the delivery is marked **failed** + visible in the webhooks table with the last response code or error message.

## Test before shipping

Each webhook row has a **Test** button that fires a synthetic event with payload `{ test: true, timestamp: <iso> }`. Useful to verify URL + signature + receiver are wired up before depending on a real render.

## Bulk delivery view

Settings → Webhooks → Recent deliveries shows the last 100 attempts across all subscriptions with status code + latency. Filter by webhook URL or status to find failures fast.

## Disabling vs deleting

Toggle a webhook to **Enabled: off** to stop deliveries without losing the secret + URL. Useful while debugging the receiver. Delete the webhook only when you're done with it permanently — there's no undo.
