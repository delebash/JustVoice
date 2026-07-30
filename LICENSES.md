# LICENSES

Authoritative inventory of third-party software shipped with, bundled into, or installed alongside JustVoice. License texts live in `LICENSES/<SPDX-id>.txt`. Per-component attribution detail lives in `NOTICE.md`.

> `LICENSES/` holds `MIT.txt`, `Apache-2.0.txt` and `BSD-3-Clause.txt` — the three licences in the
> distributed set. Apache-2.0 §4(a) and BSD-3-Clause cl. 1–2 require the licence text to accompany
> a redistribution, which is why these are files here and not links. Each is the canonical upstream
> text carrying the `<year> <owner>` placeholder, following the convention `MIT.txt` already set;
> per-component copyright holders belong in `NOTICE.md`, not in these shared texts.
>
> No text is owed for `GPL-3.0-or-later`: `parselmouth` is not redistributed, and shipping the GPL
> text would wrongly imply that it is.
>
> BSD-3-Clause cl. 1–2 additionally require each component's *own* copyright notice, which a shared
> placeholder text cannot carry. Those five notices are reproduced verbatim in `NOTICE.md` →
> *BSD-3-Clause copyright notices*. Both obligations are therefore met: shared licence text here,
> per-component notices there.

JustVoice is **MIT** (see `LICENSE`), and **nothing it distributes constrains that.** Every row in the table below is permissive.

Two categories are inventoried here, and the difference between them is what decides whether a licence can propagate at all:

- **Distributed** — code frozen into the shipped `justvoice-server` sidecar by PyInstaller, binaries bundled as Tauri `externalBin`, and the front-end. These form a combined work with JustVoice, so a copyleft licence here relicenses the whole product. That is exactly what `pedalboard` did.
- **Installed on demand** — engine dependencies resolved from PyPI onto the user's machine, into the shared engine venv, when the user installs an engine. JustVoice never redistributes these, and each runs as a separate process. One of them is `GPL-3.0-or-later` and does **not** propagate — see *Installed on demand* below for why.

The project was GPL-3.0-or-later between 2026-06-08 and 2026-07-29, forced by exactly one dependency: `pedalboard`, which is GPL-3.0 because it statically links JUCE. It was removed on 2026-07-29 and its twelve effects reimplemented in `server/justvoice/audio/dsp/` on numpy + scipy, with pitch shifting delegated to Signalsmith Stretch (MIT). See `NOTICE.md` for the full license history.

**The rule that keeps this true:** a copyleft dependency does not just add a row here, it relicenses the whole product. Check the SPDX identifier against the upstream `LICENSE` file before adding anything — PyPI classifiers are not reliable.

