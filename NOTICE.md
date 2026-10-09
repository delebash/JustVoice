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
> **The policy for new files is unchanged:** every file carries an SPDX header. Only the
> identifier changed.

This product incorporates, links against, or depends on the following third-party software. Each component retains its original license. See `LICENSES.md` for the authoritative inventory and `LICENSES/<SPDX-id>.txt` for full license texts.

---

## Model weights — attribution requirements

JustVoice itself is free software, and every speech model it offers permits commercial use of what
you produce with it. Kokoro-82M, KittenTTS Mini 0.8, Qwen3-TTS, Qwen3-ASR, Qwen3-ForcedAligner and VoxCPM2
are Apache-2.0 and Chatterbox is MIT — no attribution requirement (see `LICENSES.md` → *Downloaded on
demand*). One carries a credit, shown with a ⚠ on its model rows in the app:

- **Pocket TTS — CC BY 4.0, Kyutai** (added 2026-10-02; https://huggingface.co/kyutai/pocket-tts).
  CC BY asks that the licensor be credited when the licensed material is shared. JustVoice does not
  share it — your app downloads it from audio.cpp's copy — but the credit is easy to give where you
  credit your tools: *"Pocket TTS by Kyutai, CC BY 4.0."* Its preset voices come from recordings
  under their own licences: Alba — Alba MacKenna, CC BY 4.0; Anna, Azelma, Charles, Eponine, Eve,
  Fantine, George, Jane, Mary, Michael, Paul, Vera — the VCTK corpus (University of Edinburgh, CSTR),
  CC BY 4.0; Bill Boerst, Caro Davy, Peter Yearsley, Stuart Bell — Voice-Zero (LibriVox), CC0;
  Estelle, Javert, Marius — Kyutai's own and donated recordings, CC0. Cloning with Pocket TTS also
  asks you to accept Kyutai's prohibited-use terms, which the app shows before the first clone.

(HumeAI TADA, whose Llama 3.2 Community License required "Built with Llama" in the UI and in your
published credits, was removed with the 2026-10-01 switch to the speech runtime.)

---

## Code lifted into this repository

### JustWrite audio modules (license: same project, internal)

JustWrite ships `services/m4b.js`, `services/speakerAttribution.js`, `services/render.js`, and `services/audioStore.js`. These remain in JustWrite (which owns audiobook orchestration UI per `CONTRACT.md`). JustVoice does not duplicate them.

### Through the shared kit (`@delebash/llm-ui`, bundled into the renderer)

- The table's sorting and filtering rules (`ui/src/common/components/tableRows.js`) are ported from
  TanStack Table's table-core 8 — MIT License, Copyright (c) 2016 Tanner Linsley; the full notice
  is kept in the file.
- The toasts' kind icons (`ui/src/common/services/toastBridge.js`) are Heroicons paths (MIT License,
  Copyright (c) Tailwind Labs, Inc.) copied from vue-sonner 2.0.9 — MIT License, Copyright (c) 2022
  Yunwei Xiao; the full notice is kept in the file.

---

## Runtime dependencies (installed from PyPI; not re-vendored)

Each retains its upstream license. Full text in `LICENSES/<SPDX-id>.txt`. Apache-2.0 NOTICE content per §4(d) is reproduced below where applicable, and BSD-3-Clause copyright notices per cl. 1–2 are reproduced immediately below.

### BSD-3-Clause copyright notices (cl. 1–2)

`LICENSES/BSD-3-Clause.txt` carries the licence text with a `<year> <owner>` placeholder, because several components share one text. Clauses 1 and 2 additionally require each component's *own* copyright notice to be retained in source and binary redistributions — so they are reproduced here verbatim, fetched from each upstream `LICENSE` on 2026-07-29.

**Distributed** — frozen into the `justvoice-server` sidecar, so these notices are obligations:

```
Copyright © 2017-present, Encode OSS Ltd.                         (uvicorn, https://www.encode.io/)
Copyright © 2019, Encode OSS Ltd.                                 (httpx, https://www.encode.io/)
Copyright (c) 2005-2025, NumPy Developers.                        (numpy)
Copyright (c) 2009, Jay Loden, Dave Daeschler, Giampaolo Rodola'  (psutil)
Copyright (c) 2001-2002 Enthought, Inc. 2003, SciPy Developers.   (scipy)
```

### audio.cpp (Apache-2.0) — the speech runtime

- Upstream: https://github.com/0xShug0/audio.cpp. JustVoice runs its own build, from JustVoice's
  copy https://github.com/delebash/audio.cpp (a public fork, branch `jv`) — prebuilt release
  archives made by the fork's release workflow, pinned `v0.9.0-jv.4` (upstream v0.9.0 plus
  JustVoice's changes). Every file the copy changes says so in a first-line comment, with the date
  and what changed (Apache-2.0 §4(b)).
