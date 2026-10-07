<!-- SPDX-License-Identifier: MIT -->
# 2026-10-07 · Character voice controls — formants, texture, creature sounds

The user, 2026-10-07: *"what type of controls do you think we can add besides things like pitch
for adjusting our characters voices, like Formant & Timbre Morphing, what other controls our
features can we add to give more feature rich voice creation for our characters including
monstor noises and so on"* — then, after the answer in §1: *"record this, also we will be
removing pyton nad going to electron and node eventually, but these types of features i want
to add"*.

**State: wanted, not scheduled.** Nothing is decided and nothing is built. IDEAS carries the
entry (2026-10-07); the facts are in RESEARCH §8. §2 says what the Electron/Node move changes
in the answer's "how" column; §3 and §4 are the surveys the user asked for the same day (C++
and Node libraries with their platforms, then local AI); §5 lists the sources, §6 what is
open.

## 1 · The answer, as presented 2026-10-07

Verbatim; its headings are one level down here.

Today a character's voice can change in **pitch, pace and gain**, plus a 10-effect chain. Three things are missing: **formants** (body size, separate from pitch), **texture** (growl, breath, rasp, layered voices) and **non-speech creature sounds**. None of the models we run can make a roar.

**What exists now** (checked in the code)
- The persona's effects chain: pitch ±12 semitones, high-pass, low-pass, reverb, delay, chorus, compressor, gain, distortion and a 3-band EQ. There are four presets: Radio, Robotic, Echo Chamber and Deep Voice (`docs/effects.md`).
- The pitch control moves the formants too. At ±12 semitones the voice sounds like a smaller or bigger person, not a deeper voice (`docs/dev/RESEARCH.md:611-619`).
- From the models:
  - Kokoro blends: a mix, or timbre from one voice and prosody from another.
  - Voices designed from a description (Qwen3 VoiceDesign, VoxCPM2).
  - Chatterbox's Exaggeration control.
  - Chatterbox Turbo's 19 tags. Its sound tags are all human: cough, laugh, chuckle, sigh, gasp, groan, sniff, clear throat, shush (`server/justvoice/engines/capability_details.py:328-338`).

### 1 · Body: formant controls (the biggest win)

| Control | What it gives a character | How |
|---|---|---|
| **Size** (formant shift) | Giant, troll, goblin, imp, child. The body changes, the note doesn't. | Signalsmith Stretch, which already does our pitch, has `setFormantSemitones` and `setFormantFactor` in v1.3.2. Our Python binding, python-stretch 0.3.1, doesn't expose them, and it is still the latest release (Feb 2025). We'd need a small binding of our own. |
| **Pitch that keeps the voice** | Today's pitch slider without the chipmunk or slowed-tape sound | The `compensatePitch` flag on those same calls |
| **Warp** | Alien, metallic, inharmonic | Signalsmith's `setFreqMap`, in the same binding |
| **Brightness** | Dark and menacing ↔ bright and young | One control that moves the EQ shelves we already have |
| **Mask / helmet** | Knight in a helm, gas mask, robot shell | A 2–5 ms delay with feedback (a comb filter). Our delay code already accepts it, but the editor's slider moves in 0.05 s steps (`server/justvoice/api/effect_presets_api.py:105`), so today only a preset could set it. |

Signalsmith's own warning: its formant correction "is not as sharp as monophonic algorithms (such as PSOLA)". It also needs a rough pitch estimate, though `setFormantBase(0)` detects one itself.

### 2 · Texture: what the voice is made of
All of these are plain numpy and fit the current effect rules.

| Control | Gives |
|---|---|
| Growl / rasp: slow amplitude or ring modulation (tens of Hz) plus drive | Orc, beast, demon, heavy smoker |
| Ring modulator | Robot, Dalek, alien |
| Breath / whisper amount: noise shaped like the voice, mixed in; all the way gives a whisper | Ghost, conspirator, someone dying |
| Vibrato / tremolo | Old age, cold, terror, spectres |
| Layers: copies an octave down, an octave up, or slightly detuned | Demon (octave under), god-voice, Legion or a hive mind |
| Bitcrush / sample-rate drop | Broken android, retro robot |
| Vocoder | The classic one-note robot |
| **Talking beast** (cross-synthesis): the shape of the words stamped onto another sound | A roar, fire, wind, swarm or machine that speaks |

