# LICENSES

Authoritative inventory of third-party software shipped with, bundled into, or installed alongside JustVoice. License texts live in `LICENSES/<SPDX-id>.txt`. Per-component attribution detail lives in `NOTICE.md`.

> `LICENSES/` holds `MIT.txt`, `Apache-2.0.txt`, `BSD-3-Clause.txt` and `OFL-1.1.txt` — the licences
> most of the distributed set is under (OFL-1.1: the bundled fonts, whose condition 2 asks each copy to
> carry the font's copyright notice and the licence). Apache-2.0 §4(a) and BSD-3-Clause cl. 1–2 require
> the licence text to accompany a redistribution, which is why these are files here and not links. Each
> is the canonical upstream text (MIT, Apache and BSD with the `<year> <owner>` placeholder); per-component
> copyright holders belong in `NOTICE.md`, not in these shared texts. The rest — ISC, BlueOak-1.0.0 —
> are each package's own `LICENSE`, and `NOTICE.md` names them.
>
> **What the installer carries (since 2026-11-06):** `LICENSE`, `NOTICE.md` and `LICENSES/` beside the
> executable, with `THIRD_PARTY_NOTICES.md` — the name, version, licence and licence text of every
> package bundled into the renderer, written by Vite at build time (`build.license`,
> `quasar.config.js`); the headless server serves the same file with the page. Electron's own
> (`LICENSE.electron.txt`, `LICENSES.chromium.html`) electron-builder adds, and the server's packages
> keep their `LICENSE` files inside the app. Vite's file lists only what JavaScript imports, so the
> fonts (imported by CSS) are in `NOTICE.md` and `LICENSES/OFL-1.1.txt` instead.
>
> No text is owed for the GPL: eSpeak NG is not redistributed, and shipping the GPL text would wrongly
> imply that it is.

JustVoice is **MIT** (see `LICENSE`), and **nothing it distributes constrains that.** Every row in the table below is permissive.

Two categories are inventoried here, and the difference between them is what decides whether a licence can propagate at all:

- **Distributed** — what the installer carries (refreshed 2026-11-05, after the move to Electron and a Node server on 2026-10-08): the Electron shell, the renderer bundle, the server and the family kit's packages with their npm dependencies inside the app, and `audiocpp_dsp` beside the executable. These form a combined work with JustVoice, so a copyleft licence here relicenses the whole product. That is exactly what `pedalboard` did.
- **Downloaded on demand** — what the app fetches onto the user's machine when the user installs or loads something: the audio.cpp speech runtime, eSpeak NG, the Japanese dictionary and the speech models. JustVoice never redistributes these, and the runtime runs as a separate process. eSpeak NG is `GPL-3.0` and does **not** propagate — see *Downloaded on demand* below for why.

The project was GPL-3.0-or-later between 2026-06-08 and 2026-07-29, forced by exactly one dependency: `pedalboard`, which is GPL-3.0 because it statically links JUCE. It was removed on 2026-07-29 and its twelve effects reimplemented first in Python on numpy + scipy and, since 2026-10-07, in C++ in JustVoice's copy of audio.cpp (`dsp/`, shipped as `audiocpp_dsp`), with pitch shifting by Signalsmith Stretch (MIT). See `NOTICE.md` for the full license history.

**The rule that keeps this true:** a copyleft dependency does not just add a row here, it relicenses the whole product. Check the SPDX identifier against the upstream `LICENSE` file before adding anything — a package's `license` field is not always right.

**Direct dependencies that ship** (the installed versions, checked against each package's `package.json` and `LICENSE` on 2026-11-05; their own dependencies ship too and are audited the same way — *Refresh policy*):

| Component | Version | SPDX license | Source URL |
|---|---|---|---|
| **electron** (the desktop shell; Chromium's and Node's own notices ship beside it as `LICENSES.chromium.html`) | 44.10.0 | MIT | https://github.com/electron/electron |
| **vue** | 3.5.43 | MIT | https://github.com/vuejs/core |
| **vue-router** | 5.4.0 | MIT | https://github.com/vuejs/router |
| **vue-i18n** | 11.4.16 | MIT | https://github.com/intlify/vue-i18n |
| **pinia** | 4.0.3 | MIT | https://github.com/vuejs/pinia |
| **quasar** + **@quasar/extras** | 2.35.0 / 2.1.0 | MIT | https://github.com/quasarframework/quasar |
| **@vueuse/core** + **@vueuse/integrations** | 15.0.0 | MIT | https://github.com/vueuse/vueuse |
| **@floating-ui/dom** | 1.8.0 | MIT | https://github.com/floating-ui/floating-ui |
| **@internationalized/number** | 3.6.9 | Apache-2.0 | https://github.com/adobe/react-spectrum |
| **dom-accessibility-api** | 0.7.1 | MIT | https://github.com/eps1lon/dom-accessibility-api |
| **dompurify** | 3.4.17 | MPL-2.0 OR Apache-2.0 (taken as Apache-2.0) | https://github.com/cure53/DOMPurify |
| **marked** | 18.1.0 | MIT | https://github.com/markedjs/marked |
| **front-matter** | 4.0.2 | MIT | https://github.com/jxson/front-matter |
| **github-slugger** | 2.0.0 | ISC | https://github.com/Flet/github-slugger |
| **qrcode** | 1.5.4 | MIT | https://github.com/soldair/node-qrcode |
| **sortablejs** | 1.15.7 | MIT | https://github.com/SortableJS/Sortable |
| **Fontsource fonts** (Inter, JetBrains Mono — `src/css/fonts.css`; the kit's sixteen are not in JustVoice's build) | 5.3.x | OFL-1.1 | https://github.com/fontsource/font-files |
| **hono** + **@hono/node-server** | 4.13.13 / 2.1.4 | MIT | https://github.com/honojs/hono |
| **better-sqlite3** (carries SQLite, public domain) | 13.0.3 | MIT | https://github.com/WiseLibs/better-sqlite3 |
| **typebox** | 1.3.36 | MIT | https://github.com/sinclairzx81/typebox |
| **ajv** + **ajv-formats** | 8.20.0 / 3.0.1 | MIT | https://github.com/ajv-validator/ajv |
| **undici** | 8.12.3 | MIT | https://github.com/nodejs/undici |
| **@fastify/busboy** | 3.2.2 | MIT | https://github.com/fastify/busboy |
| **@modelcontextprotocol/sdk** | 1.32.1 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| **zod** | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| **diff** (jsdiff — the take check's word diff) | 9.0.0 | BSD-3-Clause | https://github.com/kpdecker/jsdiff |
| **lru-cache** | 11.5.3 | BlueOak-1.0.0 | https://github.com/isaacs/node-lru-cache |
| **@anthropic-ai/sdk** | 0.132.1 | MIT | https://github.com/anthropics/anthropic-sdk-typescript |
| **openai** | 7.31.0 | Apache-2.0 | https://github.com/openai/openai-node |
| **@google/genai** | 2.28.0 | Apache-2.0 | https://github.com/googleapis/js-genai |
| **@noble/hashes** | 2.4.0 | MIT | https://github.com/paulmillr/noble-hashes |
| **koffi** (native calls) | 3.3.2 | MIT | https://github.com/Koromix/koffi |
| **proper-lockfile** | 4.1.2 | MIT | https://github.com/moxystudio/node-proper-lockfile |
| **electron-context-menu** | 5.1.0 | MIT | https://github.com/sindresorhus/electron-context-menu |
| **electron-updater** | 6.8.9 | MIT | https://github.com/electron-userland/electron-builder |
| **audiocpp_dsp** (the server's audio math, from JustVoice's copy of audio.cpp — vendors Signalsmith Stretch and Linear, MIT; ports parts of SciPy and NumPy, BSD-3-Clause: NOTICE.md) | the kit's pinned build | Apache-2.0 | https://github.com/delebash/audio.cpp |
| **Microsoft Visual C++ runtime** (Windows: `vcruntime140*.dll`, `msvcp140*.dll` beside `audiocpp_dsp`) | 14.x | Microsoft's redistributable terms | https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files |

**Not distributed** — the build, lint and test tools: `@quasar/app-vite`, `vite`, `@vitejs/plugin-vue`, `electron-builder`, `@biomejs/biome`, `eslint` and its plugins, `vitest`, `@vue/test-utils`, `jsdom`, `playwright` / `@playwright/test`, `postcss`, `autoprefixer` — all MIT or Apache-2.0 (Biome MIT OR Apache-2.0).

## Compatibility legend

Under MIT everything listed above is clear: an MIT project can consume any permissive licence, and MIT code can flow into an Apache-2.0 or GPL-3.0 downstream work. Apache-2.0 is GPLv3-compatible but **not** GPLv2-compatible.

- **AGPL** — would force the combined work to AGPL-3.0 if distributed. **There is no CI gate for this** (GitHub Actions are off), so the only thing enforcing this file is a person following the refresh policy below. Worth building — it is the one check that would have caught `pedalboard` in June 2026 before the relicense.
- **Anything copyleft** — GPL or LGPL — needs a decision, not a row. A copyleft dependency that is **distributed** relicenses the whole product (that is what pedalboard did); LGPL is survivable but only via dynamic linking, with notice and source-availability obligations attached. A copyleft dependency that is only **installed on demand** is a different case with a different answer — see the next section.
- **MPL-2.0** (DOMPurify's other choice) is file-level copyleft; DOMPurify is taken under its Apache-2.0 option instead.

## Downloaded on demand — not distributed

None of this is part of a release. Each item is fetched onto the user's machine, from its publisher,
when the user installs the speech runtime (AI Settings → Speech) or downloads a model.

| Component | When it is fetched | SPDX license | Distributed by JustVoice |
|---|---|---|---|
| **audio.cpp** (the speech runtime: prebuilt release archives of JustVoice's copy, github.com/delebash/audio.cpp, at the kit's pinned build — `v0.9.2-jv.6` on 2026-11-05) | Install speech runtime | `Apache-2.0` (Copyright 2026 ShugoAI LLC; the archive ships no `NOTICE`) | no |
| **MeCab** 0.996 (`libmecab`, Japanese readings — inside the runtime archive, with its `libmecab.LICENSE.txt`) | Install speech runtime | `BSD-3-Clause` | no |
| **cppjieba's dictionaries** (`jieba/`, Chinese word breaks — inside the runtime archive, with its `LICENSE`) | Install speech runtime | `MIT` | no |
| **NVIDIA CUDA runtime libraries** (`cudart`, `cuBLAS`, `cuFFT` — inside the CUDA archive) and the **Microsoft Visual C++ runtime** (Windows archives) | Install speech runtime | NVIDIA's CUDA EULA (redistributable components) · Microsoft's redistributable terms | no |
| **Japanese dictionary** — unidic-lite 1.0.8 (MIT) carrying UniDic 2.1.2 (offered under BSD, GPL or LGPL; taken under `BSD-3-Clause`), with its licence files | Install the dictionary add-on | `MIT` + `BSD-3-Clause` | no |
| **eSpeak NG** (library + data, via the `espeakng-loader` wheel — loader `MIT`) | Install speech runtime | `GPL-3.0` | no |
| **Speech models** — GGUF files, each under its original model's licence | Download / first load | Each model's own: the app shows JustVoice's reading of it on the model's row and in the opened engine (*Commercial use, in plain words*, `docs/engines.md`), and a model whose commercial use isn't a plain *Yes* asks you to accept its licence before its first download. Some are non-commercial. | no |

Licences verified: audio.cpp, MeCab and cppjieba against the `LICENSE`, `libmecab.LICENSE.txt` and
`jieba/LICENSE` in the installed `v0.9.2-jv.6` CUDA archive (2026-11-05; no `NOTICE` file in it);
the loader and eSpeak NG against their GitHub repositories (2026-10-01); unidic-lite and UniDic
against their licence files (2026-10-04; Copyright 2020 Paul McCann, MIT; Copyright 2011-2017 The
UniDic Consortium, BSD-3-Clause); MeCab Copyright 2001-2008 Taku Kudo and 2004-2008 Nippon Telegraph
and Telephone Corporation, BSD-3-Clause. Each speech model's reading is checked at its source and
dated in `server/src/engines/audiocpp/curated/<family>.js` (RESEARCH §10.13). The CUDA and Visual
C++ terms are not re-read here: the archives are the fork's releases, made by its release workflow.

**Why the GPL row does not relicense JustVoice.** GPL obligations attach to the *distribution* of a
combined work, and JustVoice does not distribute eSpeak NG in any form. No JustVoice code links or
imports it: the speech runtime's install fetches the published wheel onto the user's machine,
unpacks the library and its data, and passes their paths to the audio.cpp runtime — a separate
program, in its own process — which loads it to read text for Kokoro and KittenTTS. Contrast
`pedalboard`, which genuinely did force GPL on the whole project:

| | `pedalboard` (forced GPL) | eSpeak NG (does not) |
|---|---|---|
| Dependency kind | core, non-optional | fetched at the user's request |
| In the shipped artifact? | **yes** — frozen into the Python sidecar | no |
| Who obtains it | JustVoice, and redistributes it | the user's own install, from its publisher |
| Linkage | in-process with JustVoice | inside the audio.cpp process |

Redistribution **plus** in-process linkage is the only shape that propagates. Neither half alone does.

## Refresh policy

- On every dependency bump, re-verify the SPDX id against the upstream repository's `LICENSE` file.
- On every Apache-2.0 dependency bump, check for an upstream `NOTICE` file (none of today's ship one) and copy it into `NOTICE.md`.
- On any new licence appearing, add `LICENSES/<SPDX>.txt` if it is shared by several components, a row here, and a section in `NOTICE.md` before merging.
- Before adding any GPL or LGPL dependency, read the row above about copyleft. `pedalboard` was added without that step in June 2026 and cost the project its permissive licence for seven weeks.
- **Audit transitive dependencies, not just direct ones — and audit them per install target.** `parselmouth` was never "added"; it arrived beneath `chatterbox-tts`. `npm ls --all --omit=dev` in the root, `server/` and `src-electron/` lists what ships. Where a copyleft hit lands decides the answer: in the **distributed** set it is a blocker, in the **downloaded on demand** set it is a decision to document.
- Ask which set a new dependency joins before clearing it. Something moved from a download into `dependencies` (or into the bundle) moves from *downloaded on demand* to *distributed*, and its licence has to be re-cleared under the stricter rule even though nothing about it changed.
- A new speech model or a new runtime release: re-check the model's licence at its source (its curated file's `LICENCE` reading and date), and the runtime archive's `LICENSE` (and any `NOTICE`).
