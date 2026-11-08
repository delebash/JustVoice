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
> delegated to Signalsmith Stretch (MIT) — and since 2026-10-07 in C++ in JustVoice's copy of
> audio.cpp (`dsp/`, shipped as `audiocpp_dsp`). With the forcing dependency gone the relicense was
> paperwork: root `LICENSE` (GPL-3.0 → MIT), `server/pyproject.toml` and `src-tauri/Cargo.toml`
> license fields, this NOTICE, `LICENSES.md`, the in-app About text, and every first-party
> SPDX header across 259 files (`GPL-3.0-or-later` → `MIT`, and
> `MIT AND GPL-3.0-or-later` → plain `MIT`, since upstream-derived files were MIT to begin
> with and the combined work is now MIT too).
>
> **The policy for new files is unchanged:** every file carries an SPDX header. Only the
> identifier changed.

This product incorporates, links against, or depends on the following third-party software (refreshed
2026-11-05 for the Electron app and its Node server; the Python and Tauri sections went with them). Each component retains its original license. See `LICENSES.md` for the authoritative inventory and `LICENSES/<SPDX-id>.txt` for full license texts.

---

## Model weights — attribution requirements

JustVoice itself is free software. The speech models it offers are each under their own licence, and
not all of them permit selling what you make: each model's row, and the opened engine, show
JustVoice's reading of its licence (*Commercial use, in plain words* — `docs/engines.md`), and a model
whose commercial use isn't a plain *Yes* asks you to accept its licence before its first download.
JustVoice never redistributes a model — your app downloads it from its publisher. Where a licence asks
for credit, the reading says so; for example:

- **Pocket TTS — CC BY 4.0, Kyutai** (https://huggingface.co/kyutai/pocket-tts). CC BY asks that the
  licensor be credited when the licensed material is shared. The credit is easy to give where you
  credit your tools: *"Pocket TTS by Kyutai, CC BY 4.0."* Its preset voices come from recordings
  under their own licences: Alba — Alba MacKenna, CC BY 4.0; Anna, Azelma, Charles, Eponine, Eve,
  Fantine, George, Jane, Mary, Michael, Paul, Vera — the VCTK corpus (University of Edinburgh, CSTR),
  CC BY 4.0; Bill Boerst, Caro Davy, Peter Yearsley, Stuart Bell — Voice-Zero (LibriVox), CC0;
  Estelle, Javert, Marius — Kyutai's own and donated recordings, CC0. Cloning with Pocket TTS also
  asks you to accept Kyutai's prohibited-use terms, which the app shows before the first clone.

---

## Code lifted into this repository

### Whisper's basic text normaliser (MIT)

`server/src/whisper_normalizer.js` is a line-for-line port of `whisper/normalizers/basic.py` from
https://github.com/openai/whisper (commit 26a7cac, 2025-01-04) — MIT License, Copyright (c) 2022
OpenAI; the full notice is kept in the file. The take check normalises a line's words and the
recogniser's transcript with it (added 2026-10-16).

### NVIDIA NeMo's Empathic-Insight-Voice wrapper (Apache-2.0) — the test kit only

`tools/take-check/src/take_check/emotion_encoder.py` is NVIDIA NeMo's
`nemo/collections/tts/metrics/emotion_encoder.py` (https://github.com/NVIDIA/NeMo, commit cd61689d,
2026-11-06) — Apache License 2.0, Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES; its notice is
kept in the file, with JustVoice's one change stated there (every LAION head added to its label
map). The test kit scores takes with LAION's Empathic-Insight-Voice heads through it
(laion/Empathic-Insight-Voice-Small, CC-BY-4.0, downloaded on use, never redistributed). The test
kit is a tool beside the app and never ships (added 2026-11-08).

### Through the shared kit (`@delebash/ui`, bundled into the renderer)

- The table's sorting and filtering rules (`ui/src/common/components/tableRows.js`) are ported from
  TanStack Table's table-core 8 — MIT License, Copyright (c) 2016 Tanner Linsley; the full notice
  is kept in the file.
- The toasts' kind icons (`ui/src/common/services/toastBridge.js`) are Heroicons paths (MIT License,
  Copyright (c) Tailwind Labs, Inc.) copied from vue-sonner 2.0.9 — MIT License, Copyright (c) 2022
  Yunwei Xiao; the full notice is kept in the file.