### 3 · Performance: needs a pitch track

| Control | Gives |
|---|---|
| Intonation range, from flat to exaggerated | Zombie or robot monotone ↔ cartoon |
| Jitter / shimmer (uneven pitch and level) | Age, sickness, undead, fear |
| Vocal fry | Creak, menace, exhaustion |
| Pitch lock, or snap to a scale | A robot on one note, a sing-song fairy |

- **Tool:** the WORLD vocoder (modified-BSD licence; its Python wrapper pyworld is MIT). It splits the voice into pitch, spectral envelope and noise, lets us edit each, and rebuilds it.
- **Cost:** the rebuilt voice sounds slightly buzzy. That's fine for creatures and wrong for a clean narrator.
- **Packaging:** Windows wheels for our Python 3.12 exist only on pyworld 0.3.5, not on 0.3.6.
- **Alternative:** our audio.cpp copy already has its own pitch tracker (RMVPE, inside RVC and Seed-VC).

### 4 · Timbre transfer and morphing: models already in our pinned audio.cpp build
Their model specs ship in `v0.9.0-jv.4`. Each would still need a catalog entry and a request path on our server. Licences are from audio.cpp's own table, checked 2026-09-21 to 09-27.

| Model | What it does | Licence |
|---|---|---|
| Chatterbox VC | Converts any rendered line to the timbre of a reference clip | MIT |
| OpenVoice V2 tone colour (`tone_color_vc`) | The same; outputs 22.05 kHz | MIT |
| MeanVC2 | Zero-shot voice conversion | Apache-2.0 |
| MioCodec | Voice conversion | MIT |
| RVC | Users' own `.pth` character voices; semitone shift, a pitch-curve file, retrieval blend | Base models MIT; its bundled voices have no stated licence |
| Seed-VC | Voice conversion and singing | GPL-3.0 weights |
| VeVo2 | Voice conversion and editing | Non-commercial, so out |

What this unlocks:
- Render with the best speaking model, then convert the line to the character's timbre.
- A person records a growl or snarl, and it gets converted into the persona's voice.
- A true morph slider between two voices, for models other than Kokoro, means blending the converter's speaker embedding. That's work in our audio.cpp copy, and I haven't checked its code for it.

Also in the build: **Maya1** (Apache-2.0, English only, no cloning).
- It designs a voice from a description.
- It takes inline tags: `<laugh> <sigh> <whisper> <angry> <giggle> <chuckle> <gasp> <cry>`, plus "12+ more" its model card doesn't name.
- The card's own examples include *"Demon character … screaming tone at high intensity"* and *"Dark villain … low pitch, gravelly timbre"*.

### 5 · Monster noises: roars, snarls, hisses
- **Generated:** Stable Audio 3 Small SFX (`stable_audio`, 0.6B parameters) turns text into a sound effect, e.g. *"dragon's low wet growl, close"*. Its licence is the decision:
  - Free while yearly revenue stays under USD 1M.
  - Commercial use must be registered with Stability AI.
  - The app must show "Powered by Stability AI".
  - Its text encoder falls under the Gemma terms.
- **ControlFoley** is in the build too, but it's non-commercial (CC-BY-NC-4.0).
- **Sound bank:** the user's own roars, attached to a persona and placed in the script with a tag like `[roar]`. No model and no licence question; best for game work.
- **Voice to beast:** the TTS says *"Hrrraaagh!"* and a creature effect chain turns it into a roar. Free, but quality varies.
- **Talking beast:** the cross-synthesis from §2, with a generated or sound-bank roar as the sound that speaks.

### 6 · Making it usable
- **Character sliders:** Size, Age, Gruff, Breath, Menace, Distance. Each one moves several effects underneath; the persona still stores a plain chain.
- **Creature presets** built from those sliders. These are starting recipes and untested:

| Preset | Recipe |
|---|---|
| Giant | size −5, pitch −3, pace 0.9×, hall reverb |
| Goblin | size +4, pitch +3, nasal EQ, light rasp |
| Dragon | size −6, pitch −5, octave-under layer, growl, distortion, cave reverb |
| Demon | three layers (−12 / 0 / +7 semitones), distortion, darker tone, plate reverb |
| Ghost | 60% whisper, slow vibrato, reverse reverb swell, low-pass |
| Robot | pitch lock or ring modulator, bitcrush, comb filter |

