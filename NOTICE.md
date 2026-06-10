# NOTICE

JustVoice — an open-source voice production server (audiobook + game dialogue + podcasting + dictation + accessibility).

Copyright (c) 2026 JustVoice contributors.
Licensed under the GNU General Public License, version 3 or later (see `LICENSE`).

> **License flip happened 2026-06-08 Phase 3** when `pedalboard` (Spotify, GPL-3.0) was adopted for the effects chain. The flip was atomic — a single commit updated root `LICENSE` (Apache-2.0 → GPL-3.0-or-later), `server/pyproject.toml`'s license field, this NOTICE, `LICENSES.md`, and every first-party file's SPDX header (`Apache-2.0` → `GPL-3.0-or-later`, `MIT AND Apache-2.0` → `MIT AND GPL-3.0-or-later`). See `~/.claude/projects/E--Dev-Web-justtts/memory/project_licensing_attribution.md` for the policy and `DESIGN_FREEZE.md` §3.1 for the decision.

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

The MIT permission notice (`LICENSES/MIT.txt`) applies to the upstream-derived portions of these files. JustVoice modifications are licensed under Apache-2.0 (and later GPL-3.0-or-later after the pedalboard flip) as part of the combined JustVoice work.

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

### chatterbox-tts (MIT) / qwen-tts (license TBD — verify before relying on lift)

- Engine extras; `pip install justtts[chatterbox]` / `[qwen3]`

### faster-whisper (MIT) / peft (Apache-2.0) / safetensors (Apache-2.0) — training extras

- `pip install justtts[training]`

### pedalboard (GPL-3.0) — Phase 3+

- Upstream: https://github.com/spotify/pedalboard
- License: GPL-3.0
- Adoption triggers the project-wide license flip from Apache-2.0 to GPL-3.0-or-later.

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
