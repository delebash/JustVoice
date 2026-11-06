# Webhooks

JustVoice sends HMAC-SHA256-signed outbound notifications to URLs you configure. Useful for CI integrations, JustWrite render-complete notifications, custom dashboards.

## Add a subscription

Webhooks tab → "+ Add webhook":

1. **URL** — the endpoint JustVoice POSTs to.
2. **Events** — checkboxes for the events you want delivered.
3. **Secret** — auto-generated 32 random bytes if blank. JustVoice shows the plaintext secret **exactly once** at creation — copy it now, it's not retrievable later. It keeps the secret itself to sign every delivery (as any webhook sender must); a webhook made before 2026-11-05 kept only a fingerprint of it and signs with an empty key — delete it and add it again.
4. **Enabled** — toggle delivery without deleting the row.

## Event catalog

| Event | When it fires | `data` |
|---|---|---|
| `render.completed` | A render job runs to its end — its lines that failed are counted in it (a cancelled job sends nothing). | `job_id`, `project_id`, `scope`, `status`, `total_blocks`, `completed_blocks`, `failed_blocks` |
| `render.failed` | A render job stops on an error of its own. | the same, and `error` |
| `generation.created` | A take is saved — each line a render makes, and each MCP `justvoice.speak`. High-frequency. | `id`, `take_id`, `block_id`, `project_id`, `chapter_id`, `persona_id`, `duration_sec`, `source` (a render's take; `id`, `persona_id`, `duration_sec`, `source: "mcp"` from MCP) |
| `voice.created` | A voice is made — cloned, designed, imported, or kept from a preview. | `id`, `name`, `engine`, `source` |

The body is `{"event": "<name>", "data": {…}, "timestamp": <unix seconds>}`. (Until 2026-11-05 none of
these four fired — the app never sent them; only the **Test** button's event did.)

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