- Which names are marked as right-to-left (`ui/src/common/services/isolate.js`) — the strong
  left-to-right and right-to-left character ranges of Google Closure Library's
  `closure/goog/i18n/bidi.js`. Apache License 2.0, Copyright The Closure Library Authors.
- The info banner's icon (`ui/src/common/iconPaths.js`, `Info`) — Lucide's "info" (lucide-static
  1.60.0), derived from Feather. ISC License, Copyright (c) 2026 Lucide Icons and Contributors; MIT
  License, Copyright (c) 2013-present Cole Bemis. Both notices are kept in the file.

### Fonts bundled into the renderer

- **Inter** (`@fontsource/inter` 5.3.0, `src/css/fonts.css`) — Copyright 2016 The Inter Project
  Authors (github.com/rsms/inter). SIL Open Font License 1.1.
- **JetBrains Mono** (`@fontsource/jetbrains-mono` 5.3.0, `src/css/fonts.css`) — Copyright 2020 The
  JetBrains Mono Project Authors (github.com/JetBrains/JetBrainsMono). SIL Open Font License 1.1.

The licence's text is `LICENSES/OFL-1.1.txt`. JustVoice bundles only these two (its build's font files,
checked 2026-11-06); the kit's sixteen (`@delebash/ui` `common/fonts.css`) are not in its stylesheets.

---

## Distributed — in the installer

Each retains its upstream license (`LICENSES.md` lists them with versions). Full texts in
`LICENSES/<SPDX-id>.txt` and each package's own `LICENSE`.

### BSD-3-Clause copyright notices (cl. 1–2)

`LICENSES/BSD-3-Clause.txt` carries the licence text with a `<year> <owner>` placeholder, because
several components share one text. Clauses 1 and 2 additionally require each component's *own*
copyright notice to be retained in source and binary redistributions — so they are reproduced here:

```
Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>        (diff — jsdiff, in the server's packages)
Copyright (c) 2005-2026, NumPy Developers.                        (ported into audiocpp_dsp)
Copyright (c) 2001-2002 Enthought, Inc. and 2003-2026 SciPy Developers.  (ported into audiocpp_dsp)
```

