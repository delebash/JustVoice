# NOTICE

JustVoice — an open-source voice production server (audiobook + game dialogue + podcasting + dictation + accessibility).

Copyright (c) 2026 JustVoice contributors.
Licensed under the **MIT License** (see `LICENSE`).

> **License history — Apache-2.0 → GPL-3.0-or-later → MIT.**
>
> The GPL flip on **2026-06-08** was forced by exactly one dependency: `pedalboard`
> (Spotify), which is GPL-3.0 because it statically links JUCE. Nothing else in the tree was
> ever copyleft.
>
> **2026-07-29 — flipped to MIT.** `pedalboard` was removed and its twelve effects
> reimplemented in `server/justvoice/audio/dsp/` on numpy + scipy, with pitch shifting
> delegated to Signalsmith Stretch (MIT). With the forcing dependency gone the relicense was
> paperwork: root `LICENSE` (GPL-3.0 → MIT), `server/pyproject.toml` and `src-tauri/Cargo.toml`
> license fields, this NOTICE, `LICENSES.md`, the in-app About text, and every first-party
> SPDX header across 259 files (`GPL-3.0-or-later` → `MIT`, and
> `MIT AND GPL-3.0-or-later` → plain `MIT`, since upstream-derived files were MIT to begin
> with and the combined work is now MIT too).
>
> **The policy for new files is unchanged:** every file carries an SPDX header, and files
> lifted from upstream MIT code additionally carry a full attribution block referencing the
> pinned commit in `voicebox-pin.txt`. Only the identifier changed.

This product incorporates, links against, or depends on the following third-party software. Each component retains its original license. See `LICENSES.md` for the authoritative inventory and `LICENSES/<SPDX-id>.txt` for full license texts.

---

## Model weights — attribution requirements

JustVoice itself is free software, but a few bundled engines ship model weights whose license terms require an attribution notice in any published work produced with them. These are reproduced inline in the Engines tab card UI and listed here for the authoritative copy.

### HumeAI TADA (model weights: Llama 3.2 Community License)

- Upstream weights: https://huggingface.co/HumeAI/tada-3b-ml (Llama 3.2 Community License) + https://huggingface.co/HumeAI/tada-codec (MIT)
- Wrapper code: `hume-tada` (Apache-2.0)
- License text: see Meta's published terms at https://www.llama.com/llama3_2/license/

TADA is built on Meta Llama 3.2. The Llama 3.2 Community License §1.b requires that any product or service built using Llama-derivative models display **"Built with Llama"** prominently in the user interface AND include the same notice in any associated documentation. The 700M MAU threshold in §2 is a separate clause that doesn't apply to JustVoice's distribution model.

JustVoice surfaces the "Built with Llama" notice on the Engines tab when TADA is selected (see `src/renderer/src/views/EnginesView.vue` license row; data driven by `WEIGHTS_LICENSE` + `ATTRIBUTION` fields on the engine manifest). End users who ship audiobooks, podcasts, or game audio produced with TADA must reproduce the same attribution in their published work's credits.

---

## Code lifted into this repository

### voicebox (MIT)

- Upstream: https://github.com/jamiepine/voicebox
- License: MIT
- Copyright (c) 2024 Jamie Pine and voicebox contributors
- Pinned commit: see `voicebox-pin.txt` at repo root (`b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9`)
- Lifted, ported, or translated files (authoritative — must match per-file headers):

  *To be populated as Phase 3 lifts land. Each entry: path, lift type (verbatim port / translation), original voicebox path at the pinned SHA.*

The MIT permission notice (`LICENSES/MIT.txt`) applies to the upstream-derived portions of these files. JustVoice modifications are licensed under MIT as part of the combined JustVoice work — so as of 2026-07-29 these files are MIT throughout, which is why their SPDX headers are plain `MIT` rather than a compound identifier. The attribution above is still required.

> **Note on voicebox upstream changes.** If voicebox relicenses to a non-permissive license after the pinned SHA above, do NOT cherry-pick patches or read post-relicense code while working on JustVoice. The pinned snapshot remains MIT in perpetuity (MIT is irrevocable), but anything past the cutoff is out of bounds.

### JustWrite audio modules (license: same project, internal)

JustWrite ships `services/m4b.js`, `services/speakerAttribution.js`, `services/render.js`, and `services/audioStore.js`. These remain in JustWrite (which owns audiobook orchestration UI per `CONTRACT.md`). JustVoice does not duplicate them.

---

## Runtime dependencies (installed from PyPI; not re-vendored)

Each retains its upstream license. Full text in `LICENSES/<SPDX-id>.txt`. Apache-2.0 NOTICE content per §4(d) is reproduced below where applicable.

### transformers (Apache-2.0)

- Upstream: https://github.com/huggingface/transformers
- License: Apache-2.0

```
Copyright 2018- The HuggingFace team. All rights reserved.
```

### sherpa-onnx / sherpa-onnx-python (Apache-2.0)

- Upstream: https://github.com/k2-fsa/sherpa-onnx
- License: Apache-2.0
- Used by: Kokoro engine via the `sherpa-onnx-python` PyPI package

### PyTorch / torch (BSD-3-Clause)

