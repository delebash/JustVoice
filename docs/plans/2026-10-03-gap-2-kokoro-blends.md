# Gap 2 — Kokoro blends: a voice-pack input in our audio.cpp, blends read from the GGUF

## 1. What this is

Gap 2 of the audio.cpp switch (switch plan §5: "Kokoro blends — fork: a voice-vector input"),
under "you have a go for all gaps" (2026-10-02) and the order in TASKS. A blended voice — a
mix, an extrapolation, an analogy (A + B − C) or a recombination of Kokoro voices, the four
strategies the Voices page's Blend tab already offers — renders again. Both halves have been
broken since the 2026-10-01 switch:

- **Making a blend**: `engines/blending.py` reads the Kokoro voices from a `voices*.bin`/`.npz`
  file in the speech cache; audio.cpp's Kokoro is one GGUF, so the lookup answers "kokoro is not
  installed".
- **Hearing a blend**: the slot refuses `voice_vector` (422, "Blended voices are not available
  yet…"), because audio.cpp's Kokoro takes a preset voice name only.

## 2. Facts (2026-10-03)

- **The voices are embedded files in the GGUF** (`audiocpp.embedded_files.names/offsets/data`,
  59 files, 38.5 MB in `kokoro-82m-q8_0.gguf`): `voices.json` (`{"af_heart": {"rows": 510,
  "cols": 256, "path": "af_heart.bin"}, …}`) and `voices/<id>.bin`, raw little-endian float32,
  510 × 256 (522,240 bytes each).
- **audio.cpp's Kokoro** (`src/models/kokoro_tts`): `resolve_kokoro_frontend_session_state`
  picks `assets.voices[voice_id]` as the pack; `style_for_phoneme_count` takes row
  `phoneme_count − 1` of 256 values; the voice id also fixes the language (its first letter) and
  enters the synthesis cache key. Request options are validated against the package's embedded
  contract — newer options (`phonemes`, `speed`, `return_timestamps`) are dropped from the
  validation copy when an older contract lacks them; a new option follows that pattern.
- **The app's blend math is intact** (`blending.py`: blend, extrapolate via the pack mean,
  vector, recombine) and works on `(510, 1, 256)` arrays; a blended voice stores its whole pack
  as `embedding` (130,560 floats) and renders with `voice_vector` (`render_core.voice_synth_fields`).

## 3. The plan

1. **Our audio.cpp** — a Kokoro request option `voice_pack`: a path to a raw float32 file of
   rows × 256 (the format of the GGUF's own voice files). The session loads it (cached by path,
   size and modification time), uses it as the style pack, keeps the request's voice id for the
   language and G2P, and tags the cache key with the pack. Drop `voice_pack` from the validation
   copy for contracts that predate it. Notice line on the changed files. Ships in
   **v0.9.0-jv.2** (jv.1 is the two fixes, decided 2026-10-03).
2. **The app reads voices from the GGUF** — a small reader for a GGUF's embedded files
   (`engines/audiocpp/gguf_files.py`); `blending._kokoro_pack` builds its name → (510, 1, 256)
   pack from `voices.json` + `voices/*.bin` of the installed Kokoro variant.
3. **The slot sends a blend** — `voice_vector` → the pack written once to
   `<data>/cache/kokoro-voice-packs/<sha1>.bin`, `options.voice_pack` = its path, `voice` = a
   preset of the blend's language (for the G2P). On a runtime older than v0.9.0-jv.2 it refuses
   by name: "Blended voices need the speech runtime update — Update it on AI Settings → Speech
   engines."
4. **Capability** — Kokoro `supports_voice_blending=True` and the manifest's `voice_blending`.
5. **Docs** — voices.md's Blend section and table (the "not available yet" notes go), engines.md
   "Not available yet", whats-new; code-map.
6. **Tests** — the GGUF reader on a hand-built GGUF; blending from it; the slot's request and its
   refusal on an older runtime; the C++ change checked through our server build (a blend of two
   voices sounds between them; the same pack reproduces; an older contract accepts the option).

