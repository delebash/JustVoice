# Settings reference

The Settings model has fourteen sections. The ones with their own doc pages are
linked; the rest are summarized here at the level the UI exposes them. (Renderer
preferences — window/layout state — live separately under `/v1/prefs` and never
need your attention; this page is the operator config under `/v1/settings`.)

| Section | What it holds |
|---|---|
| `server` | Host/port the headless server binds; see [Run modes](run-modes.md). |
| `logging` | Log level + retention for the server log. |
| `cache` | The disk-LRU render cache limits (identical renders cost nothing twice). |
| `limits` | Guardrails — max text length per generation and friends. |
| `cors` | Allowed origins when serving browsers beyond localhost. |
| `auth` | Bearer tokens; auth is off while the list is empty. Loopback exempt unless required. |
| `mastering` | The default loudness target per preset (ACX / iAudio / Podcast / YouTube) — see [Mastering](mastering.md). |
| `training` | LoRA training knobs incl. validation split — see [Labs](labs.md) → Train. |
| `models` | Model source URL overrides per engine/variant, for mirrors or pinned downloads. |
| `engines` | Per-engine settings (GPU opt-in state, variants). See [Engines](engines.md). |
| `generation` | Generation defaults incl. auto-chunking — see [Generate](generate.md). |
| `captures` | Dictation: push-to-talk chord, refinement — see [Dictation](dictation.md). |
| `mcp` | One field: the default voice for agent `speak` calls — see [MCP server](mcp-server.md). |
| `app` | `primary_use_case` (the Welcome pick; re-pick here) and app-level toggles. |

## Restart-required

A few fields only take effect after a server restart — the API names them when
you change one: `server.host`, `server.port`, `server.docs_enabled`,
`logging.level`, `logging.format`, `cors.origins`,
`limits.request_body_max_bytes`, and `engines.kokoro.model_dir_override`.
