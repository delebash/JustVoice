# Our copy of audio.cpp — the fork, its releases, the app's pin, and the C++ gaps

## 1. What this is

The switch plan's R1 and Q1 (TASKS, the audio.cpp item): JustVoice keeps its own copy of
audio.cpp, pulls upstream releases into it, builds and publishes its own binaries, and moves the
app's runtime pin to them when the first C++ change ships. Decided 2026-10-02: "all 4 , fork
repo, public, your rec on all go" (a public GitHub fork, name kept `audio.cpp`, GitHub Actions
building our binaries) and "you have a go for all gaps". This doc is the state and the plan as
presented; §5 holds the questions.

## 2. Done and found (2026-10-02)

- **Fork**: https://github.com/delebash/audio.cpp — public, fork of `0xShug0/audio.cpp`, with
  upstream's tags (`v0.9.0` → commit `795c45fb`, the build the app pins).
- **Branch `jv`** created at `795c45fb` — our line: upstream v0.9.0 plus our commits. On an
  upstream release we merge it into `jv` (R1).
- **Local clone**: `E:\Dev\Web\audio.cpp` on `jv`, remotes `origin` (the fork) and `upstream`.
- **The pipeline is inherited**: upstream's `.github/workflows/release.yml` builds macOS Metal,
  Ubuntu CPU/Vulkan, Windows CPU/Vulkan/CUDA 12.4/CUDA 13.3 and publishes a GitHub Release on a
  pushed `v*` tag; a manual run with `publish: false` is a build-only dry run. GitHub lists no
  workflows on the new fork yet (`total_count: 0`) — they register on the first push to the
  fork, or from its Actions page.
- **Toolchain here**: Visual Studio 2026 Community and VS 2019 Build Tools, CUDA 12.1 and 13.2,
  CMake and Ninja inside Visual Studio (found by `scripts/build_windows.ps1`), no Vulkan SDK
  (Vulkan builds come from CI). A first local CUDA build of `jv` as-is (sm_75) is running to
  prove it.
- **The two first fixes, located:**
  - *Aligner seconds* — `src/models/qwen3_forced_aligner/session.cpp` passes the model's
    `assets_->config.sample_rate` (16 kHz) to `processor.cpp: parse_timestamps`, which builds
    sample positions at that rate; the server turns them into seconds with the INPUT audio's
    rate, so 24 kHz input gives 2/3 of the real times (switch plan §8). Fix: spans at the input
    rate.
  - *VoxCPM2's transcript* — `app/server/runtime.cpp` maps `voice_ref` to the reference audio and
    `reference_text` to an option, but sets the prompt audio (`request.audio_input`) for
    transcription only; VoxCPM2 uses the transcript only with prompt audio
    (`src/models/voxcpm2/session.cpp`). Fix: when a speech request for a VoxCPM2 model carries a
    clip and `reference_text`, the clip is also the prompt audio (gap 9 plan §6 C).

**Built and checked locally (2026-10-03), committed on `jv`, NOT pushed** (the release
questions in §5 come first):
- **Toolchain, measured**: VS 2019 Build Tools (MSVC 19.29) is too old for this code (C3493
  lambda-capture errors in `rmvpe_pitch_extractor.cpp`); the only full CUDA toolkit here is
  12.1, which predates VS 2026; the `v13.2` folder holds runtime libraries only. So local
  builds are **CPU-only with VS 2026** (`build_windows.ps1 -Preset windows-cpu-release
  -VsInstall "E:\Program Files\Microsoft Visual Studio\18\Community"`, ~936 steps, clean) —
  enough to develop and test, the CPU backend runs every model; CUDA builds come from CI.
- `0acac2b1` **server: a VoxCPM2 clone uses the reference clip's transcript** — in the speech
  request builder (`app/server/runtime.cpp`), a VoxCPM2 request with a clip and
  `reference_text` gets the clip as prompt audio too. Through the server on the CPU, same
  request with and without the transcript: v0.9.0 → identical audio (230,444 bytes both); ours →
  different with the transcript, identical to v0.9.0 without it; Qwen3-ASR reads both back word
  for word.