- **Variants:** a "make 8 siblings" button that varies size, pitch, pace and brightness a little each time. One persona becomes a squad of guards, which suits game projects with hundreds of lines.
- **Per-line intensity:** a line can already override speed, pitch, gain, pause and the model's controls, but not effects; the chain lives only on the persona (`docs/effects.md:38`). A "rage" line that pushes the character sliders further would need a line override for them.
- **Space** (distance, behind a door, phone, megaphone, underwater, cave) is mostly a scene's job. `effects.md` says per-chapter sound returns with Studio's scene layer.

### Limits any of this must respect (from the code)
- Every effect must return audio exactly as long as its input (`server/justvoice/audio/dsp/__init__.py:14`). A reverse reverb swell only fits where the line has silence before it.
- The effects code exists to keep GPL libraries out of the app, so it uses only numpy, scipy and MIT code.
- Changing what an existing effect outputs needs a `DSP_VERSION` bump. Adding a new effect type leaves existing chains alone.

### My recommended order
1. **Formants:** a Size control and a pitch that keeps the voice. It's one small native binding, and it also fixes the pitch slider we already have.
2. **The numpy texture set:** growl, ring modulator, breath, vibrato/tremolo, bitcrush, comb filter, layers.
3. **Character sliders and creature presets** on top. This is UI only.
4. **Monster sounds:** a sound bank first, since it has no licence question; Stable Audio SFX if you accept its licence.
5. **Voice conversion** (Chatterbox VC or OpenVoice tone colour): the deepest timbre control and the biggest build.
6. **WORLD-based performance controls** last.

Not recorded yet: the facts I checked on the web aren't in `docs/dev/RESEARCH.md`. They cover Signalsmith's formant calls, python-stretch 0.3.1 still being the latest release, pyworld's wheels and Maya1's tags. The register's pitch entry still says formant support is "not checked".