- License: Apache-2.0, Copyright 2026 ShugoAI LLC
- Downloaded onto the user's machine when they install the speech runtime; never bundled with or
  redistributed by JustVoice. Its release archive carries a `LICENSE` and no `NOTICE` file
  (checked 2026-10-04 on v0.9.0-jv.4's macOS and Linux bundles), so there is no §4(d) content to
  propagate. Re-check on every pin bump. Since jv.4 the archive also carries MeCab's library and
  cppjieba's dictionaries, each with its own licence file (below).

### MeCab (BSD-3-Clause) — Japanese readings, inside the speech runtime

- Upstream: https://taku910.github.io/mecab/ — MeCab 0.996, as fugashi 1.5.2's prebuilt wheels
  ship it (https://github.com/polm/fugashi); the runtime's build copies `libmecab` beside the
  executable with its licence as `libmecab.LICENSE.txt`.
- Copyright (c) 2001-2008, Taku Kudo; Copyright (c) 2004-2008, Nippon Telegraph and Telephone
  Corporation. BSD-3-Clause.
- Part of the speech runtime archive the user's machine downloads; not redistributed by JustVoice.

### cppjieba's dictionaries (MIT) — Chinese word breaks, inside the speech runtime

- Upstream: https://github.com/yanyiwu/cppjieba at commit `8f171de` — `jieba.dict.utf8` and
  `hmm_model.utf8`, with its `LICENSE`, in the runtime's `jieba/` folder.
- Part of the speech runtime archive; not redistributed by JustVoice.

### The Japanese dictionary — unidic-lite (MIT) and UniDic (BSD-3-Clause)

- Upstream: https://github.com/polm/unidic-lite 1.0.8 (Copyright 2020 Paul McCann, MIT), carrying
  UniDic 2.1.2 (Copyright 2011-2017 The UniDic Consortium; offered under BSD, GPL or LGPL — taken
  under BSD-3-Clause). Both licence files are unpacked with the dictionary.
- Downloaded onto the user's machine from PyPI when they install the Japanese dictionary; never
  bundled with or redistributed by JustVoice.

### eSpeak NG (GPL-3.0) — Kokoro's and KittenTTS's pronunciation library

- Upstream: https://github.com/espeak-ng/espeak-ng, fetched as the `espeakng-loader` 0.2.4 wheel
  (the loader is MIT — https://github.com/thewh1teagle/espeakng-loader)
- Downloaded onto the user's machine with the speech runtime and loaded by the audio.cpp process —
  never by JustVoice code, never redistributed by JustVoice. Why the GPL does not reach JustVoice:
  `LICENSES.md` → *Downloaded on demand*.

### Speech models (GGUF)

- Upstream: https://huggingface.co/audio-cpp/audio.cpp-gguf at a pinned commit; each directory keeps
  its original model's licence (Kokoro-82M Apache-2.0 — hexgrad; KittenTTS Mini 0.8 Apache-2.0 —
  KittenML; Pocket TTS CC BY 4.0 — Kyutai, see *Model weights* above; Qwen3-TTS, Qwen3-ASR,
  Qwen3-ForcedAligner Apache-2.0 — Qwen; Chatterbox MIT — Resemble AI; VoxCPM2 Apache-2.0 —
  OpenBMB).
- Qwen3-TTS CustomVoice 0.6B comes from JustVoice's own conversion of Qwen's checkpoint (Apache-2.0,
  changes stated on its page): https://huggingface.co/delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF
- Chatterbox Turbo and Nano come from JustVoice's own conversions of Resemble AI's checkpoints
  (MIT): https://huggingface.co/delebash/chatterbox-turbo-GGUF and
  https://huggingface.co/delebash/chatterbox-nano-GGUF
- Downloaded by the user's app on demand; not redistributed by JustVoice.

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
> One copyleft component is *reachable* — eSpeak NG (`GPL-3.0`), downloaded with the speech
> runtime. It relicenses nothing, because JustVoice never redistributes it and never links it
> in-process. Redistribution plus in-process linkage is what propagated with pedalboard; see `LICENSES.md` →
> *Downloaded on demand*.

---

## Frontend dependencies (npm; not re-vendored)

- `vue` (MIT) — https://github.com/vuejs/core
- `pinia` (MIT) — https://github.com/vuejs/pinia
- `quasar` (MIT) — the app framework; the kit's controls are built on its components — https://github.com/quasarframework/quasar
- `@tauri-apps/api` + `@tauri-apps/plugin-*` (Apache-2.0 OR MIT) — https://github.com/tauri-apps/tauri
- `vite` (MIT) — https://github.com/vitejs/vite

See `LICENSES.md` for the full tabular inventory.

---

## Tauri shell (Rust crates)

`src-tauri/` links against the Tauri crate ecosystem (Apache-2.0 OR MIT). Each retains its upstream license; no Rust crate source is re-vendored in this repo.

---

## How to update this file

- Adding a new pip/npm dep: add a row to `LICENSES.md`, add a section here if the license is Apache-2.0 (NOTICE propagation), confirm `LICENSES/<SPDX>.txt` exists.