- `cf08c14b` **qwen3 aligner: word spans at the input audio's rate** — `parse_timestamps` gets
  the input rate (was the model's 16 kHz), and Qwen3-ASR merges the aligner's spans as
  source-rate spans (it used to rescale them from 16 kHz). Found on the way: Qwen3-ASR's own
  word timings through the server were wrong the same way. Through the server, a 6.15 s 24 kHz
  line and its 16 kHz resample: v0.9.0 → last word 3.84 s at 24 kHz vs 5.76 s at 16 kHz; ours →
  5.76 s both (mean start difference 0.004 s); Qwen3-ASR words at 24 kHz (fixed chunks) 3.84 →
  5.76 s. (At 24 kHz the default VAD chunk mode refuses the input on both builds — Silero VAD
  takes 16 kHz only — so the app's 16 kHz resample stays useful for that path anyway.)

## 3. The plan

1. **Releases**: tags `v0.9.0-jv.N` — semver pre-releases of the upstream version they are built
   on, so a version string always says both. `release.yml` names the assets from the tag
   (`audio-v0.9.0-jv.1-bin-windows-x64-cuda12.4.zip` …), so the app's asset table changes only
   the tag and the owner.
2. **First release `v0.9.0-jv.1`**: the two fixes above, each with a unit test in the fork's own
   `tests/unittests`, built locally and checked against the app on the real data dir, then a CI
   dry run on `jv`, then the tag.
3. **The app's pin** (`engines/audiocpp/release.py`): `_DL` → `delebash/audio.cpp`, `TAG` →
   `v0.9.0-jv.1`. The VoxCPM2 row then says "…from a short clip and its transcript" again and
   offers the transcript field (`supports_clone_prompt_text=True`) — the 2026-10-02 decision
   dropped those words only until our copy passes the transcript.
4. **How installs move to it** — §5 question 2.
5. **The remaining C++ gaps**, each planned with its own blast radius before code, in the
   switch plan's order: 2 Kokoro blends (a voice-vector input), 3 single-word IPA (a text+IPA
   splice), 1 Chatterbox Turbo cloning (repack the voice-encoder and S3-tokenizer weights), 7
   Chatterbox Hebrew/Japanese/Russian/Chinese and Kokoro Japanese, 5 training rebuilt on ggml.

## 4. Blast radius — moving the pin (greps 2026-10-02)

| Change | What it touches | Grep |
|---|---|---|
| `TAG` / `_DL` | every asset URL and name; the runtime row's version; where the installed runtime is looked for | `release.py:20 TAG = "v0.9.0"` · `release.py:21 _DL = f"https://github.com/0xShug0/audio.cpp/releases/download/{TAG}"` · `release.py:47-55 audio-{TAG}-bin-…` · `speech_runtime_api.py:78 version=release.TAG` · `runtime.py:157 installed_runtime_exe(_runtime_root(), FOLDER, release.TAG, asset)` |
| Installed runtime lookup | a new tag is a new folder: an existing install reads as not installed | kit `binary.py:609-613 installed_runtime_exe(cache_root, folder, build, asset)` → `runtime_variant_dir(cache_root, folder, build, asset.gpu)` |
| The aligner fix | the app already sends 16 kHz mono, so captions are right either way | `slot.py:349 ALIGN_RATE = 16_000` · `slot.py:378-390` (the resample) |
| VoxCPM2 transcript | the row text and the transcript field | `voxcpm2/manifest.py` DESCRIPTION · `capability_details.py:309 supports_clone_prompt_text=False` · `slot.py:518-520` (already sends it) |

## 5. Open — asked with recommendations

1. **Tag scheme** `v0.9.0-jv.N`? Rec: yes.
2. **How existing installs move to our build.** Bumping the tag makes the runtime read as not
   installed until the user installs again (2 GB for CUDA), and Load never installs on its own.
   Options: (a) bump and let the runtime row ask for an install; (b) keep the installed older
   build working and have the runtime row offer "Update to v0.9.0-jv.1". Rec: (b).
3. **First release** = the aligner fix + VoxCPM2's transcript. Rec: yes — both small, both
   testable, and they prove the whole chain (fork → build → release → pin) before the bigger gaps.
4. **The app's 16 kHz resample for the aligner** once our build ships: keep or remove. Rec: keep
   until no install can still be on upstream's v0.9.0 — it is harmless and covers that case.

## 6. State after 2026-10-03, and how to build locally

**Releases:**
- `v0.9.0-jv.1` is published: tag at `adedc094`, run 37104734208, 2026-10-03 09:09Z. The app is
  pinned to it (JV `806c7a6`).
- Tags `v0.9.0-jv.2` (`42db68d9`) and `v0.9.0-jv.3` (`3865d245`) were pushed, but both release
  runs failed on macOS and were cancelled. Nothing is published for them. The cause was
  `std::to_string` of a 128-bit file time (fixed in `faf1ee03`).
- Decided 2026-10-03: no separate jv.2 / jv.3. Everything built since jv.1 goes into **one**
  release, cut once the open gaps are done. The app's `release.FEATURES` placeholders
  (jv.2 / jv.3) are retargeted to its tag then.
- That release needed two decisions at cut time: a new tag name, since jv.2 and jv.3 exist on
  broken commits; and libmecab on macOS and Linux. Decided 2026-10-04: `v0.9.0-jv.4`, and
  libmecab from fugashi's wheel for each platform as Windows already had.
- **`v0.9.0-jv.4` is published** (2026-10-05 01:25 UTC): tag at `f7d8140a`, release run
  37243444087, after dry run 37235747073 passed on every platform. The first dry run (on
  `9e5a4887`) failed at configure everywhere — an extract pattern for the other platform's wheel
  folder matched nothing — fixed in `f7d8140a`. The app is pinned to it, with each archive's
  sha256. Its bundles carry `jieba/` and libmecab (`.dll` / `.2.dylib` / `.so.2`) beside the
  executables on every platform.

**`jv` branch head:**
- `fc55e1e6` (Hebrew, Russian, Chinese), pushed;
- then `6a2bb4c5` (Japanese for Kokoro and Chatterbox; jieba word breaks for Chatterbox; gap 7
  §8), pushed 2026-10-03.

**No CI runs** until the release (the user, 2026-10-03). A push to `jv` triggers none (checked):
only tags and `workflow_dispatch` run `release.yml`.

**The dev app runs the checkout (since 2026-10-03, TASKS "`npm run dev` always runs the latest
audio.cpp").** `npm run dev` builds `../audio.cpp` into `build/jv-dev` (only what changed) and
the app runs that build, not a release (`scripts/audiocpp-dev.js`, `engines/audiocpp/dev_build.py`).
The first run sets the folder up with the CUDA 12.4 recipe below (compute capability read from
`nvidia-smi`), or the CPU build without the toolkit. Test through `npm run dev` — the manual
builds below remain for reference.

**Local builds (Windows), by hand:**
- **CPU:** `scripts/build_windows.ps1 -Preset windows-cpu-release -Target audiocpp_server
  -VsInstall "E:\Program Files\Microsoft Visual Studio\18\Community"` → `build/windows-cpu-release`.
- **CUDA 12.4** (for the RTX 2070 SUPER, sm_75). CUDA 12.4.1 is installed with nvcc, cudart,
  cuBLAS, cuFFT, thrust and NVRTC, and no driver. This mirrors `release.yml`'s windows-cuda job.
  From a cmd prompt:

  ```
  call "E:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat" x64 -vcvars_ver=14.44
  set "CUDA_PATH=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4"
  set "PATH=%CUDA_PATH%\bin;%PATH%"
  cmake -S . -B build\windows-cuda12-local -G Ninja -DCMAKE_BUILD_TYPE=Release ^
    -DENGINE_ENABLE_CUDA=ON -DENGINE_ENABLE_OPENMP=OFF -DGGML_OPENMP=OFF ^
    -DENGINE_ENABLE_CUDA_GRAPHS=ON -DENGINE_ENABLE_VULKAN=OFF -DENGINE_ENABLE_METAL=OFF ^
    -DENGINE_ENABLE_LLAMAFILE=ON -DENGINE_ENABLE_NATIVE_CPU=ON -DENGINE_BUILD_TESTS=OFF ^
    -DENGINE_ENABLE_CPU_ALL_VARIANTS=OFF "-DCMAKE_CUDA_ARCHITECTURES=75" ^
    -DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=ON "-DCUDAToolkit_ROOT=%CUDA_PATH%"
  cmake --build build\windows-cuda12-local --config Release -j %NUMBER_OF_PROCESSORS% --target audiocpp_server audiocpp_cli
  ```

  - VS 2026's installed MSVC 14.44 is the VS 2022 toolset CI uses.
  - The first build takes about 30 min; incremental builds take minutes.
  - To run the server, put `CUDA_PATH\bin` on PATH.
- **Next to the local server, for Japanese and Chinese.** Since 2026-10-03 (decided D3) the
  fork's own build puts them there — `cmake/text_dictionaries.cmake` fetches them at configure
  time (SHA-256 pinned) and copies them beside `audiocpp_server` / `audiocpp_cli`, locally and
  in the release, whose bundle is the whole `bin/` folder. Windows has both; macOS and Linux get
  jieba, and load the system libmecab until the release builds it there. The files:
  - `libmecab.dll` from fugashi 1.5.2's `cp312-win_amd64` wheel
    (`fugashi.libs/libmecab-d8ddc079….dll`; wheel sha256 `936d7101…`; MeCab BSD);
  - `jieba/jieba.dict.utf8` and `jieba/hmm_model.utf8` from cppjieba `8f171de` (MIT; sha256 as
    `tools/community_models/export_zipvoice_zh_dict.py` pins them).
  - Japanese also needs `AUDIOCPP_UNIDIC_DIR` → unidic-lite 1.0.8's `dicdir`. The app sets it once
    the dictionary row has installed it.
- **MeCab from source does not build as-is** with today's MSVC (gap 7 plan §7), hence fugashi's
  DLL for now. Patching 0.996 through is for when the release builds every platform.
- **Test harnesses** (scratch, re-creatable from the plans):
  - a server config with `"backend": "cuda"` and models by path, then POST `/v1/audio/speech`
    with `voice_ref` for clones;
  - Qwen3-ASR read-back through `/v1/audio/transcriptions`;
  - speaker similarity from Resemble's voice encoder ported to numpy (gap 1 plan §6).