*(Recorded the same day: RESEARCH §8, and RESEARCH §3's pitch entry now points there.)*

## 2 · What the Electron/Node move changes

The user, with the record ask: *"we will be removing pyton nad going to electron and node
eventually, but these types of features i want to add"*. The move is TASKS "The family moves
to Electron and a Node server; Tauri and Python go", studied in
[`2026-10-05-electron-node-study.md`](2026-10-05-electron-node-study.md). What is already
decided there, and touches §1:

- **The DSP goes into our audio.cpp fork** — study §9, Q1's five conditions, quoted from it:
  "Keep the DSP in its own module in the fork, with its own files and endpoints, apart from the
  model code" · "The endpoints must work with no model loaded" · "The server does no sample math
  at all. It passes audio and parameters to audio.cpp" · "Mastering stays ffmpeg" · "Python stays
  the reference until the C++ is proven".
- **Signalsmith moves with it** — study §2.2 option (c), settled by the rulings: the library is
  header-only MIT C++, so it compiles natively in the fork with a fixed seed.

What that means for §1, read off those rulings (nothing here is a new decision):

- The routes §1 names in Python — a python-stretch binding for formants and `setFreqMap`,
  pyworld for the pitch-track controls, "plain numpy" for the texture set — describe today's
  server only. After the move they would be C++ in the fork's DSP module.
- Signalsmith's formant calls and `setFreqMap` are part of its C++ API (§5), so there they need
  no binding.
- The voice-conversion, Maya1 and Stable Audio models are already audio.cpp families. The move
  doesn't change them; only the server's request path to them changes.
- Whether Signalsmith's official WASM or npm `signalsmith-stretch` (study §2.1) exposes the
  formant calls: not checked.

## 3 · C++ and Node libraries — surveyed 2026-10-07

The user, while this was being recorded: *"if there is a good high performance c++ cross
platfrom audio post processing that cand do all we need or some of what we need and we can add
to that it would be greate , could be in node as well but i want fast and quality, can you
lookk and see if there are any well maintianed or starred github projects or npm models that
would meet our needs as we are ultimatley dropping python"* — and *"if we have to roll our own
we can but i would prefer to use something that already exists and does a good job if
possible"*.

What counted: a licence of MIT, BSD or Apache (the DSP package exists to keep GPL out, and the
study already rejected rubberband-wasm, soundtouchjs and the MPL worklet); recent commits; C++
first, because the 2026-10-05 ruling puts the DSP in the fork. Stars (★), licences and dates
are from the GitHub API and the npm registry on 2026-10-07.

**No single library does all of it.** The closest fit is four existing libraries, with our own
code only for the glue:

| Library | ★ | Licence | Last commit | What it gives us |
|---|---:|---|---|---|
| **Signalsmith Stretch** | 563 | MIT | 2026-09-25 | Pitch, time, **formants** (`setFormantSemitones`, `compensatePitch`), frequency warp (`setFreqMap`). Header-only C++11. Already our pitch and speed engine. |
| **Signalsmith DSP** | 277 | MIT | 2026-08-23 | Filters, delay, envelopes, FFT, spectral/STFT, windows, mix, rates. Header-only C++11, same author. The toolkit for what we write ourselves: comb filter, breath noise, layers, the talking-beast vocoder. |
| **Airwindows Consolidated** (`baconpaul/airwin2rack`) | 722 (Airwindows itself 1,246) | MIT for `src`, `libs/airwindows`, `res/awdoc` | 2026-10-04 | 530 effect headers behind one static library (`airwin-registry`; effects made by name through `AirwinRegistry.h`), among them RingModulator, Vibrato, Tremolo, TremoSquare, DeRez–DeRez5 (bitcrush), Distortion, Drive, GrindAmp, PitchNasty, PitchDelay, VoiceOfTheStarship, VoiceTrick, Chorus, Ensemble, DubSub, reverbs (Galactic, Verbity, MatrixVerb, kChamberAR, …) and tape. Its DAW and Rack plugin targets bring in GPL (JUCE, the Rack SDK); the library target doesn't. |
| **WORLD** | 1,348 | modified-BSD | 2025-02-21 (release v1.0.1, 2026-02-18) | Speech analysis and resynthesis — F0, spectral envelope, aperiodicity: the pitch-track controls, whisper conversion, formant warping. C++. |

Alternatives, where a row above falls short:

| Library | ★ | Licence | Last commit | Use |
|---|---:|---|---|---|
| SPTK 4 | 249 | Apache-2.0 | 2026-10-06 (v4.4, 2025-12-24) | Speech toolkit as a C++11 library and CLI: pitch (RAPT, SWIPE', REAPER bundled), mel-cepstral analysis, MLSA/MGLSA filters, LPC, WORLD's aperiodicity. A second route to pitch tracking and cross-synthesis. |
| DaisySP | 1,248 | MIT (its LGPL parts live in DaisySP-LGPL — avoid) | 2026-09-28 | Small modular effects: autowah, chorus, decimator, flanger, overdrive, phaser, pitchshifter, sample-rate reducer, tremolo, wavefolder. CMake build. |
| Q (cycfi) | 1,431 | MIT | 2026-10-07 | Header-only C++20: a BACF pitch detector ("Sub-Cent Accuracy"), filters, envelope followers, compressor/expander/AGC. A fast pitch tracker if WORLD's is too slow. |
| stftPitchShift | 195 | MIT | 2025-09 (v2.0, 2023-12-12) | STFT pitch and timbre shifting with cepstral formant preservation. Its README: the formant preservation "doesn't seem to work well along with the poly pitch shifting and smaller pitch shifting factors". |
| r8brain-free-src | 744 | MIT | 2026-09-30 | Header-only resampler, for when the fork takes over resampling (libsamplerate, 746★, BSD-2, is the other). |
| CloudSeedCore | 79 | MIT | 2024-09 | Cloud Seed's reverb core — richer than Freeverb. |

Node, if any DSP stays in JavaScript:

| Package | Version · downloads/week | Licence | Notes |
|---|---|---|---|
| node-web-audio-api | 2.2.0 · 74,297 | BSD-3-Clause | The Web Audio API on a Rust core; prebuilt for Windows x64/arm64, macOS x64/arm64, Linux x64/arm/arm64. Standard nodes only — no pitch or formants. Its README: `getChannelData` "not reliable in some situations". OfflineAudioContext: not checked. |
| signalsmith-stretch | 1.3.2 · 43,861 | MIT | The official WASM (study §2.1); formant calls: not checked. |
| @elemaudio/core, @elemaudio/offline-renderer | 4.0.1, 4.0.3 · 1,687 | MIT | JS DSP graphs on a native/WASM engine; last commit 2024-12-21. |
| pitchy | 4.1.0 · 19,274 | MIT | JS pitch detection (McLeod); last published 2024-01. |

Out on licence: Rubber Band (GPL-2.0), essentia (AGPL-3.0), aubio (GPL-3.0), KFR (GPL-2.0),
`pitchfinder` (GPL-3.0), DaisySP-LGPL, `@grame/faustwasm` (LGPL-3.0). Bungee (352★) is MPL-2.0,
a file-level copyleft: usable with care, not needed beside Signalsmith. Faust — a DSP language
that compiles to C++ and WASM — carries an exception that lets generated code take our licence
(per search results, not its own page); its libraries' per-function licences weren't checked.
Archived: google/REAPER (2021; SPTK bundles it), magenta/ddsp-vst (2023).

**The rec, as presented:** Signalsmith Stretch and Signalsmith DSP as the core, Airwindows
Consolidated for the effect catalogue, WORLD for the speech controls. All are MIT or BSD C++,
built into the fork's DSP module, so Node only calls the fork. Our own code is the glue: the
character sliders' mapping, the talking-beast vocoder on Signalsmith's STFT, layering, and any
effect Airwindows doesn't cover.

### Platforms — asked 2026-10-07

The user: *"are these cross platform as airwindows?"* — then *"save thsi info"*. The answer,
verbatim:

Yes, all four libraries I recommended run on Windows, macOS and Linux, like Airwindows. Airwindows and WORLD ship builds or build projects for all three. Signalsmith Stretch is compiled for all three by python-stretch, our current pitch package. Signalsmith DSP is plain portable C++, but I found no per-platform testing for it.

| Library | Windows | macOS | Linux | Evidence |
|---|---|---|---|---|
| **Airwindows Consolidated** | ✓ x64, ARM (arm64ec), Win7 | ✓ | ✓ x64 | Its automated builds cover all five targets, and the 2026-10-04 release has a `.dmg`, a Linux zip and Windows installers. The original Airwindows repo ships Windows, Mac and Linux plugin builds. |
| **Signalsmith Stretch** | ✓ | ✓ Intel + Apple Silicon | ✓ | python-stretch ships it compiled for all three (an older commit), and npm ships version 1.3.2 as WebAssembly. Since 1.3 it needs Signalsmith Linear (MIT, header-only), which uses Apple's Accelerate on a Mac and plain C++ elsewhere. |
| **Signalsmith DSP** | should | should | should | Header-only standard C++11 with no operating-system code. No per-platform testing found. |
| **WORLD** | ✓ | ✓ | ✓ | Ships Visual Studio 2015/2019/2022 projects, a makefile and CMake. No automated builds, but pyworld's Windows wheels compile it. |

The alternatives:
- **Q:** builds and tests on Windows, Linux and macOS in its CI. Needs C++20.
- **SPTK:** its README lists Linux, macOS and Windows.
- **DaisySP:** its README lists desktop plus iOS and Android.
- **stftPitchShift:** has CMake, vcpkg and WebAssembly builds; I didn't check which platforms its CI covers.
- **node-web-audio-api:** prebuilt for Windows x64/arm64, macOS Intel/Apple Silicon and Linux x64/arm/arm64.

The AI models run inside audio.cpp, so they reach the platforms our pinned build covers:
- **Windows:** CUDA, Vulkan and CPU.
- **macOS:** Metal, on Apple Silicon and Intel.
- **Linux:** x86-64 only (Vulkan and CPU). There's no Linux ARM build.

I haven't checked whether each model (Stable Audio, dots.tts Edit and so on) runs on Metal and Vulkan as well as CUDA.

These platform facts aren't in RESEARCH §8 yet.

*(Saved the same day: RESEARCH §8, "Platforms". Two precisions there: "Since 1.3" is the
1.3.2 header including `signalsmith-linear/stft.h` — when the dependency arrived wasn't
checked; and Linux also has a Colab CUDA build of the runtime, RESEARCH §1.4.)*

## 4 · Local AI — surveyed 2026-10-07

The user, while this was being recorded: *"also if there is ai that can help with this we can
check that to, not sure what type of ai can do this kind of post processing or that would fit
with our app but research taht as well we wnat to run locally"*.

**Already in our speech runtime (audio.cpp), licence-clean.** Each needs only a request path
and a catalog entry on our side:

| Model | What it does for a character | Licence |
|---|---|---|
| Voice conversion: Chatterbox VC, OpenVoice V2 tone colour, MeanVC2, MioCodec | Any rendered line → a reference clip's timbre | MIT · MIT · Apache-2.0 · MIT |
| RVC | Users' own `.pth` voices. `pitch_path` takes an edited pitch curve (a `time,Hz` CSV), so the pitch-track controls of §1 can be done neurally: flatten, exaggerate, jitter or lock the curve, then resynthesize | MIT base; packaged voices unlicensed |
| dots.tts Edit (`template_name=edit`) | Edits an existing line from tags: `<emo>`, `<pitch>`, `<rate>`, `<bg>`, `<enhance>`, `<pause/>`, `<spk_transfer/>`, and the text with `<del>`, `<ins>`, `<sub>` | Apache-2.0 |
| Maya1 | Voices designed from a description, with inline emotion tags | Apache-2.0 + SNAC MIT |
| MiDashengLM-Gen | Text → layered audio: `<|asr|>` words, `<|speech|>` a voice description, `<|sfx|>`, `<|music|>`, `<|env|>` — a creature line with its own growls and room; untested | Apache-2.0 |
| Stable Audio 3 Small SFX | Creature noises from text | Stability AI Community License (conditional) |

**The app's own AI model — no new download.** The local model that already runs Script and
Discover can turn a description into settings: "a hulking swamp troll" → Size −5, Gruff 0.6,
cave. The evidence that this works: LLM2Fx (Sony AI and KAIST, WASPAA 2025, arXiv 2505.20770) —
LLMs predict EQ and reverb parameters from a text description zero-shot, and do better with DSP
features, DSP code and few-shot examples in the prompt.

**Outside our runtime** — each would need porting into audio.cpp to fit "no Python":

| Model | Does | Why not now |
|---|---|---|
| Step-Audio-EditX (980★, code Apache-2.0) | Edits existing speech: emotion; styles including whisper, child, older; paralinguistics; denoise; speed | Python/torch only; 3B; ≥12 GB VRAM (an AWQ 4-bit build ~6–8 GB); no GGUF or C++ runtime documented; its Hugging Face weights carry no licence tag (engine scan) |
| DDSP (3,372★, Apache-2.0) | Timbre transfer | TensorFlow/Python; its C++ VST is archived (2023) |
| RAVE (1,812★) | Realtime timbre transfer — a voice into any trained sound | CC-BY-NC-4.0: no commercial use |
| Beatrice v2 | Low-latency voice conversion | Commercial use forbidden (a secondary source) |
| Seed-VC | Voice conversion and singing | GPL-3.0 weights |

**The rec, as presented:** first the app's own AI model as the "describe a character" front
end, then dots.tts Edit and the voice-conversion models already in the runtime; Stable Audio
only if its licence is accepted.

## 5 · Sources, and how each fact was checked

**Web, 2026-10-07 — the surveys (§3, §4):**

- GitHub API (`gh api repos/<owner>/<repo>`, `…/commits?per_page=1`, `…/releases/latest`):
  stars, licence, last commit and latest release for every repo in §3's tables, and for
  acids-ircam/RAVE, magenta/ddsp, magenta/ddsp-vst, stepfun-ai/Step-Audio-EditX,
  studio-dots-ai/dots.tts (1,372★, Apache-2.0) and RVC-Project/Retrieval-based-Voice-Conversion-WebUI
  (38,623★, MIT). RAVE's LICENSE read: CC-BY-NC-4.0. DaisySP's `Source/Effects` listed;
  airwin2rack's `src/autogen_airwin` counted (530 headers).
- npm registry (`npm view`, `api.npmjs.org/downloads/point/last-week/<pkg>`): node-web-audio-api,
  signalsmith-stretch, @elemaudio/core, @elemaudio/offline-renderer, @grame/faustwasm, pitchy,
  pitchfinder.
- READMEs: [airwin2rack](https://github.com/baconpaul/airwin2rack),
  [DaisySP](https://github.com/daisyaudio/DaisySP), [SPTK](https://github.com/sp-nitech/SPTK),
  [Q](https://github.com/cycfi/q), [stftPitchShift](https://github.com/jurihock/stftPitchShift),
  [Signalsmith DSP](https://github.com/Signalsmith-Audio/dsp),
  [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api).
- [Step-Audio-EditX](https://huggingface.co/stepfun-ai/Step-Audio-EditX)'s model card;
  [LLM2Fx](https://arxiv.org/abs/2505.20770); Faust's generated-code exception and Beatrice
  v2's licence from search results only.
- Platforms (§3): airwin2rack's `.github/workflows/build-daw-plugin.yml` matrix and its release
  assets (`DAWPlugin`, 2026-10-04; `Nightly` and v2.12.0 Rack builds); airwindows'
  `plugins/` folder; python-stretch's `.gitmodules` (`include/stretch`) and PyPI wheels;
  `signalsmith-stretch.h`'s includes; Signalsmith Linear's README (Accelerate, IPP);
  Signalsmith DSP's README; WORLD's top-level files (no `.github/workflows`); Q's
  `.github/workflows/build.yml`; the SPTK, DaisySP, stftPitchShift and node-web-audio-api READMEs.

**Web, 2026-10-07 — the first answer (§1):**

- Signalsmith Stretch — [README](https://github.com/Signalsmith-Audio/signalsmith-stretch) and
  [`signalsmith-stretch.h`](https://raw.githubusercontent.com/Signalsmith-Audio/signalsmith-stretch/main/signalsmith-stretch.h)
  on main: `version` {1, 3, 2}; `setTransposeFactor(multiplier, tonalityLimit=0)`,
  `setTransposeSemitones(semitones, tonalityLimit=0)`, `setFreqMap(inputToOutput)` ("should be
  monotonically increasing"), `setFormantFactor(multiplier, compensatePitch=false)`,
  `setFormantSemitones(semitones, compensatePitch=false)`, `setFormantBase(baseFreq=0)` ("0 means
  attempting to detect the pitch"). README: `compensatePitch` — "Enabling this adjust for the
  pitch-shift (or non-linear map) when correcting/shifting formants"; "The formant correction is
  not a sharp as monophonic algorithms (such such as PSOLA). It also needs you to give it a rough
  estimate of fundamental frequency (relative to Nyquist)." (quoted as written). MIT.
- python-stretch — [PyPI JSON](https://pypi.org/pypi/python-stretch/json): 0.3.1 newest
  (2025-02-14; 0.3.0 2025-02-13; 0.2.0 2024-09-21), MIT, wheels for Windows, macOS and Linux.
  What 0.3.1's `Stretch` binds was introspected in the server venv (RESEARCH §3).
- WORLD — [mmorise/World](https://github.com/mmorise/World): "modified-BSD license"; "There is
  no patent in all algorithms in WORLD"; estimates F0, aperiodicity and spectral envelope, and
  synthesizes from them.
- pyworld — [repo](https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder): MIT;
  `dio`, `stonemask`, `cheaptrick`, `d4c`, `synthesize`, `wav2world`.
  [0.3.6](https://pypi.org/pypi/pyworld/0.3.6/json) (2026-08-20): five files, Windows wheels for
  CPython 3.6–3.8 only. [0.3.5](https://pypi.org/pypi/pyworld/0.3.5/json) (2025-01-21):
  win_amd64 wheels for 3.6–3.13 (win32 for 3.6–3.7) and a source archive; no macOS or Linux
  wheels in either. Our server venv runs CPython 3.12.9.
- Maya1 — [model card](https://huggingface.co/maya-research/maya1): Apache-2.0; tags named
  `<laugh> <sigh> <whisper> <angry> <giggle> <chuckle> <gasp> <cry>` "and 12+ more"; examples
  "Dark villain character, Male voice in their 40s with a British accent. low pitch, gravelly
  timbre, slow pacing, angry tone at high intensity." and "Demon character, Male voice in their
  30s with a Middle Eastern accent. screaming tone at high intensity."
- Stable Audio 3 Small SFX — [model card](https://huggingface.co/stabilityai/stable-audio-3-small-sfx):
  text → sound effects, 0.6B; Stability AI Community License (the card points to
  stability.ai/license for commercial terms); a T5Gemma encoder under the Gemma Terms of Use;
  trained on AudioSparx-licensed audio and Creative Commons Freesound audio.

**Code, 2026-10-07 — our audio.cpp fork at `f7d8140a`, the pinned `v0.9.0-jv.4`:**

- `../audio.cpp/docs/audio_tools.md` — the VC families (`meanvc2`, `tone_color_vc`,
  `miocodec`, `rvc`, `seed_vc`, `vevo2`), `controlfoley`, `builtin_audio_utils`; RVC's request
  options (`voice_id`, `voice_model_path`, `pitch_path`, `retrieval_index_path`,
  `retrieval_blend`, `semitone_shift`, `pitch_filter_radius`, `rms_mix_rate`,
  `unvoiced_protection`, …).
- `docs/tts.md:77-104` — Chatterbox's `vc` task (source audio + `--voice-ref`);
  `server/justvoice/engines/audiocpp/v0.9.0-jv.4/cuda12/model_specs/chatterbox.json` lists
  tasks `tts`, `clone`, `vc`.
- `docs/models/tone_color_vc.md` — OpenVoice V2's standalone converter; mono 22,050 Hz; request
  options `seed` (1234) and `temperature` (0.3, upstream's `tau`).
- `docs/models/maya1.md` — English, 24 kHz SNAC; `instruct` required; `text_chunk_mode`
  `tag_aware` by default.
- `docs/models/stable_audio.md` — Small SFX, Small Music (init audio, inpainting) and Medium;
  `--duration-seconds`, `negative_prompt`, `sampler`.
- `docs/models/dots_tts.md:39-62` — the Edit package: `template_name=edit`, `source_audio`, a
  tagged instruction; the structural tags; `use_xvector`.
- `docs/models/midashenglm_gen.md` — the `gen` task and its prompt tags.

**Record — audio.cpp's `docs/model_licenses.md`, checked upstream 2026-09-21 to 09-27:**
`chatterbox` MIT · `tone_color_vc` MIT · `meanvc2` Apache-2.0 · `miocodec` MIT · `rvc` MIT for
HuBERT and RMVPE, the packaged voices `manthos`, `chocola`, `fraise` with no documented source
or licence · `seed_vc` GPL-3.0 · `vevo2` CC-BY-NC-ND-4.0 · `maya1` Apache-2.0 + SNAC MIT ·
`stable_audio` Stability AI Community License: free under USD 1M yearly revenue, commercial use
registered with Stability AI, "Powered by Stability AI" displayed, Gemma terms for the text
encoder · `controlfoley` CC-BY-NC-4.0 · `dots_tts` (dots.tts.edit included) Apache-2.0 ·
`midashenglm_gen` Apache-2.0.

**Code, 2026-10-07 — JustVoice:**

- `server/justvoice/audio/dsp/__init__.py` — the twelve primitives (`:142-155`), the GPL
  reason (`:5-7`), the length contract (`:14-18`), `DSP_VERSION` (`:35-37`, `:53`),
  `pitch_shift` (`:66`), `time_stretch` (`:108`).
- `server/justvoice/audio/dsp/delays.py:24-27` — the delay takes ≥ 1 sample, feedback ≤ 0.999.
- `server/justvoice/api/effect_presets_api.py:105` — the editor's Delay: 0–4 s, step 0.05.
- `server/justvoice/engines/capability_details.py:293-338` — Turbo's 19 tags.
- `server/justvoice/engines/*/manifest.py` — the catalog: asr, chatterbox, kitten, kokoro,
  pocket, qwen3, voxcpm2. No server code names a VC or sound-effect family or a `vc` task.
- `docs/effects.md:38-46` — the chain lives on the persona only.
- `docs/personas.md:378-416` — Kokoro blends (mix; timbre from one voice, prosody from another).

## 6 · Open — the user's calls if this is picked up

1. The library stack (§3's rec): Signalsmith Stretch and DSP, Airwindows Consolidated, WORLD —
   adopt it, or another mix.
2. The AI front end (§4's rec): the app's own model turning a description into settings —
   wanted or not.
3. Stable Audio 3's licence — conditional (revenue cap, registration, the "Powered by Stability
   AI" notice, Gemma terms): accept it, or monster sounds come from a sound bank only.
4. Seed-VC's GPL-3.0 weights and RVC's packaged voices with no stated licence: use or skip.
5. Where new effects are written before the move: in Python first, as the reference (Q1's
   condition 5), or straight into the fork's DSP module.
6. The mask/helmet comb filter needs a delay in milliseconds: an editor step that small, or a
   preset only.

Not checked: Stable Audio's creature sounds by ear; Airwindows' effects on voices by ear;
MiDashengLM-Gen on creature prompts; a true two-voice morph in any VC model's code; Maya1's
unnamed tags; whether the WASM or npm Signalsmith exposes formants; node-web-audio-api's
OfflineAudioContext; the per-function licences of Faust's libraries.