- Upstream: https://github.com/pytorch/pytorch
- License: BSD-3-Clause (PyTorch itself); bundles further BSD/MIT/Apache sub-components — see PyTorch's own NOTICES.

### numpy (BSD-3-Clause)

- Upstream: https://github.com/numpy/numpy
- License: BSD-3-Clause

### fastapi (MIT) / uvicorn (BSD-3-Clause) / pydantic (MIT) / httpx (BSD-3-Clause) / typer (MIT) / rich (MIT) / requests (Apache-2.0) / psutil (BSD-3-Clause) / platformdirs (MIT)

- Standard PyPI deps; see `LICENSES.md` for the full inventory.
- Apache-2.0 §4(d) — `requests` is the one dep in this group that ships an upstream `NOTICE`
  (checked 2026-07-29). Reproduced verbatim:

```
Requests
Copyright 2019 Kenneth Reitz
```

### sqlalchemy (MIT) / python-multipart (Apache-2.0) / tenacity (Apache-2.0) / cachetools (MIT) / fastmcp (Apache-2.0)

- Standard PyPI deps, all frozen into the shipped sidecar; see `LICENSES.md` for the inventory.
- Apache-2.0 §4(d) — checked 2026-07-29: `python-multipart`, `tenacity` and `fastmcp` ship no
  upstream `NOTICE` file, so there is no NOTICE content to propagate. Re-check on bump.

### llm-runner (MIT)

- Upstream: https://github.com/delebash/just-llm-runner
- License: MIT
- Own repo, consumed as a pinned git dependency and frozen into the sidecar by PyInstaller.

### uv (Apache-2.0 OR MIT)

- Upstream: https://github.com/astral-sh/uv
- License: dual — upstream ships both `LICENSE-APACHE` and `LICENSE-MIT`, so an MIT product may
  take the MIT option. No upstream `NOTICE` file (checked 2026-07-29).
- Bundled as a Tauri `externalBin` sidecar so that installing an engine needs no system Python,
  pip, or toolchain from the user. Version pinned in `.github/workflows/release.yml`.

### chatterbox-tts (MIT) / qwen-tts (Apache-2.0)

- Engine extras; `pip install justvoice[chatterbox]` / `[qwen3]`. Installed on demand onto the
  user's machine — neither is frozen into the shipped sidecar.
- `qwen-tts` verified 2026-07-29: `Apache-2.0` both upstream (`QwenLM/Qwen3-TTS`) and on PyPI
  (0.1.1). It ships no upstream `NOTICE` file. This entry previously read "license TBD".
- `chatterbox-tts` pulls in **parselmouth** (`GPL-3.0-or-later`) transitively. That copyleft does
  not reach JustVoice: it is never redistributed, and it is imported only inside the chatterbox
  engine subprocess. See `LICENSES.md` → *Installed on demand* for the full reasoning.

### faster-whisper (MIT) / peft (Apache-2.0) / safetensors (Apache-2.0) — training extras

- `pip install justvoice[training]`

### scipy

- Upstream: https://github.com/scipy/scipy
- License: BSD-3-Clause
- `sosfilt` / `lfilter` behind the effects DSP. numpy alone cannot run recursive filters at
  usable speed.

### python-stretch (Signalsmith Stretch)

- Upstream: https://github.com/gregogiudici/python-stretch
- License: MIT
- Pitch shifting for the effects chain.

> **Removed 2026-07-29: pedalboard (Spotify, GPL-3.0).** It was the only copyleft dependency the
> project ever *distributed*, and the sole reason for the 2026-06-08 Apache-2.0 → GPL-3.0-or-later
> flip. Its twelve effects now live in `server/justvoice/audio/dsp/`.
>
> One copyleft dependency is still *reachable* — `parselmouth` (`GPL-3.0-or-later`), pulled in
> transitively by the `chatterbox` extra. It does not relicense anything, because JustVoice never
> redistributes it and never links it in-process. Redistribution plus in-process linkage is what
> propagated with pedalboard; see `LICENSES.md` → *Installed on demand*.

---

## Frontend dependencies (npm; not re-vendored)

- `vue` (MIT) — https://github.com/vuejs/core
- `pinia` (MIT) — https://github.com/vuejs/pinia
- `vue-sonner` (MIT) — toast notifications
- `@tauri-apps/api` + `@tauri-apps/plugin-*` (Apache-2.0 OR MIT) — https://github.com/tauri-apps/tauri
- `vite` (MIT) — https://github.com/vitejs/vite

See `LICENSES.md` for the full tabular inventory.

---

## Tauri shell (Rust crates)

`src-tauri/` links against the Tauri crate ecosystem (Apache-2.0 OR MIT). Each retains its upstream license; no Rust crate source is re-vendored in this repo.

---

## How to update this file

- Adding a new pip/npm dep: add a row to `LICENSES.md`, add a section here if the license is Apache-2.0 (NOTICE propagation), confirm `LICENSES/<SPDX>.txt` exists.
- Adding a new voicebox lift: append the file path to the voicebox "Lifted files" list above and add the per-file header to the lifted file (see `project_licensing_attribution` memory for templates).
- Removing a lift entirely (file deleted): remove its entry from the list.
- Voicebox SHA bump: update `voicebox-pin.txt`, update the archived snapshot, and add a note here describing what changed.
