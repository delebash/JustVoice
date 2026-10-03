# Gap 9 — 16-bit model rows, the 8-bit vs 16-bit test, and VoxCPM2

## 1. What this is

Gap 9 of the audio.cpp switch ([switch plan §5](2026-10-01-audiocpp-switch.md)): "16-bit model
rows; new engines from the catalogue (VoxCPM2 first)", plus fixes 3 and 4 of the 2026-10-02
list (TASKS, "all 4 , fork repo, public, your rec on all go"): Pocket's dropped words in
Portuguese and Spanish rerun at 16-bit, and the long-passage 8-bit vs 16-bit comparison. Go:
"you have a go for all gaps". This doc is the research and the plan as presented.

Three things for the user:
- **A choice of precision per model.** Every model keeps its 8-bit file as the default and gains
  a 16-bit row beside it — more download and memory, for whoever wants the original precision.
- **An answer to "is 8-bit worse?"** — measured on a real chapter, not two lines.
- **VoxCPM2** — a new engine that clones and designs voices in one model, 30 languages.

## 2. Facts (2026-10-02)

16-bit files at our pinned commit of `audio-cpp/audio.cpp-gguf` (`7bf52723…`), from the HF tree:

| Model | 8-bit (shipped) | 16-bit |
|---|---|---|
| Kokoro 82M | 189.5 MB | bf16 212.0 MB |
| KittenTTS Mini 0.8 | — (ships unquantized, 302.2 MB) | — |
| Pocket TTS, English (each language its own file) | 127.9 MB | bf16 219.1 MB |
| Qwen3 CustomVoice 1.7B | 2,817 MB | bf16 4,179 MB |
| Qwen3 Base 1.7B | 2,695 MB | bf16 4,203 MB |
| Qwen3 Base 0.6B | 1,991 MB | bf16 2,516 MB |
| Qwen3 VoiceDesign 1.7B | 2,817 MB | bf16 4,179 MB |
| Qwen3 CustomVoice 0.6B (ours) | 1,710 MB | bf16 2,157 MB — converted, not yet published |
| Chatterbox Multilingual | 2,088 MB | f16 3,744 MB |
| Qwen3-ASR 1.7B | 2,473 MB | f16 4,088 MB |
| **VoxCPM2** | 2,955 MB | bf16 4,772 MB |

audio.cpp's test table rates every one of our families' Q8 as passing; Pocket's Q8 "with drift"
where its 16-bit has none (see the reply recorded 2026-10-02 and `gguf.md`). Our own 0.6B
CustomVoice A/B: directed renders clean q8 12/13, bf16 13/13 (gap 4 plan §5).

**VoxCPM2** ([engine scan](2026-10-01-tts-engine-scan.md) line 367, re-checked): OpenBMB, 2B,
Apache-2.0, upstream repo not gated. audio.cpp `voxcpm2` spec v0.9.0: status `supported`, tasks
`tts` · `clone` · `design`, modes offline + streaming, 31 language entries (30 + Chinese
dialects), capabilities clone (`speaker_reference`) and design (`voice_design`). The scan: 48 kHz
output, "timbre drifts in long single passes" (upstream issue #302). audio.cpp has no VoxCPM2
doc page at v0.9.0, so its request options are found by trial runs in the build.

## 3. The plan

**A. 16-bit rows.** One more variant per model, `…-bf16` / `…-f16`, beside the 8-bit row, same
repo and commit, same capability row (the suffix walk already reaches it). The 8-bit stays the
default everywhere. Our 0.6B CustomVoice bf16 goes up to our Hugging Face repo as a second file.
KittenTTS has nothing to add.

**B. The comparison (fixes 3 and 4).** One real chapter from the real data dir (a few minutes
of narration), rendered per engine at 8-bit and 16-bit with the same seeds; each render read
back by Qwen3-ASR and scored for words wrong, silences longer than 1.5 s, and length against
the other precision. Pocket TTS Portuguese and Spanish rerun at 16-bit on the lines that
dropped words. Results recorded here, per engine.

**C. VoxCPM2.** A new engine `voxcpm2`: manifest (q8 default + bf16 row), a capability row
(cloning with a clip and its transcript; designing a voice from words), the slot's request
mapping for its family, `NOTICE.md` credit, docs (engines catalog, tuning tables, whats-new),
tests (catalog, mapping, knob wiring), and a live run on the real data dir with memory and
speed measured. Not added to the Voice engine setup tiers until it is measured.

**D. Gates + live**, as for gaps 8 and 4.

## 4. Blast radius (greps 2026-10-02)

| Change | What it touches | Grep |
|---|---|---|
| New variant rows | the catalog every screen reads; test id sets; placement and memory rows keyed by variant | `test_variant_wiring.py:36 ids == {"qwen3-cv-1.7b-q8", …}` · `test_cpu_placement.py:86 placement_for(…, "kokoro-82m-q8")` · `test_audiocpp_switch.py:73 _row("kokoro", "kokoro-82m-q8")` |
| Defaults (unchanged) | each engine's `DEFAULT_VARIANT_ID` stays 8-bit | `kokoro/manifest.py:71 "kokoro-82m-q8"` · `qwen3/manifest.py:103 "qwen3-cv-1.7b-q8"` · `chatterbox/manifest.py:65` · `pocket/manifest.py:146` · `asr/manifest.py:70` |
| Repo assertions | the gap-4 widening covers our bf16 file too | `test_variant_wiring.py` "audio.cpp's own repo, or our conversion" · `test_audiocpp_switch.py:26` |
| New engine | engine lists in tests; the slot's family dispatch; Voice engine setup's tier lists | `test_audiocpp_switch.py:26 parametrize("engine", ["kokoro", "qwen3", "chatterbox", "asr"])` · `test_variant_wiring.py:94` · `test_emotion_wiring.py:134` · `slot.py:418/432/463/471/488 if family == "…"` · `QuickSetup.vue:64 ttsEngineIds: ["kokoro", "kitten", "pocket"]` |
| Licences | a new Apache-2.0 model credit | `NOTICE.md`, `LICENSES.md`, `LICENSES/Apache-2.0.txt` |

## 5. Open — asked with recommendations

1. **Which models get a 16-bit row?** Rec: all of them in §2's table (KittenTTS has none).
2. **Defaults after the comparison?** Rec: they stay 8-bit unless the comparison shows a real gap
   on an engine; any change comes back to you with its numbers.
3. **VoxCPM2's row text.** Rec: name "VoxCPM2"; description "OpenBMB's 2B model, 30 languages:
   clones a voice from a short clip and its transcript, or designs one from a written
   description. Runs in the audio.cpp speech runtime." (48 kHz is added only if the live run
   shows it.)
