# Settings reference

The Settings model has sixteen sections. The ones with their own doc pages are
linked; the rest are summarized here at the level the UI exposes them. (Renderer
preferences — window/layout state — live separately under `/v1/prefs` and never
need your attention; this page is the operator config under `/v1/settings`.)

| Section | What it holds |
|---|---|
| `server` | Host/port the server binds — headless, and the desktop app's own; see [Run modes](run-modes.md). |
| `logging` | Log level + retention for the server log. |
| `cache` | The disk-LRU render cache limits (identical renders cost nothing twice). |
| `limits` | Guardrails — max text length per generation and friends. |
| `cors` | Allowed origins when serving browsers beyond localhost. |
| `auth` | Bearer tokens; auth is off while the list is empty. Loopback exempt unless required. Even when required, three things still answer from this machine without a token: the health check, the token settings themselves (so you can't lock yourself out), and the desktop app's shutdown when you close its window. |
| `mastering` | The default loudness target per preset (ACX / iAudio / Podcast / YouTube) — see [Mastering](mastering.md). |
| `models` | Model source URL overrides per engine/variant, for mirrors or pinned downloads. |
| `engines` | The default speech engine; per engine, its default model and any download-source override (another Hugging Face repo holding the same files); `speech_runtime` — the speech runtime's `backend` (`auto` / `cuda` / `vulkan` / `cpu` / `metal`), `gpu`, `cpu_threads` (the CPU process's threads; 0 = the physical core count), `cpu_min_realtime` (Auto's bar for the CPU, 2× real time), `spill_mb` (Windows: how much a card load may grow the speech runtime's shared GPU memory, in MB, before Auto counts it as spilled into the computer's memory and loads the model on the CPU; 256 — the runtime row's **Card overflow limit (MB)**), `runaway_s_per_char` and `runaway_min_s` (a line whose audio runs longer than this many seconds a character of its text, and longer than this many seconds, ran away: the process that spoke it no longer sets the model's measured memory — [Engines → Long lines](engines.md#long-lines-and-what-a-model-costs); 0.5 and 30), `card_margin_mb` (the headroom, in MB, a speech model not yet measured on this machine is held to on the graphics card on top of its measured free memory — Auto's placement and *fits this card*; 512; a model measured here is weighed at what it took, with none, since 2026-10-16 — [Engines → The speech margin](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu)), `gpu_threads` (the graphics-card process's CPU threads, for its work off the card; 4), `start_timeout_s` (how long a runtime process may take to start, 60) and `request_timeout_s` (how long one line or model load may run, 900; a transcription always gets at least three times its recording's length), set through `PUT /v1/speech-runtime` — a field the request leaves out keeps its value, and changing `gpu_threads` restarts the graphics-card process; per engine, `placements` (model → `auto` / `gpu` / `cpu`, set from each model row through `PUT /v1/engines/{id}/models/{model}/placement`), `split_chars` (model → the longest piece a line reaches it in, in characters; a model not listed uses its catalog length, [Engines → Long lines](engines.md#long-lines-and-what-a-model-costs)), `runtime_options` (model → the load options set on its row — any of the session options audio.cpp's description of the model lists, e.g. `qwen3_tts.perf_mode` or `chatterbox.multilingual_t3`, as text; only values other than the default, set through `PUT /v1/engines/{id}/models/{model}/runtime-options` — [Engines → Options on a model's row](engines.md#what-each-engine-can-be-tuned-with)) and `terms_accepted_at` (when you accepted the engine's own terms — Pocket TTS — through `POST /v1/engines/{id}/terms`); and your external TTS providers. See [Engines](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu). |
| `generation` | Generation defaults incl. auto-chunking; `pause_between_lines_ms` — the silence between a chapter's lines in Render, export and ACX QC (600); `pause_at_scene_break_ms` — the silence after the last line of one of the book's scenes inside a chapter, used there instead (2000); `pause_within_paragraph_ms` — the silence between two lines cut from one paragraph, used there instead (250) — see [Engines → Long text](engines.md#long-text-cut-into-pieces), [Studio → Render](studio.md#render); and `default_voice_language` — the language a blend speaks when the voices it mixes disagree (`en-US`), see [Personas → New blend](personas.md#new-blend). |
| `captures` | Dictation: push-to-talk chord, refinement, the speech-recognition model (`stt_model`) and capture language — see [Dictation](dictation.md). |
| `mcp` | One field: the default voice for agent `speak` calls — see [MCP server](mcp-server.md). |
| `take_check` | How the take check judges a take read back by speech recognition: `missed_share` (the share of a line's words the read-back may miss — skipped, or heard as other words — before the take fails; 0.2), `extra_share` (the share of the line's words it may hear again past its text — a repeat, a take that runs on; 0.2) and `min_words` (the fewest missed or extra words that fail a take, so one misheard name in a short line doesn't; 2). A take longer than the speech runtime's runaway limit (`engines.speech_runtime.runaway_s_per_char` and `runaway_min_s`) fails too. Starting points, not yet measured on real books — see [Studio → Checking takes](studio.md#checking-takes). |
| `book_voices` | The one-click audiobook's voices step: `min_lines` (a speaker with at least this many lines in the book gets a voice made from the book; 3), `design_model` (`qwen3-vd`), `clone_model` (`breeze_tts` — the characters' voices; it must clone and still take direction) and `narrator_model` (`voxcpm2` — the narrator's, held to the same), the Local recipe's reading in words (`speaker_words`, `narrator_words`; 2000 each) and `audition_words` (25) — see [AI features → Voices from the book](ai-features.md#voices-from-the-book). |
| `book_run` | The one-click audiobook's run: `chars_per_token` (4) — how many characters of the book make one token in the estimate a run shows before it sends the book to a cloud model (OpenAI's rule of thumb for English; Chinese and Japanese run nearer 1). The estimate is priced from AI Settings → Pricing — see [Studio → Make the audiobook](studio.md#make-the-audiobook). |
| `app` | `primary_use_case` (the Welcome pick; re-pick here) and app-level toggles. |

Sync's settings — this computer's name, the cloud folder, how often it syncs, letting your other
computers connect, the library's key and the paired computers — aren't a section here: they keep a
row of their own, changed only through **Settings → Sync** (`PUT /v1/sync/settings`), so a save of
the sections above can never put back an older library key. See [Sync](sync.md).

## Restart-required

A few fields only take effect after a server restart — the API names them when
you change one: `server.host`, `server.port`,
`logging.level`, `logging.format` and `cors.origins`. Changing the speech runtime's backend or
GPU needs no restart: it unloads the speech models and stops the runtime, and
the next load starts the build you chose.