SciPy's filter design carries the Cephes Math Library's notice (Copyright 1984-2000 Stephen L.
Moshier) — the full list of what `audiocpp_dsp` ports and vendors is the fork's
`dsp/THIRD_PARTY_NOTICES.md` (https://github.com/delebash/audio.cpp).

### audiocpp_dsp (Apache-2.0) — the server's audio math

- From JustVoice's copy of audio.cpp (https://github.com/delebash/audio.cpp, `dsp/`), Copyright 2026
  ShugoAI LLC and JustVoice's contributors, Apache-2.0; every file the copy changes says so in a
  first-line comment (Apache-2.0 §4(b)). The installer carries the pinned release's CPU program beside
  the app's executable — on Windows with Microsoft's Visual C++ runtime DLLs, redistributable under
  Microsoft's terms.
- Vendors **Signalsmith Stretch** 1.4.0 (pitch and pace) — MIT, Copyright (c) 2022 Geraint Luff /
  Signalsmith Audio Ltd. — and **Signalsmith Linear** 0.6.4 — MIT, Copyright (c) Geraint Luff /
  Signalsmith Audio Ltd.

### lru-cache (BlueOak-1.0.0)

In the server's packages. The Blue Oak Model License 1.0.0 asks that everyone who gets a copy also
gets its text or a link to it: https://blueoakcouncil.org/license/1.0.0 — the text is the package's
`LICENSE.md`.

### Apache-2.0 packages

`openai`, `@google/genai` (the kit's AI providers), `@internationalized/number` (the kit's number
inputs) and DOMPurify (taken under its Apache-2.0 option) ship no upstream `NOTICE` file (checked
2026-11-05), so there is no §4(d) content to propagate. Re-check on bump.

### Electron

The desktop shell, MIT (Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.);
Chromium's and Node's own notices ship beside it, as `LICENSES.chromium.html`, in every Electron build.

---

## Downloaded on demand — never redistributed by JustVoice

### audio.cpp (Apache-2.0) — the speech runtime

- Upstream: https://github.com/0xShug0/audio.cpp. JustVoice runs its own build, from JustVoice's
  copy https://github.com/delebash/audio.cpp (a public fork, branch `jv`) — prebuilt release
  archives made by the fork's release workflow, at the kit's pinned build (`v0.9.2-jv.6` on
  2026-11-05: upstream v0.9.2 plus JustVoice's changes). Every file the copy changes says so in a
  first-line comment, with the date and what changed (Apache-2.0 §4(b)).
- License: Apache-2.0, Copyright 2026 ShugoAI LLC
- Downloaded onto the user's machine when they install the speech runtime; never bundled with or
  redistributed by JustVoice. Its release archive carries a `LICENSE` and no `NOTICE` file
  (checked 2026-11-05 on the installed `v0.9.2-jv.6` CUDA archive), so there is no §4(d) content to
  propagate. Re-check on every pin bump. The archive also carries MeCab's library and cppjieba's
  dictionaries, each with its own licence file (below), and — the CUDA and Windows archives — NVIDIA's
  CUDA runtime libraries and Microsoft's Visual C++ runtime, under their redistributable terms.

### MeCab (BSD-3-Clause) — Japanese readings, inside the speech runtime

- Upstream: https://taku910.github.io/mecab/ — MeCab 0.996, as fugashi 1.5.2's prebuilt wheels
  ship it (https://github.com/polm/fugashi); the runtime's build copies `libmecab` beside the
  executable with its licence as `libmecab.LICENSE.txt`.
- Copyright (c) 2001-2008, Taku Kudo; Copyright (c) 2004-2008, Nippon Telegraph and Telephone
  Corporation. BSD-3-Clause.

### cppjieba's dictionaries (MIT) — Chinese word breaks, inside the speech runtime

- Upstream: https://github.com/yanyiwu/cppjieba — `jieba.dict.utf8` and `hmm_model.utf8`, with its
  `LICENSE`, in the runtime's `jieba/` folder.

### The Japanese dictionary — unidic-lite (MIT) and UniDic (BSD-3-Clause)

- Upstream: https://github.com/polm/unidic-lite 1.0.8 (Copyright 2020 Paul McCann, MIT), carrying
  UniDic 2.1.2 (Copyright 2011-2017 The UniDic Consortium; offered under BSD, GPL or LGPL — taken
  under BSD-3-Clause). Both licence files are unpacked with the dictionary, the speech runtime's
  add-on.

### eSpeak NG (GPL-3.0) — Kokoro's and KittenTTS's pronunciation library

- Upstream: https://github.com/espeak-ng/espeak-ng, fetched as the `espeakng-loader` wheel (the
  loader is MIT — https://github.com/thewh1teagle/espeakng-loader)
- Downloaded onto the user's machine with the speech runtime and loaded by the audio.cpp process —
  never by JustVoice code, never redistributed by JustVoice. Why the GPL does not reach JustVoice:
  `LICENSES.md` → *Downloaded on demand*.

### Speech models (GGUF)

- Each from its publisher's repository (audio.cpp's `audio-cpp/audio.cpp-gguf` at a pinned revision,
  or the model's own), each under its original model's licence — JustVoice's reading of every one is
  in `server/src/engines/audiocpp/curated/<family>.js`, dated, and shown in the app.
- Qwen3-TTS CustomVoice 0.6B comes from JustVoice's own conversion of Qwen's checkpoint (Apache-2.0,
  changes stated on its page): https://huggingface.co/delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF
- Chatterbox Turbo and Nano come from JustVoice's own conversions of Resemble AI's checkpoints
  (MIT): https://huggingface.co/delebash/chatterbox-turbo-GGUF and
  https://huggingface.co/delebash/chatterbox-nano-GGUF

> **Removed 2026-07-29: pedalboard (Spotify, GPL-3.0).** It was the only copyleft dependency the
> project ever *distributed*, and the sole reason for the 2026-06-08 Apache-2.0 → GPL-3.0-or-later
> flip.
>
> One copyleft component is *reachable* — eSpeak NG (`GPL-3.0`), downloaded with the speech
> runtime. It relicenses nothing, because JustVoice never redistributes it and never links it
> in-process. Redistribution plus in-process linkage is what propagated with pedalboard; see
> `LICENSES.md` → *Downloaded on demand*.

---

## How to update this file

- Adding a dependency that ships: add its row to `LICENSES.md`; here, its BSD copyright line, its
  Apache-2.0 `NOTICE` content if it has any, and a line for any other licence that asks for its text
  to travel (BlueOak, OFL); confirm `LICENSES/<SPDX>.txt` exists for a licence several share.
- Code copied from another project: a section under *Code lifted*, the notice kept in the file (the
  family rule).
