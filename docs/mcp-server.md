# MCP server

JustVoice speaks MCP (Model Context Protocol), so an AI agent — Claude Code,
Claude Desktop, anything MCP-capable — can generate speech through your running
JustVoice with your voices, personas, and lexicons.

*(This page was rewritten 2026-08-04 from the code — the earlier version
described a design that never shipped — and brought up to date 2026-10-08,
when the server moved to the official MCP SDK and `/mcp` came behind the
server's token.)*

## What's exposed — four tools

| Tool | What it does |
|---|---|
| `justvoice.speak` | Generate speech from text with a voice or persona. Returns an **`audio_url`** you fetch — it does not auto-play anywhere. |
| `justvoice.list_voices` | The voice library, for picking. |
| `justvoice.list_personas` | The persona library — your finished voices (name, voice, and `has_note`: whether it has a note on how it sounds). |
| `justvoice.transcribe` | Speech-to-text on an audio file. The `audio_path` is **loopback-only** — a remote client can't point it at server files. |

`speak` takes `text` and, optionally, `voice` (an id from `list_voices`),
`persona` (a name from `list_personas`) and `language`. With neither voice nor
persona, the persona bound to the calling client is used (see below), then the
`default_voice` setting; with none of those the call is refused and the error
says which of the four to set. Its answer carries the `generation_id`, the
`audio_url` (`/v1/generations/<id>/audio` on the same server), and the clip's
length in seconds, read from the audio itself. `transcribe` takes exactly one
of `audio_base64` (the file's bytes) or `audio_path`, plus an optional
`language`.

## How it's mounted

MCP runs **inside the JustVoice server** at `/mcp` on the same port —
`http://127.0.0.1:17494/mcp` — over the protocol's Streamable HTTP transport,
built on the official MCP SDK. There is no separate port, no shim binary, and
no on/off toggle: it mounts whenever the server starts. A client opens a
session with an `initialize` request and names it in the `mcp-session-id`
header from then on; MCP clients do this for you. Sessions end when the client
closes them or the server stops. The one MCP setting is `default_voice` — the
voice used when a `speak` call names none.

## Connect a client

```bash
claude mcp add justvoice --transport http \
  --url http://127.0.0.1:17494/mcp \
  --header "X-JustVoice-Client-Id: my-agent"
```

The `X-JustVoice-Client-Id` header identifies the client for **bindings**: in
Settings you can bind a client id to a persona (`client_id / label /
persona_id`), so "my-agent" always speaks as persona Mara without naming it in every
call. Settings → MCP shows each client's *last seen* time.

Settings → MCP also has ready-to-copy snippets for Claude Desktop and Claude
Code, and a **curl smoke test**: one `initialize` request that answers with the
server's name and a new session id (`-i` shows the `mcp-session-id` header) —
proof the endpoint is reachable. To try the tools by hand, the MCP Inspector
connects to the same URL: `npx @modelcontextprotocol/inspector`, then choose
*Streamable HTTP* and enter `http://127.0.0.1:17494/mcp`.

## Tokens and the Origin check

`/mcp` is guarded exactly like the rest of the server's API (since
2026-10-08):

- **Access tokens.** With no tokens set (Settings → Server → Access tokens), anyone who can reach
  the port can call the tools — the normal case for a server on `127.0.0.1`.
  With tokens set, a client on another machine must send
  `Authorization: Bearer <token>`; one on this machine needs it only when
  *Require a token even on localhost* is on. Add it to the client the same way
  as the client-id header, e.g.
  `--header "Authorization: Bearer <token>"` on `claude mcp add`. A missing
  token answers 401, a wrong one 403.
- **The Origin check.** A web page in your browser can't post to `/mcp`: a
  request carrying an `Origin` header from a site that isn't JustVoice's own is
  refused (403). MCP clients are not browsers and send no `Origin`, so they are
  never affected.

## Generations from agents

Audio generated over MCP is tagged with its source (`mcp`) and the language it
was spoken in — the one the call named, else the persona's. The generations
land in the library like any other, so you can review or delete them normally.