## 5. Build record (2026-10-03)

- **audio.cpp `86767dad`** (on `jv`, after the v0.9.0-jv.1 commits): `frontend.h/.cpp`
  `resolve_kokoro_frontend_session_state(…, voice_pack_override)` — the override becomes the
  pack, the voice id keeps the language and gains `#<pack id>` for the cache key; `session.cpp`
  `kVoicePackOption = "voice_pack"`, `voice_pack_for_request` (raw float32 rows × 256, kept per
  path:size:mtime, a wrong size refused by name), dropped from the validation copy for older
  contracts; notice lines on all four files. **Checked through our CPU server build**, seed 7:
  af_heart's own pack as a file = af_heart byte for byte (sha 152a5a6b02); am_adam's pack under
  the af_heart id = am_adam byte for byte (sha 0c9739f0e0); a 50/50 blend is new audio of a
  length between them (129,644 vs 123,644 / 134,444 bytes) and Qwen3-ASR reads it back word for
  word; a 1,000-byte file → "Kokoro voice_pack must be rows x 256 float32 values".
- **App** (uncommitted): `engines/audiocpp/gguf_files.py` (embedded files of a GGUF, metadata
  only); `blending._kokoro_gguf` / `_kokoro_pack` read `voices.json` + `voices/*.bin` from the
  installed Kokoro GGUF (54 voices, (510, 1, 256), ~1 s once, then cached per file version —
  blend, mean and recombine verified on the real model, 130,560 floats each); `slot.write_voice_pack`
  (`<data>/cache/kokoro-voice-packs/<sha1>.bin`, written once); the Kokoro mapping sends
  `options.voice_pack` and a preset of the blend's language (en-US → af_alloy, en-GB →
  bf_alice, zh → zf_xiaobei, fr → ff_siwis, hi → hf_alpha); `_synth` refuses on a runtime
  without the feature (409, the plan's words) and on a non-Kokoro engine (422).
  `release.BUILDS_IN_ORDER` / `FEATURES` / `pinned_has`, `runtime.has_feature`. **The
  capability (`supports_voice_blending`, the manifest's `voice_blending`) follows the PIN** —
  `pinned_has("voice_pack")`, False until the pin reaches v0.9.0-jv.2 — so no one is offered a
  blend that cannot play. Tests: `tests/test_kokoro_blends.py` (8: the GGUF reader on a
  hand-built GGUF, blends from it, the feature order, the mapping, the pack file, both
  refusals); the older blend tests (`test_c_features.py`) pass unchanged.
- **Docs wait for the pin**: voices.md's Blend section and engines.md's "Not available yet" line
  change in the commit that moves the pin to v0.9.0-jv.2, when blends become visible.

## 4. Blast radius (greps 2026-10-03)

| Change | What it touches | Grep |
|---|---|---|
| `_kokoro_pack` reads the GGUF | every blend strategy, the pre-save audition, the save | `voice_preview_api.py:158/176 blending.recombine( / blending.blend(` · `:504/514` · `voices_api.py:415/422` · `blending.py:157 _kokoro_pack_mean` · `:179 _kokoro_pack` |
| `voice_vector` → `voice_pack` | the slot's refusal goes; render and preview send the vector | `slot.py:289 if body.get("voice_vector")` · `render_core.py:263 out["voice_vector"] = list(stored.embedding)` · `voice_preview_api.py:301 extra["voice_vector"] = vector` |
| Capability on | the Blend tab's engine list, the engine row's chips | `capability_details.py:94 supports_voice_blending=False` · `kokoro/manifest.py:39 "voice_blending": False` · `VoicesView.vue:585 blending: "supports_voice_blending"` · `engines_api.py:57` |
| Docs | the user-facing blend pages | `voices.md:28/31/51/173-182` · `engines.md:350` |