| Component | Version pin | SPDX license | Apache-2.0 compatible | GPL-3.0 compatible | Source URL |
|---|---|---|---|---|---|
| **voicebox** (lifted source) | commit in `voicebox-pin.txt` | `MIT` | ✓ | ✓ | https://github.com/jamiepine/voicebox |
| **fastapi** | `>=0.115` | `MIT` | ✓ | ✓ | https://github.com/tiangolo/fastapi |
| **uvicorn** | `>=0.32` (`[standard]`) | `BSD-3-Clause` | ✓ | ✓ | https://github.com/encode/uvicorn |
| **pydantic** | `>=2.9` | `MIT` | ✓ | ✓ | https://github.com/pydantic/pydantic |
| **httpx** | `>=0.27` | `BSD-3-Clause` | ✓ | ✓ | https://github.com/encode/httpx |
| **numpy** | `>=1.26` | `BSD-3-Clause` | ✓ | ✓ | https://github.com/numpy/numpy |
| **platformdirs** | `>=4` | `MIT` | ✓ | ✓ | https://github.com/platformdirs/platformdirs |
| **typer** | `>=0.12` | `MIT` | ✓ | ✓ | https://github.com/tiangolo/typer |
| **rich** | `>=13` | `MIT` | ✓ | ✓ | https://github.com/Textualize/rich |
| **requests** | `>=2.32` | `Apache-2.0` | ✓ | ✓ | https://github.com/psf/requests |
| **psutil** | `>=5.9` | `BSD-3-Clause` | ✓ | ✓ | https://github.com/giampaolo/psutil |
| **sqlalchemy** | `>=2.0` | `MIT` | ✓ | ✓ | https://github.com/sqlalchemy/sqlalchemy |
| **python-multipart** | `>=0.0.18` | `Apache-2.0` | ✓ | ✓ | https://github.com/Kludex/python-multipart |
| **tenacity** | `>=8.2` | `Apache-2.0` | ✓ | ✓ | https://github.com/jd/tenacity |
| **cachetools** | `>=7.0` | `MIT` | ✓ | ✓ | https://github.com/tkem/cachetools |
| **fastmcp** | `>=3.0,<4.0` | `Apache-2.0` | ✓ | ✓ | https://github.com/jlowin/fastmcp |
| **llm-runner** (own repo, pinned SHA) | `git+…@e7d2f1c` | `MIT` | ✓ | ✓ | https://github.com/delebash/just-llm-runner |
| **uv** (bundled binary, `externalBin`) | `0.12.0` (pinned in `release.yml`) | `Apache-2.0 OR MIT` | ✓ | ✓ | https://github.com/astral-sh/uv |
| **sherpa-onnx** / **sherpa-onnx-python** | `>=1.13` (extra: `kokoro`) | `Apache-2.0` | ✓ | ✓ (GPLv3 only) | https://github.com/k2-fsa/sherpa-onnx |
| **chatterbox-tts** | `>=0.2` (extra: `chatterbox`) | `MIT` | ✓ | ✓ | https://github.com/resemble-ai/chatterbox |
| **qwen-tts** | `>=0.1` (extra: `qwen3`) | `Apache-2.0` | ✓ | ✓ | https://github.com/QwenLM/Qwen3-TTS |
| **torch** | `>=2.2` (extras: `chatterbox`, `qwen3`) | `BSD-3-Clause` | ✓ | ✓ | https://github.com/pytorch/pytorch |
| **peft** | `>=0.13` (extra: `training`) | `Apache-2.0` | ✓ | ✓ | https://github.com/huggingface/peft |
| **transformers** | `>=4.45` (extra: `training`) | `Apache-2.0` | ✓ | ✓ | https://github.com/huggingface/transformers |
| **safetensors** | `>=0.4` (extra: `training`) | `Apache-2.0` | ✓ | ✓ | https://github.com/huggingface/safetensors |
| **faster-whisper** | `>=1.0` (extra: `training`) | `MIT` | ✓ | ✓ | https://github.com/SYSTRAN/faster-whisper |
| **pyloudnorm** | `>=0.1` (Phase 2) | `MIT` | ✓ | ✓ | https://github.com/csteinmetz1/pyloudnorm |
| **scipy** | `>=1.11` | `BSD-3-Clause` | ✓ | ✓ | https://github.com/scipy/scipy |
| **python-stretch** (Signalsmith Stretch) | `>=0.3` | `MIT` | ✓ | ✓ | https://github.com/gregogiudici/python-stretch |
| **pytest** | `>=8` (dev) | `MIT` | ✓ | ✓ | https://github.com/pytest-dev/pytest |
| **pytest-asyncio** | `>=0.24` (dev) | `Apache-2.0` | ✓ | ✓ | https://github.com/pytest-dev/pytest-asyncio |
| **playwright** | `>=1.48` (dev) | `Apache-2.0` | ✓ | ✓ | https://github.com/microsoft/playwright-python |
| **ruff** | `>=0.7` (dev) | `MIT` | ✓ | ✓ | https://github.com/astral-sh/ruff |
| **vue** | `^3.5.0` | `MIT` | ✓ | ✓ | https://github.com/vuejs/core |
| **pinia** | `^2.3.0` | `MIT` | ✓ | ✓ | https://github.com/vuejs/pinia |
| **vue-sonner** | `^2.0.0` | `MIT` | ✓ | ✓ | https://github.com/xiaoluoboding/vue-sonner |
| **@tauri-apps/api** | `^2.x` | `Apache-2.0 OR MIT` | ✓ | ✓ | https://github.com/tauri-apps/tauri |
| **@tauri-apps/plugin-***  | `^2.x` | `Apache-2.0 OR MIT` | ✓ | ✓ | https://github.com/tauri-apps/plugins-workspace |
| **vite** | `^6.0.0` (dev) | `MIT` | ✓ | ✓ | https://github.com/vitejs/vite |

## Compatibility legend

The two compatibility columns are kept because they record *why* each dependency was cleared, and because they are what a future copyleft dep would collide with. Under MIT both are satisfied by everything listed — an MIT project can consume any permissive licence, and MIT code can flow into an Apache-2.0 or GPL-3.0 downstream work.

