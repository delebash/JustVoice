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
| `cors` | Allowed origins when serving browsers beyond localhost. Never `*` — the server refuses it: any web page you opened could then read this server. |
| `auth` | Bearer tokens; auth is off while the list is empty. Loopback exempt unless required. Even when required, three things still answer from this machine without a token: the health check, the token settings themselves (so you can't lock yourself out), and the desktop app's shutdown when you close its window. |
| `mastering` | The default loudness target per preset (ACX / iAudio / Podcast / YouTube) — see [Mastering](mastering.md). |
| `models` | Model source URL overrides per engine/variant, for mirrors or pinned downloads. |
| `engines` | The default speech engine (`default_tts_engine`); per engine (`engine_overrides`), its default model (`default_variant` — **Set as default** on a model's row), `split_chars` (model → the longest piece a line reaches it in, in characters; a model not listed uses its catalog length, [Engines → Long lines](engines.md#long-lines-and-what-a-model-costs)), `runtime_options` (model → the load options set on its row — any of the session options audio.cpp's description of the model lists, e.g. `qwen3_tts.perf_mode` or `chatterbox.multilingual_t3`, as text; only values other than the default, set through `PUT /v1/engines/{id}/models/{model}/runtime-options` — [Engines → Options on a model's row](engines.md#what-each-engine-can-be-tuned-with)) and `terms_accepted_at` (when you accepted the engine's licence or its own terms — Pocket TTS's — through `POST /v1/engines/{id}/terms`); and your external TTS providers (`external`, saved through `POST /v1/engines/external` and removed through `DELETE /v1/engines/external/{id}`, which put the change to work at once). The speech runtime's own settings — its build, card, threads, CPU bar, spill limit, runaway limits, card headroom and timeouts — and where each model runs are not in this section: they are the shared AI engine's settings, on **Engine settings** and each model's **Auto · Graphics card · CPU** on AI Settings → Speech (`PUT /v1/ai/runtimes/audiocpp/settings`, `PUT /v1/ai/runtimes/audiocpp/models/{model}/placement`) — see [Engines → The speech runtime](engines.md#the-speech-runtime). |
| `generation` | Generation defaults incl. auto-chunking; `pause_between_lines_ms` — the silence between a chapter's lines in Render, export and ACX QC (600); `pause_at_scene_break_ms` — the silence after the last line of one of the book's scenes inside a chapter, used there instead (2000); `pause_within_paragraph_ms` — the silence between two lines cut from one paragraph, used there instead (250); `whisper_gap_db` — how far under the chapter's narration a whispered line is set when the chapter is joined, in dB RMS (−18; `null` leaves whispers as rendered) — see [Engines → Long text](engines.md#long-text-cut-into-pieces), [Studio → Render](studio.md#render); and `default_voice_language` — the language a blend speaks when the voices it mixes disagree (`en-US`), see [Personas → New blend](personas.md#new-blend). |
| `captures` | Dictation: push-to-talk chord, refinement and capture language — see [Dictation](dictation.md). Which model transcribes is the **Transcription** feature's, on AI Settings → Routing by feature ([AI features → Transcription](ai-features.md#transcription)). |
| `mcp` | One field: the default voice for agent `speak` calls — see [MCP server](mcp-server.md). |
| `take_check` | How the take check judges a take read back by speech recognition: `missed_share` (the share of a line's words the read-back may miss — skipped, or heard as other words — before the take fails; 0.2), `extra_share` (the share of the line's words it may hear again past its text — a repeat, a take that runs on; 0.2) and `min_words` (the fewest missed or extra words that fail a take, so one misheard name in a short line doesn't; 2). A take longer than the speech runtime's runaway limit (**A runaway line: seconds per character** and **A runaway line: at least (seconds)** under Engine settings on AI Settings → Speech) fails too. Starting points, not yet measured on real books — see [Studio → Checking takes](studio.md#checking-takes). |
| `book_voices` | The one-click audiobook's voices step: `min_lines` (a speaker with at least this many lines in the book gets a voice made from the book; 3), `design_model` (`qwen3-vd`), `clone_model` (`breeze_tts` — the characters' voices; it must clone and still take direction) and `narrator_model` (`breeze_tts` — the narrator's, held to the same), the Local recipe's reading in words (`speaker_words`, `narrator_words`; 2000 each) and `audition_words` (25) — see [AI features → Voices from the book](ai-features.md#voices-from-the-book). |
| `book_run` | The one-click audiobook's run: `chars_per_token` (4) — how many characters of the book make one token in the estimate a run shows before it sends the book to a cloud model (OpenAI's rule of thumb for English; Chinese and Japanese run nearer 1). The estimate is priced from AI Settings → Pricing — see [Studio → Make the audiobook](studio.md#make-the-audiobook). |
| `app` | `primary_use_case` (the Welcome pick; re-pick here) and app-level toggles. |

Sync's settings — this computer's name, the cloud folder, how often it syncs, letting your other
computers connect, the library's key and the paired computers — aren't a section here: they keep a
row of their own, changed only through **Settings → Sync** (`PUT /v1/sync/settings`), so a save of
the sections above can never put back an older library key. See [Sync](sync.md).

## Restart-required

A few fields only take effect after a server restart — the API names them when
you change one: `server.host`, `server.port`,
`logging.level`, `logging.format` and `cors.origins`. Changing the speech runtime's build or
graphics card needs no restart: the next load starts the speech process on the
build you chose ([GPU → Which build the runtime uses](gpu.md#which-build-the-runtime-uses)).
