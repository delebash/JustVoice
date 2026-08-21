# ROADMAP — feature horizon (JustVoice)

Created 2026-08-22 on the user's order, from the voicebox parity sweep + voicebox's
own published roadmap (`jamiepine/voicebox/docs/PROJECT_STATUS.md`, read 2026-08-22).
Charter: like IDEAS.md, **listing here is never starting** — an item moves to
`TASKS.md` only when the user schedules it with decision text. Items marked
*(from voicebox roadmap)* are candidates inherited from their direction, not
commitments.

## 1. Voicebox parity — verified state (code receipts, 2026-08-22)

We based the engine layer on voicebox's catalog; the feature surface was audited
against their current README, file-level receipts in the session record
(`docs/plans/2026-08-22-engine-environment-and-platform-research.md`).

**Have (equal or better):** post-processing effects — 11 kinds vs their 8, incl.
3-band EQ (`audio/effects.py`), 4 factory presets (Robotic/Radio/Echo Chamber/Deep
Voice, seeded) + user presets + persona→preset chain cascade with cache-keyed hash;
async generation queue with pause-at-boundary + resume (`render_jobs_api.py`);
multi-sample voice profiles (`storage/voices.py` samples/); takes with favorites AND
lineage; auto-chunk + crossfade (`render_core.py`); personas + compose +
rewrite-in-character; captures + re-transcribe + 5 Whisper sizes; paralinguistic
tags + delivery instruct; MCP (`justvoice.speak/transcribe/list_voices`); outbound
HMAC-signed webhooks (`webhooks_api.py`); per-model unload; per-generation engine
switch. Plus everything voicebox has no equivalent of: projects/chapters/casting,
LoRA training, blending, lexicons with IPA-to-audio, ACX mastering, word-level
captions, voice bundles.

**Gaps (ours, honest):**
- **Global dictation hotkey + paste injection — STUBBED** (`src-tauri/src/lib.rs:19-20`
  "full impl deferred"). Voicebox's whole dictation pillar (push-to-talk, chord
  bindings, target-aware paste). Biggest true gap.
- **Promote capture → voice sample**: no one-click path (manual download→Clone works).
- **Stories multi-track timeline**: `StoriesView.vue` exists; their drag-drop
  timeline + inline trimming ≈ the timeline design parked in IDEAS (2026-08-15).
- Unverified minor: their MCP per-client voice binding; LLM transcript refinement.

## 2. Candidates from voicebox's roadmap (checked against our code 2026-08-22)

| Feature (their wording) | Do we have it? | Verdict for us |
|---|---|---|
| Windows / Linux auto-paste (SendInput / uinput / AT-SPI) | No — our whole dictation hotkey/paste layer is stubbed | Candidate; belongs WITH the hotkey gap above as one dictation epic |
| STT engine expansion (Parakeet v3, Qwen3-ASR beside Whisper) | No — Whisper only | Candidate; faster-whisper also worth evaluating in the same pass (no ffmpeg, ROCm wheels Win+Linux; Apple GPU gap) — session research 2026-08-22 |
| Pipeline routing (source → transform → sink chains, preset editor) | Partial — outbound webhooks exist (`webhooks_api.py`); no chain/editor concept | Candidate, low priority |
| Streaming transcription (WebSocket `/transcribe/stream`) | No | Candidate; pairs with dictation epic |
| End-to-end speech LLMs (Moshi, GLM-4-Voice, Qwen2.5 Omni) | No | Watch-list only — engine-roster decision, not a feature toggle |
| **Voice Design (voices from text descriptions)** | **HAVE** — Qwen3-TTS VoiceDesign (`generate_voice_design`, 1.7B) + Dataset Builder rides it | none needed |
| Long-form capture (dual-stream mic + system audio + summary LLM) | No — captures are mic-only; system-audio capture is a named audience feature (CLAUDE.md) not yet built | Candidate |
| Platform sinks (Apple Notes, Obsidian, opt-in) | No | Candidate, low priority |
| Plugin architecture (custom models/transforms/sinks) | Partial by construction — engines are already manifest+engine.py plugins; no third-party story | Watch-list |
| Mobile companion | No | Watch-list |

## 2b. Resilience items (ours, from the 2026-08-22 env research)

- **Vendor LuxTTS's wheels** — it holds the CPU-cloning roster slot while living in
  one person's git repo (`ysharma3501/LuxTTS` + `LinaCodec`; upstream ZipVoice has
  zero releases). SHA pins do not survive a deleted repo. Build the two wheels once
  and host them with our release assets (needs a hosting decision). Same class:
  mirror `piper-phonemize` from the k2-fsa index.
- **AMD-on-Windows auto-detect** — deferred from the 2026-08-22 migration (override
  recipe only; no AMD hardware here to verify detection or AMD's SDK-package flow).

## 3. Not on any list on purpose

Pocket TTS (rejected 2026-08-22 — HF-auth-gated cloning weights), Supertonic 3
(no cloning in the OSS release; would also cost Kokoro's blending + IPA if swapped
into the preset slot; weights OpenRAIL-M), TADA/MOSS un-marking (no word).
