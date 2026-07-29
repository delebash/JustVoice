# LICENSES

Authoritative inventory of third-party software shipped with, bundled into, or installed alongside JustVoice. Full license texts live in `LICENSES/<SPDX-id>.txt`. Per-component attribution detail lives in `NOTICE.md`.

JustVoice is **MIT** (see `LICENSE`), and **nothing in the table below constrains that.** Every row is permissive.

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
| **sherpa-onnx** / **sherpa-onnx-python** | `>=1.13` (extra: `kokoro`) | `Apache-2.0` | ✓ | ✓ (GPLv3 only) | https://github.com/k2-fsa/sherpa-onnx |
| **chatterbox-tts** | `>=0.2` (extra: `chatterbox`) | `MIT` | ✓ | ✓ | https://github.com/resemble-ai/chatterbox |
| **qwen-tts** | `>=0.1` (extra: `qwen3`) | verify upstream | TBD | TBD | (verify) |
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
- **AGPL** — would force the combined work to AGPL-3.0. CI gate (`pip-licenses --fail-on AGPL-3.0...`) blocks AGPL deps.
- **Anything copyleft** — GPL or LGPL — needs a decision, not a row. GPL relicenses the whole product (that is what pedalboard did); LGPL is survivable but only via dynamic linking, with notice and source-availability obligations attached.

## Refresh policy

- On every dependency bump, re-verify the SPDX id against the upstream repository's `LICENSE` file (PyPI classifiers occasionally lie).
- On every Apache-2.0 dep bump, diff the upstream `NOTICE` against `NOTICE.md`'s snapshot.
- On any novel license appearing (`pip-licenses` whitelist check fails), open an issue, add `LICENSES/<SPDX>.txt`, add a row here, and add a section in `NOTICE.md` before merging.
- Before adding any GPL or LGPL dependency, read the row above about copyleft. `pedalboard` was added without that step in June 2026 and cost the project its permissive licence for seven weeks.