- **Apache-2.0 compatible** — combinable with an Apache-2.0 work.
- **GPL-3.0 compatible** — combinable with a GPL-3.0 work. Note Apache-2.0 is GPLv3-compatible but **not** GPLv2-compatible.
- **AGPL** — would force the combined work to AGPL-3.0 if distributed. **There is no CI gate for this.** This line previously claimed `pip-licenses --fail-on AGPL-3.0` ran in CI; checked 2026-07-29, no workflow performs any licence check, so the only thing enforcing this file is a human following the refresh policy below. Worth building — it is the one check that would have caught `pedalboard` in June 2026 before the relicense.
- **Anything copyleft** — GPL or LGPL — needs a decision, not a row. A copyleft dependency that is **distributed** relicenses the whole product (that is what pedalboard did); LGPL is survivable but only via dynamic linking, with notice and source-availability obligations attached. A copyleft dependency that is only **installed on demand** is a different case with a different answer — see the next section.

## Installed on demand — not distributed

Engine extras (`[chatterbox]`, `[qwen3]`, `[kokoro]`, `[all-engines]`) are **not** part of a release. `.github/workflows/release.yml` installs `./server[dev]` only — *"Install server without heavy ML extras to keep the sidecar small"* — so nothing in this section is frozen into `justvoice-server`. uv resolves these from PyPI onto the user's machine, into the shared engine venv, at the moment the user installs an engine.

| Component | Reached via | SPDX license | Distributed by JustVoice |
|---|---|---|---|
| **parselmouth** (Praat) | `chatterbox-tts` → transitive | `GPL-3.0-or-later` | no |

**Why this GPL row does not relicense JustVoice.** GPL obligations attach to the *distribution* of a combined work, and JustVoice does not distribute parselmouth in any form. It is declared in no dependency list in this repository, imported by no line of JustVoice code (verified 2026-07-29 — the only mentions anywhere in the repo are this section and its counterpart in `NOTICE.md`), and absent from the shipped sidecar. The user's own machine fetches it from PyPI at their request, and it is imported only inside a `chatterbox` engine subprocess — its own interpreter, its own venv, across a process boundary. `chatterbox-tts` itself is `MIT`; the copyleft sits one level beneath it, and chatterbox manages its own licence obligations.

Contrast `pedalboard`, which genuinely did force GPL on the whole project. The difference is not the licence — both are GPLv3 — it is the relationship:

| | `pedalboard` (forced GPL) | `parselmouth` (does not) |
|---|---|---|
| Dependency kind | core, non-optional | optional extra, transitive |
| In the shipped artifact? | **yes** — frozen by PyInstaller | no |
| Who obtains it | JustVoice, and redistributes it | the user, from PyPI |
| Linkage | in-process | separate venv, separate process |

Redistribution **plus** in-process linkage is the only shape that propagates. Neither half alone does.

**Decision, 2026-07-29: parselmouth stays.** Reviewed and accepted deliberately, on the reasoning above. It is documented as a section rather than a table row precisely because it is not a licence the product inherits — listing it alongside the distributed dependencies would imply that it is.

## Refresh policy

- On every dependency bump, re-verify the SPDX id against the upstream repository's `LICENSE` file (PyPI classifiers occasionally lie).
- On every Apache-2.0 dep bump, diff the upstream `NOTICE` against `NOTICE.md`'s snapshot.
- On any novel license appearing (`pip-licenses` whitelist check fails), open an issue, add `LICENSES/<SPDX>.txt`, add a row here, and add a section in `NOTICE.md` before merging.
- Before adding any GPL or LGPL dependency, read the row above about copyleft. `pedalboard` was added without that step in June 2026 and cost the project its permissive licence for seven weeks.
- **Audit transitive dependencies, not just direct ones — and audit them per install target.** `parselmouth` was never "added"; it arrived beneath `chatterbox-tts`. Resolve each extra and inspect the whole tree (e.g. `uv pip compile --extra chatterbox server/pyproject.toml`). Where a copyleft hit lands decides the answer: in the **distributed** set it is a blocker, in the **installed on demand** set it is a decision to document.
- Ask which set a new dependency joins before clearing it. A dep promoted from an engine extra into core `dependencies` moves from *installed on demand* to *distributed*, and its licence has to be re-cleared under the stricter rule even though nothing about the dep itself changed.
