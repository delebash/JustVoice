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
| `auth` | Bearer tokens; auth is off while the list is empty. Loopback exempt unless required. Even when required, three things still answer from this machine without a token: the health check, the token settings themselves (so you can't lock yourself out), and the desktop app's shutdown when you close its window. |
| `mastering` | The default loudness target per preset (ACX / iAudio / Podcast / YouTube) — see [Mastering](mastering.md). |
| `models` | Model source URL overrides per engine/variant, for mirrors or pinned downloads. |
| `engines` | The default speech engine; per engine, its default model and any download-source override (another Hugging Face repo holding the same files); `speech_runtime` — the speech runtime's `backend` (`auto` / `cuda` / `vulkan` / `cpu` / `metal`), `gpu`, `cpu_threads` (the CPU process's threads; 0 = the physical core count), `cpu_min_realtime` (Auto's bar for the CPU, 2× real time), `gpu_threads` (the graphics-card process's CPU threads, for its work off the card; 4), `start_timeout_s` (how long a runtime process may take to start, 60) and `request_timeout_s` (how long one line or model load may run, 900; a transcription always gets at least three times its recording's length), set through `PUT /v1/speech-runtime` — a field the request leaves out keeps its value, and changing `gpu_threads` restarts the graphics-card process; per engine, `placements` (model → `auto` / `gpu` / `cpu`, set from each model row through `PUT /v1/engines/{id}/models/{model}/placement`), `split_chars` (model → the longest piece a line reaches it in, in characters; a model not listed uses its catalog length, [Engines → Long lines](engines.md#long-lines-and-what-a-model-costs)), `runtime_options` (model → the speech runtime options set on its row, e.g. `qwen3_tts.perf_mode`; only values other than the default, set through `PUT /v1/engines/{id}/models/{model}/runtime-options` — [Engines → Options on a model's row](engines.md#what-each-engine-can-be-tuned-with)) and `terms_accepted_at` (when you accepted the engine's own terms — Pocket TTS — through `POST /v1/engines/{id}/terms`); and your external TTS providers. See [Engines](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu). |
| `generation` | Generation defaults incl. auto-chunking; `pause_between_lines_ms` — the silence between a chapter's lines in Render, export and ACX QC (600) — see [Engines → Long text](engines.md#long-text-cut-into-pieces), [Studio → Render](studio.md#render); and `default_voice_language` — the language a blend speaks when the voices it mixes disagree (`en-US`), see [Personas → New blend](personas.md#new-blend). |
| `captures` | Dictation: push-to-talk chord, refinement, the speech-recognition model (`stt_model`) and capture language — see [Dictation](dictation.md). |
| `mcp` | One field: the default voice for agent `speak` calls — see [MCP server](mcp-server.md). |
| `app` | `primary_use_case` (the Welcome pick; re-pick here) and app-level toggles. |

## Restart-required

A few fields only take effect after a server restart — the API names them when
you change one: `server.host`, `server.port`, `server.docs_enabled`,
`logging.level`, `logging.format`, `cors.origins`,
and `limits.request_body_max_bytes`. Changing the speech runtime's backend or
GPU needs no restart: it unloads the speech models and stops the runtime, and
the next load starts the build you chose.
