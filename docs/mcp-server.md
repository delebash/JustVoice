# MCP server

JustVoice exposes its capabilities to MCP-compatible agents (Claude Desktop, claude-code CLI, Cursor, custom integrations) via the **Model Context Protocol**. Agents can ask JustVoice to speak text, transcribe audio, list voices, render chapters, and more.

## Enable + endpoint

Settings → MCP server:

- **Enabled** toggle. Default off.
- **Endpoint**: `http://localhost:17495/mcp` (separate port from the main HTTP API). HTTP + SSE transport.
- Optional stdio transport via a shim binary for clients that need stdio (older Claude Desktop, some Unreal plugins).

## Exposed tools

| Tool | What it does |
|---|---|
| `speak` | Synthesize text + play through the configured channel. Agent → JustVoice → audio. |
| `transcribe` | Pass a WAV / MP3 path, get Whisper transcription back. |
| `list_voices` | Return the voice library with names, types, languages. |
| `list_personas` | Return the persona library. |
| `list_captures` | Return recent dictation captures. |
| `render_chapter` | Render a full Project chapter via the engine pool. |
| `refine` | LLM cleanup pass — fix grammar, expand contractions, etc. |

## Per-client bindings

Each MCP client identifies itself with `X-JustVoice-Client-Id`. JustVoice stores a binding per client: `{ default_persona, default_engine, last_seen_at }`. So Claude Desktop's `speak` tool calls default to Narrator + Chatterbox while claude-code uses Mara + Kokoro.

Manage in Settings → MCP server → Per-client bindings.

## Install snippets

The Settings → MCP server panel has copy-to-clipboard snippets for:

**Claude Desktop** (`claude_desktop_config.json`):

    {
      "mcpServers": {
        "justvoice": {
          "command": "C:\\Program Files\\JustVoice\\mcp-shim.exe",
          "args": ["--endpoint", "http://localhost:17495/mcp"],
          "env": { "JV_CLIENT_ID": "claude_desktop_main" }
        }
      }
    }

**claude-code CLI**:

    claude mcp add justvoice -- "C:\\Program Files\\JustVoice\\mcp-shim.exe" \
      --endpoint http://localhost:17495/mcp --client-id claude_code_v1

**stdio shim** (Unreal / custom):

    "C:\\Program Files\\JustVoice\\mcp-shim.exe" --endpoint http://localhost:17495/mcp --client-id cd_unreal_demo

OS-detected binary paths (Windows-style vs POSIX-style) auto-fill in the live UI.

## Security

The MCP server binds to `127.0.0.1` by default. To expose it on a LAN, change Settings → MCP server → Network access to "remote (0.0.0.0)" — and add a bearer token (auto-generated, rotatable from the same panel).

## Dictation cycle

When an agent calls `speak`, JustVoice can show the floating Dictate window (`?view=dictate`) with the animated capture pill so the user sees the agent is speaking. Configure default playback voice for MCP in Settings → Capture → Default playback voice for dictation.
