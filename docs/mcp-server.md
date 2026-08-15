# MCP server

JustVoice speaks MCP (Model Context Protocol), so an AI agent — Claude Code,
Claude Desktop, anything MCP-capable — can generate speech through your running
JustVoice with your voices, personas, and lexicons.

*(This page was rewritten 2026-08-04 from the code — the earlier version
described a design that never shipped.)*

## What's exposed — four tools

| Tool | What it does |
|---|---|
| `justvoice.speak` | Generate speech from text with a voice or persona. Returns an **`audio_url`** you fetch — it does not auto-play anywhere. |
| `justvoice.list_voices` | The voice library, for picking. |
| `justvoice.list_personas` | The persona library (name, voice, whether a character sheet is set). |
| `justvoice.transcribe` | Speech-to-text on an audio file. The `audio_path` is **loopback-only** — a remote client can't point it at server files. |

## How it's mounted

MCP runs **inside the JustVoice server** at `/mcp` on the same port —
`http://127.0.0.1:17494/mcp`. There is no separate port, no shim binary, and no
on/off toggle: it mounts whenever the server starts (only a missing `fastmcp`
package disables it, with a log line). The one MCP setting is `default_voice` —
the voice used when a `speak` call names none.

## Connect a client

```bash
claude mcp add justvoice --transport http \
  --url http://127.0.0.1:17494/mcp \
  --header "X-JustVoice-Client-Id: my-agent"
```

The `X-JustVoice-Client-Id` header identifies the client for **bindings**: in
Settings you can bind a client id to a persona (`client_id / label /
persona_id`), so "my-agent" always speaks as Mara without naming her in every
call. If the server has auth tokens set (Settings → auth), add the bearer header
like any other client.

## Generations from agents

Audio generated over MCP is tagged with its source and **skips main-window
autoplay** — an agent run never interrupts what you're listening to. The
generations land in the library like any other, so you can review, favorite, or
delete them normally.
