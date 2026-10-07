<!-- SPDX-License-Identifier: MIT -->
# The family moves to Electron and a Node server — the study

**Status:** study done 2026-10-05; the rulings are in §9 (all decided that day except whether a
Mac is available for iOS builds). The plan, with the step-0 spikes, is
[`2026-10-07-electron-node-plan.md`](2026-10-07-electron-node-plan.md) (written 2026-10-07,
waiting for approval). Tracker: `docs/dev/TASKS.md` → "The family moves to
Electron and a Node server; Tauri and Python go — the study first". Facts land in
`docs/dev/RESEARCH.md` §6 (JustVoice) and `../just-llm-runner/docs/dev/RESEARCH.md` (the shared
stack) in the same change.

## 0 · What was decided, and what this study is for

The user, 2026-10-05, after three answers in chat: *"i think we go with electron and drop tauri
either ionic aor capawesome but do the study go"*. The lean they took:

- **Electron on desktop, Capacitor on phones, a Node server**, in plain JavaScript.
- Against Tauri + a Node sidecar, Electron drops Rust and the sidecar spawn and supervision
  code; runs one runtime instead of two; uses the same browser as the smoke gate on every OS.
- ASP.NET Core was rejected: a third language, and its speed is moot — the heavy work runs in
  audio.cpp and llama.cpp.
- Family-wide: JustVoice, JustWrite, docgen and the kit (the 2026-08-14 sameness law).

**Where it came from.** IDEAS 2026-10-02, "No Python at all" (folded in here and removed from
IDEAS): the user — *"we could rewrite the llm runner mostly in javascript with a little rust
backend for downloadn and system info and get rid of python all together"*; *"the reason we wen
python was becauase of the audio requirements at the time, tht has changed"*. Python came in for
the PyTorch speech engines — the 2026-06-16 record kept Tauri and rejected Electron for a
"≈150MB bundle" because "JustVoice MUST have Python (STT/TTS) anyway"
(`docs/plans/archive/2026-06-16-builtin-llm-runner.md:118-130`). Since 2026-10-01 every speech
model runs in audio.cpp, and voice training (the last PyTorch) went on 2026-10-02. The IDEAS
entry also noted that a LoRA trainer rebuilt in C++ on ggml, inside our copy of audio.cpp, would
keep the app PyTorch-free: ggml has automatic differentiation and an optimizer, but the backward
pass of Qwen3-TTS's layers, GPU support for every op it needs, and the training loop would all
have to be built. (Its line counts — ~33,000 JustVoice, ~26,000 kit — are superseded by §3.2.)

**What the IDEAS entry said to settle before deciding**, and where each lands here:

1. the runtime's size against today's PyInstaller sidecar → §1;
2. a JavaScript or WebAssembly replacement for each piece of audio math, compared output for
   output → §2;
3. how headless mode, MCP and JustWrite's link would work → §6;
4. the order to move the pieces in → §8.

Added by this conversation: every Python dependency's JavaScript equivalent (§3), everything the
Tauri shells do and Electron's way of doing it (§4), and the phones (§5).

**Evidence tags** (the register's): **measured** (run on this machine — Windows 11, RTX 2070
SUPER 8 GB), **code** (`file:line`), **web** (URL, checked 2026-10-05), **agent** (found by a
study agent and not re-checked by this session).

---

## 1 · Sizes, memory and startup — measured 2026-10-05

| | Today: Tauri + Python | Electron 44.5.1 |
|---|---|---|
| Shell binary | `justvoice.exe` 19.1 MB (release build of 2026-06-10); JustWrite 13.2 MB; docgen 10.5 MB | `electron.exe` 245.7 MB; the runtime folder 368 MB unpacked |
| The server | PyInstaller onefile **76.9 MB** (below) | Node is already inside Electron; a plain `node.exe` (v26.5.0) is 103.3 MB |
| Installer | not built today (no release has ever shipped the sidecar — below); JustWrite 1.0.0 NSIS was 10.9 MB, without a sidecar | **111.7 MB** NSIS (electron-builder, asar), **370 MB** installed — a probe app holding JustVoice's `dist/` (3 MB) |
| Window memory, the same JustVoice UI, Windows | justvoice.exe + 7 WebView2 processes: **~543 MB working set, ~322 MB private** (dev build, window in use for hours) | 5 processes: **510 MB working set, 256 MB private** on the dev UI (`localhost:1430`); **455 MB / 204 MB** on the built UI (`17494/ui/`) — fresh windows, 45 s after load |
| The server's memory | the Python server: 214 MB working set, 1,160 MB private (in use, models loaded elsewhere) | not measured — no Node server exists yet |
| Cold start | frozen sidecar to `--help`: **6.7–8.1 s** (onefile unpacks to temp on every launch); unfrozen `import justvoice.app`: 2.6–5.5 s | Node itself starts in 0.06–0.08 s; a full Node server not measured; the Electron window loaded the built UI in 0.47 s |

What the table says:

- **The installer grows by about 35 MB** — 112 MB Electron against roughly 96 MB uncompressed
  for today's shell + sidecar (the onefile is already compressed, so today's installer would be
  close to that). The 2026-06-16 worry was "≈150 MB"; measured, it is 112 MB. JustVoice's real
  footprint is the speech runtime (CUDA 12.4 build 439 MB + 579 MB runtime, IDEAS 2026-09-30)
  and the GGUF models.
- **Memory is not worse on Windows.** WebView2 is Chromium too; the Electron window used less
  private memory than the WebView2 one. The comparison is rough — the WebView2 window had been in
  use, the Electron ones were fresh — but nothing suggests Electron costs more here. On macOS and
  Linux, Tauri uses the system WebKit, which is lighter; not measured.
- **Startup gets much faster.** Today's frozen server spends 7 s before it can even print help.

How it was measured (scripts in the session scratchpad, re-runnable):

- **Electron probe** — a 30-line `main.js` loading a URL in a 1280×800 `BrowserWindow`, reporting
  `app.getAppMetrics()` 30 s and 45 s after `did-finish-load`. Electron 44.5.1 reports Chromium
  152.0.7977.130 and Node 24.21.0; `require('node:sqlite')` opened a database in its main
  process with no flag. Packaged with electron-builder (latest) `--win nsis`, `asar: true`.
- **Tauri window** — the running dev app (PID tree of `src-tauri\target\debug\justvoice.exe`,
  `Get-Process` working set and private bytes, children found through `Win32_Process`).
- **The frozen server** — a scratch venv (uv, Python 3.12) holding a copy of the tracked
  `server/` and the kit's `llm_runner/`, then the release recipe
  (`.github/workflows/release.yml:68-74`).

**FINDING — the release recipe's sidecar dies on start.** `pyinstaller --onefile
server/justvoice/__main__.py --name justvoice-server` builds an 8.2 MB exe that fails at once:
`ImportError: attempted relative import with no known parent package` — `__main__.py:25` is
`from .serve import main`, and PyInstaller runs the file as a top-level script, not as part of
the package. Its own docstring says the file was added because "no release has ever produced a
Python sidecar"; it still can't. With an absolute-import entry (`from justvoice.serve import
main`) and `--collect-submodules justvoice --collect-submodules llm_runner --collect-data
justvoice` it builds **76.9 MB** and runs. *measured.* Moot if the move happens; real if it
doesn't.

---

## 2 · The audio math in JavaScript

Ported and compared by an agent, 2026-10-05 (*measured*: the app's own Python functions against
plain-JavaScript ports, Node 26.5.0, the same inputs — the five cached 24 kHz renders from the
real data dir, 10.4 s tiled to 60 s, plus sweeps, noise and impulses; best of 3). Re-runnable:
`run_all.sh` in the session scratchpad's `audio-math/` (`py_ref.py` runs the app's functions,
`dsp.mjs` holds the ports, `compare.py` writes the comparison). Code facts marked ✓ were
re-checked by this session.

**The answer: everything ports to plain JavaScript with the same output, except Signalsmith
Stretch (pitch shift and speed).** No npm package is needed for anything else.

### 2.1 Piece by piece

| Piece | Where | JS | Difference from Python | Python vs JS, 60 s |
|---|---|---|---|---|
| gain, highpass, lowpass, EQ low/mid/high, delay, reverb (Freeverb) | `audio/dsp/__init__.py:56`, `biquad.py:46-105` (scipy `lfilter`/`sosfilt`), `delays.py:21`, `freeverb.py:104` | hand ports, following scipy 1.18.0's C/Cython loops in the same operation order | **0** — bit-identical | e.g. reverb 310 vs 140 ms; EQ 9.3 vs 5.6 ms |
| distortion (tanh), chorus (LFO sine + `np.interp`), compressor on noise (exp/pow) | `dsp/__init__.py:61`, `delays.py:57`, `dynamics.py:62` | hand ports | float error only (≤ 4.5e-13) — 1-ulp differences between numpy/the C runtime and V8's maths; **0** differing 16-bit samples through every chain | chorus 122 vs 56 ms |
| the whole effects chain, four shipped presets | `audio/effects.py:105` | hand port incl. numpy's dtype rules | Robotic, Radio, Echo Chamber (mono and stereo): **0** differing 16-bit samples. Deep Voice: 21 % of samples differ, max 111 LSB — from its pitch shift | — |
| resampling (`resample_poly`, Kaiser polyphase) | `render_core.py:941` (`_conform_pcm`), `engines/audiocpp/slot.py:540` (`as_16k_mono`) | hand port of `resample_poly`, `firwin`, `kaiser`, cephes `i0`, `upfirdn` | **0** differing 16-bit samples | JS slower (37 vs 143 ms — float32 emulated with `Math.fround`, not optimised) |
| crossfade joins | `audio/chunked.py:184` | hand port incl. `linspace` | **0** | 0.5 vs 1.2 ms |
| analyzer (peak, RMS, crest, silence, clipping, noise margin) | `audio/analyzer.py:19, 50` | hand port incl. numpy's pairwise sum and percentile | **0** on all six values | 17 vs 14 ms |
| gain for delivery | `delivery.py:16` | hand port | **0** | — |
| Kokoro blends (weighted sum, recombine) | `engines/blending.py:292, 315` | hand port | **0** | — |
| ACX mastering | `mastering.py:140`, chain `:174` | it's an ffmpeg subprocess — the same argv from Node's `child_process` | **byte-identical** output | 853 vs 799 ms |
| integrated LUFS (EBU R128) | pyloudnorm 0.2.0 — but see 2.2 | hand port of K-weighting + gating | ΔLUFS **0** on four inputs | 38 vs 85 ms |
| **pitch shift, speed** | `dsp/__init__.py:66, 108` → python-stretch; speed via `render_core.py:429` | Signalsmith's official MIT WASM — built from commit `ffa45981`, the exact library python-stretch 0.3.1 compiles; also npm `signalsmith-stretch` 1.3.2 | **differs**: pitch 34–57 dB SNR; speed 13.5–58 dB SNR; spectra within 0.007 dB (pitch) | pitch 301 vs 229 ms — the WASM is faster than the native wheel |

The trivial parts — int16 ↔ float, WAV read/write, silence and joins, channel mean/duplicate —
are one line of JavaScript each (typed arrays, a `DataView` over the 44-byte header). One trap:
`slot.py:568` rounds half-to-even (`np.round`), so JavaScript must not use `Math.round` there.

### 2.2 What can't be matched, and what was found on the way

1. **Signalsmith Stretch can't reproduce today's numbers — in any build.** The library is
   that sensitive itself: nudging half the input samples by one ulp moves the *Python* output by
   36–61 dB SNR (pitch) and 22–72 dB (speed), the same size as Python-vs-JS. The outputs line
   up at lag 0 (no offset error). And **today's output isn't repeatable either**: the default
   constructor seeds from `std::random_device`, used when the internal ratio exceeds 2 — at
   speed 0.5 whenever the hop `int(0.03·sr)` is odd, i.e. 22.05 kHz and 44.1 kHz; two Python
   runs at 22.05 kHz differ by up to 0.295. 24, 48 and 16 kHz are deterministic. Options:
   - **(a)** adopt the official WASM (MIT) and bump `DSP_VERSION` — the npm package is an
     AudioWorklet wrapper, so vendor its Emscripten factory; its C wrapper keeps one global
     instance, so one module instance per concurrent job;
   - **(b)** build our own WASM from its 2 KB `main.cpp` with a seeded constructor —
     deterministic, version pinned; emsdk not installed here, not tried;
   - **(c)** move pitch and speed into our audio.cpp fork — the library is header-only MIT C++,
     so it compiles natively with a fixed seed, and speed could happen where the line is
     rendered.
2. ✓ **pyloudnorm is never used.** Declared in `server/pyproject.toml:27`; no module or test
   imports it. ACX QC uses the analyzer's RMS/peak (`export_audiobook.py:167-180`); loudness
   normalisation is ffmpeg's `loudnorm`. **`docs/mastering.md:19` is stale** — it says the
   analyzer measures with pyloudnorm.
3. ✓ **The Kokoro "mean" blend changes in its last bits on every server restart.**
   `_kokoro_pack` returns the voice names as `set(pack)` (`engines/blending.py:212`), and
   `_kokoro_pack_mean` (`:227-238`) sums float32 voices in that order — which follows Python's
   per-process string hashing (PYTHONHASHSEED is never set). Measured: three seeds, 82 % of
   values differ, max 4.5e-8. A port should sum in `voices.json` order.
4. **Render-cache keys would change under a naive port.** `effects_chain_hash`
   (`audio/effects.py:181`) hashes Python's `json.dumps`, which writes `1.0` where JavaScript's
   `JSON.stringify` writes `1` — Echo Chamber's key goes `ebc7a2a156e4b662` → `4696e11b79d4afe1`.
   `delivery.canonical_json` (`delivery.py:26`) has the same shape. Either reproduce Python's
   float formatting in the key builder, or accept one cache invalidation (item 1 forces one
   anyway).
5. ✓ **`as_16k_mono` can be deleted, not ported.** It works around audio.cpp v0.9.0 giving
   aligner seconds at the input rate (`slot.py:540-546`); RESEARCH §1.3 records that fixed in
   our build jv.1, and the app pins jv.4.

Sample rates in use (*code*): 24 kHz for every engine but VoxCPM2 (`render_core.py:868`), 48 kHz
for VoxCPM2 (`:976-979`), 16 kHz for the aligner (`slot.py:528`), 22.05 kHz as a fallback
(`render_core.py:894,897`); the 44.1/48 kHz master presets are done in ffmpeg.

Rejected on licence: rubberband-wasm (GPLv2), soundtouchjs (LGPL-2.1),
`@soundtouchjs/audio-worklet` (MPL-2.0, a different algorithm).

---

## 3 · The server in JavaScript — every Python dependency's equivalent

Mapped by an agent, 2026-10-05 (*agent*: code read with `file:line`; npm facts from the registry
that day; probes in Electron 44.5.1 and Node 26.5.0 in the session scratchpad's `deps-map/`).
Marked ✓ = re-checked by this session.

### 3.1 Four premises in the brief were wrong

1. **JustVoice's wire format is snake_case, and nothing generates a client from OpenAPI.**
   `models.py` has 284 snake_case fields and one camelCase (`apiVersion`, `models.py:46`); the
   renderer reads e.g. `vram_mb`. Only the kit is camelCase (`llm/schema.py:11-17`;
   `runner/schema.py:20-26` with `alias_generator=to_camel`). OpenAPI's only users: the dev CLI,
   a boot test's path list, and Settings' `/docs` link. So the JS server must keep each app's
   field names, not "the OpenAPI shape".
2. ✓ **JustWrite never calls JustVoice at runtime.** "The handoff is a FILE export, not live
   HTTP… JW never calls JV at runtime" (`docs/dev/design-decisions.md:101-104`). The IDEAS
   entry's "JustWrite drives JustVoice over HTTP" was wrong.
3. ✓ **`justvoice-server serve` uses argparse, not typer** (`server/justvoice/serve.py:14`);
   typer is only the dev `cli.py`.
4. ✓ **Declared, never imported**: JustVoice `requests`, `rich`, `pyloudnorm`; JustWrite
   `typer`, `platformdirs`, `httpx` (only for TestClient).

### 3.2 Size

| Repo | Server source (files / lines) | Tests (files / lines) | Test functions | Routes | Tables |
|---|---|---|---|---|---|
| JustVoice `server/justvoice` | 176 / 36,380 | 113 / 19,924 | 971 | 188 | 23 |
| kit `llm_runner` | 70 / 25,941 | 61 / 19,215 | 1,019 | 119 | 26 |
| JustWrite `server/justwrite_server` | 33 / 5,863 (2,201 are seed data) | 24 / 2,347 | 128 | 46 | 35 |
| docgen `server/just_ai_i18n_docgen` | 31 / 4,975 | 19 / 2,477 | 155 | 32 | 1 |
| **Total** | **310 / 73,159** | **217 / 43,963** | **2,273** | **385** | **85** |

The Rust that goes: JustVoice 2,738 lines of `.rs` (`lib.rs` 1,025 + `audio_capture/` 956 +
the rest; the agent's 1,782 left out `audio_capture/`), JustWrite 844, docgen 613. *code.* (The "~8,200 lines" for JustWrite earlier in this
conversation was source plus tests.)

### 3.3 Each dependency and mechanism

| Python | Where | JavaScript | Gap / risk |
|---|---|---|---|
| FastAPI + uvicorn + Starlette | 385 handlers; middleware JV `app.py:156-205`; static UI `app.py:400` | **Fastify** 5.12.5 (MIT), `@fastify/static`, `@fastify/cors` | Fastify's body limit defaults to 1 MiB; JustWrite's book import posts a base64 zip as JSON — raise it |
| the kit's mountable routers | `install_llm(app, engine=, session_factory=, …)` mounts ~25 routers (`install.py:74-373`) | a Fastify plugin with the same factory-with-callbacks shape; the kit as an npm `file:`/workspace dependency (a symlink, like today's editable install) | none |
| `Depends(get_db)` | JV 88, JW 42 | a db handle passed to the plugin | one synchronous connection: a transaction must never stay open across an `await` |
| pydantic models | JV 242 classes, kit 92, JW 11; 211 `response_model=`; no validators | **zod** 4.6.5 (MIT; `z.toJSONSchema`) or **TypeBox** 0.34 (MIT), with Fastify's ajv | ajv's coercion isn't pydantic's; nested defaults need `default: {}` at every level — and the Settings defaults define every operator knob |
| the 422 error shape | kit `errors.py:106-168`; the renderer parses `detail` as a string or `[{msg}]` | a Fastify error handler mapping to the same shape | ~50 lines, must match exactly |
| SQLAlchemy ORM | old-style declarative, no relationships, no Alembic; ~360 `.query(` sites (JV 222, kit 100, JW 36, docgen 3); `create_all` + idempotent ALTERs | driver **better-sqlite3 13** or built-in **`node:sqlite`**; query layer **Kysely** 0.29.6 (MIT) or raw SQL (Drizzle's `node:sqlite` driver is only in its 1.0 RC) | volume, low risk; the 29 DateTime columns are naive `YYYY-MM-DD HH:MM:SS.ffffff` — parse as UTC |
| backup/restore table lookup | `metadata.sorted_tables`, `PRAGMA table_info`, `VACUUM INTO`, `ATTACH` (kit `platform/data_api.py`) | both drivers run `VACUUM INTO` and `ATTACH` (*measured* in Electron 44); a topological sort over `PRAGMA foreign_key_list` | ~20 lines |
| SSE and streamed downloads | JV `sse_streams_api.py:30-120`, `extraction_api.py:712`; kit `prompts.py:799`; docgen `workspace_api.py:599`; zip/WAV streams | `reply.raw.write` / `Readable.from(asyncGen)`; the request's `close` event | none; no websockets anywhere |
| **threads and blocking work** | JV render jobs, synth scheduler, installer, engine manager, extraction worker; the kit's 9 threads, a thread pool, download workers; 23 sync handlers in JV, all 32 in docgen; e.g. `POST /v1/engines/{id}/load` sleeps-polls up to 60 s (`runtime.py:417-430`) | async/await for all I/O; `worker_threads` only for CPU work | **the hardest part** — every synchronous chain becomes async all the way down (kit `lifecycle.py` 3,742 lines, `manager.py` 1,996, JV `runtime.py`), and each critical section that crosses an `await` needs a new design |
| **spawning and killing llama-server, audio.cpp, ffmpeg** | the kit's one spawn function with a Windows Job Object (kill-on-close, via ctypes, `process.py:811-939`); JV's CREATE_NO_WINDOW + terminate/kill; leftover sweeps by command line | `child_process.spawn({windowsHide})` + our own Job Object through **koffi** 3.3.2 (MIT) | *measured*: libuv's own job lets a **grandchild survive** a hard kill (it sets SILENT_BREAKAWAY_OK); with a koffi job the grandchild died too. llama-server's router mode starts per-model children, so without it they leak VRAM. ~40 lines, critical. koffi loads in Electron 44.5.1 |
| GPU/RAM probes | no NVML: nvidia-smi, rocm-smi, typeperf, CIM, registry, `GlobalMemoryStatusEx`, /proc, vm_stat (kit `hardware.py`); psutil for cores + process scan | `execFile` the same tools; `os.totalmem/freemem` read the same Windows/Linux sources; `systeminformation` (MIT) or the kit's non-psutil paths | low; the RAM-bandwidth probe's calibration factor must be re-measured |
| downloads | the kit's chunk-queue downloader (`download.py`, 410 lines), HF REST, JV `speech_cache.py` | `fetch` + `p-limit` + positioned writes; `undici` Agent | undici's header/body timeouts default to **300 s**, below JV's 900 s request limit; `fetch` ignores `HTTP(S)_PROXY` unless `NODE_USE_ENV_PROXY=1` |
| GGUF parsing | kit `gguf.py`, 520 lines of `struct.unpack` | hand port on `Buffer` + BigInt | none |
| atomic writes | `storage/atomic.py` | `filehandle.sync()` + `fs.rename` (libuv: `MoveFileExW(REPLACE_EXISTING)` + `FlushFileBuffers`) | none |
| CLI | argparse + an unrolled uvicorn server, 3 s graceful stop (`serve.py:83-96`) | `util.parseArgs` | none |
| tests | TestClient: JV 153, kit 69, JW 50, docgen 17; `monkeypatch.setattr`: JV 431, kit 272 | **vitest** (the apps run 4.1.x) + `fastify.inject` | a vitest spy doesn't catch calls from inside the same module: ~450 patch targets need injection points in the production code |
| multipart uploads | JV 14 files | `@fastify/multipart` | default file size 1 MiB — raise |
| cachetools, tenacity | voice-preview TTL caches, the render LRU; webhook retries | `lru-cache` (BlueOak-1.0.0), `p-retry` (MIT) | none |
| openai / anthropic / google-genai | the kit's provider adapters | `openai` 7.28 (Apache-2.0), `@anthropic-ai/sdk` 0.131 (MIT), `@google/genai` 2.27 (Apache-2.0) | none found (the `.d.ts` files carry every call the kit uses); Gemini's fields become camelCase |
| fastmcp | `mcp/server.py:47-97`, 4 tools, a ContextVar for the client id | `@modelcontextprotocol/server` 2.3 + `/fastify` (Apache-2.0), or the v1 `@modelcontextprotocol/sdk` 1.32 (MIT); ContextVar → `AsyncLocalStorage` | simpler than today |
| **regex and text** | `\w`/`\b`: JV 22 (extraction, names, pronunciation), docgen 8 (translation checks), kit 3; `casefold` (`names.py:35`); `difflib.SequenceMatcher` (`alignment.py:64`) | `\p{L}` with `/u`; `normalize('NFKC')`; a hand-ported SequenceMatcher | **silent wrong results**: JavaScript's `\w`/`\b` are ASCII-only — wrong on he/ru/zh/ja and on docgen's translations; no `casefold` |
| archives, logging, the rest of stdlib | zipfile, tarfile; daily-rotated logs + a memory ring | `yazl`/`yauzl`/`fflate`, `tar`; `pino` + `rotating-file-stream`; `node:crypto`, `fs.cp`, `fs.statfs` | none |

### 3.4 SQLite in Node (*web* + *measured*)

- `node:sqlite` is not yet Stable in any line: Node 22 "Active development" (flag removed in
  22.13); Node 24 and 26 "Release candidate (1.2)".
- Electron 44.5.1 ships Node 24.21.0 (the 45 alpha and 46 nightlies too). *Measured:*
  `node:sqlite` works in its main process, in a `utilityProcess`, and under
  `ELECTRON_RUN_AS_NODE`, with no warning; SQLite 3.53.4.
- **better-sqlite3 13 moved to Node-API with prebuilt binaries inside the package** (13.0.0,
  2026-07-21). *Measured:* 13.0.3 loads unchanged in Electron 44.5.1 and in Node 26.5.0 — the
  old "rebuild for every Electron" cost is gone.
- Both are synchronous — the same model as today (JV's async handlers already call SQLAlchemy
  synchronously on the event loop).
- Develop on Electron's Node major (24), not this machine's 26.

### 3.5 The hard parts, hardest first

1. Threads and blocking code → async, with new designs for every critical section that spans
   an `await`.
2. The data layer: ~360 query sites over 85 tables, synchronous transactions on one connection,
   DateTime and JSON stored compatibly (unless you reset).
3. The test suite: 2,273 tests, ~44,000 lines, ~450 patch targets needing injection points.
4. The validation contract: ~345 models with the same defaults, coercion and 422 shape, plus
   body-size limits.
5. The Windows process tree — small, but without the koffi job llama-server's children leak
   VRAM.
6. Unicode regex, `casefold`, `difflib` — small, but they fail silently.
7. Network defaults: undici's 300 s timeouts, proxies, the CA store.

No single JavaScript library replaces psutil, pydantic (validation + serialisation + defaults +
OpenAPI in one class) or SQLAlchemy's session; each becomes two or three smaller pieces or
explicit code.

---

## 4 · The shell — everything Tauri does, and Electron's way

Mapped by an agent, 2026-10-05 (*agent + web*); the four headline findings re-checked by this
session in code (*code*, marked ✓).

### 4.1 What the shells really do — four findings

1. ✓ **Most of JustVoice's Rust has no caller.** The shell registers 23 commands
   (`src-tauri/src/lib.rs:918-942`); the renderer calls five — `pick_directory`,
   `storage_get_root`, `storage_relocate`, `set_keep_server_running`,
   `list_audio_output_devices` (`src/services/native.js:33-69`). The other 18 — hotkeys, paste,
   system-audio capture, the macOS permission checks, server start/stop/restart — have no caller
   in `src/`, as `native.js:18-22` already records ("recorded, not acted on (your call,
   2026-08-15: 'no on jv stuff')"). So the dictation natives — `hotkey_monitor.rs` 290 lines,
   `audio_capture/` 956, `synthetic_keys.rs` 312, `permissions.rs` 120 — **have never run in the
   app**. And `list_audio_output_devices` / `play_audio_to_devices` are placeholders (`lib.rs:612-633`:
   returns `[]`; "not yet implemented"). No dictation feature works today, so moving off Tauri
   loses none; it only decides where they get built.
2. ✓ **JustVoice's `window.__TAURI__` code is dead.** That global exists only with
   `withGlobalTauri`, which no `tauri.conf.json` sets. So JustVoice's tray listeners
   (`App.vue:425-437` — tray "Open settings", "About", "Copy URL" do nothing), the updater UI
   (`SettingsView.vue:525-576` — always "up to date") and "Open log file"
   (`SettingsView.vue:910-924` — always "requires the desktop app") never work. JustWrite and
   docgen use `window.__TAURI_INTERNALS__` (`App.vue:159`, `App.vue:68`), which does exist.
3. ✓ **No auto-updater is wired anywhere.** No `tauri-plugin-updater` in any of the three
   `Cargo.toml`; `TAURI_SIGNING_PRIVATE_KEY: ""` (`.github/workflows/release.yml:285`). Signing
   exists only as optional certificate steps (`release.yml:210-285`); JustWrite's workflow has
   none, docgen has no release workflow. The 2026-06-16 reason to keep Tauri — "auto-updater/
   signing" — was never realised for the updater.
4. **The data-dir ladder isn't in lock-step today** (*agent*): the Rust fallback is Tauri's
   `app_data_dir` (`%APPDATA%\<identifier>`), the kit's Python fallback is
   `platformdirs.user_data_dir` (`%LOCALAPPDATA%\JustVoice\JustVoice`); only Rust reads
   `dataroot.txt`; the dev install dir is `target/debug` for Rust, the checkout for Python. And
   Tauri itself writes outside the chosen root — `%APPDATA%\<id>\.window-state.json` (all three)
   and `%LOCALAPPDATA%\<id>\EBWebView` (JustVoice, JustWrite) — against the 2026-08-14 ruling.
   Copies today: JV `lib.rs:70-207`, JW `lib.rs:254-344`, docgen `lib.rs:36-124`, kit
   `llm_runner/platform/data_paths.py:41-128`.

### 4.2 Each shell item, and Electron's way

All three shells have the same family core; the Electron way needs no native code for any of it:

| Item | Today | Electron |
|---|---|---|
| The server | spawn the sidecar after a stale-port eviction (`netstat`+`taskkill` / `lsof`+`kill`), 15 s port-up watch; JV stops gracefully (`POST /v1/shutdown`, JV `lib.rs:235-257`), **JW and docgen hard-kill only** | `utilityProcess.fork(serverEntry, ['serve'], {env})` after `ready` (Electron 22+; the module must be inside the packaged app); graceful stop on `before-quit`; whether a utilityProcess outlives a hard-killed main is **unverified — spike** |
| Keep running / close | hide to tray; JW holds 400 ms so a `pagehide` autosave lands (`lib.rs:786-832`) | `win.on('close')` → `preventDefault` + hide; `window-all-closed` subscribed |
| Tray (JV 14 items) | Show/Hide, Server submenu, Dictate, MCP toggle, Settings, Copy URL, Logs, About, Quit; `tray:dictate-start` and `tray:mcp-toggle` have no listener | `Tray` + `Menu.buildFromTemplate`; Copy URL can use `clipboard` in main; Linux tray clicks vary by desktop |
| Dialogs | `pick_directory`; JW `pick_file`, `shell_save_file` (raw IPC + base64) | `dialog.showOpenDialog` / `showSaveDialog` in main; JW's save can be a plain `<a download>` (`will-download` shows a save dialog) |
| Opener | `@tauri-apps/plugin-opener` → the kit's `configureExternal` | `shell.openExternal` / `openPath` over IPC; `setWindowOpenHandler` for `_blank` |
| Window state | `tauri-plugin-window-state` (writes to `%APPDATA%`) | hand-rolled in main, stored under the data root (`electron-window-state` was last published 2018) |
| Data root + Change folder | the Rust ladder + `storage_relocate` (copy → rename → pointer → delete old → respawn) | **one JS module**, used by main before `ready` and by the headless server — the Rust/Python lock-step ends. `app.setPath('sessionData', <root>/…)` before `ready` moves Chromium's profile under the chosen root. In dev, `app.getPath('exe')` is the Electron binary in `node_modules` — branch on `app.isPackaged`. On macOS, "beside the exe" is inside the signed `.app` (today's Rust has the same hazard). |
| Release | tauri-action + the PyInstaller `externalBin` step (JV only — JW and docgen ship no server in the installer today) | electron-builder (MIT, 26.15.3): NSIS/MSI/AppX, AppImage/deb/rpm/Flatpak/snap, dmg/pkg; `electron-updater` 6.8.9 (MIT) updates NSIS, DMG, AppImage, deb, rpm, Pacman; `win.sign` (signtool / HSM / Azure Trusted Signing), `mac.notarize`. Electron Forge has no NSIS or AppImage — rejected. |
| e2e (JW, docgen) | tauri-driver + msedgedriver | Playwright `_electron` (experimental; needs the `nodeCliInspect` fuse on) |
| CSP | `csp: null` in all three | write one (Electron's security checklist) |

### 4.3 The dictation natives — what each would take

None runs today (4.1), so this is "where they get built", not "what we lose".

| Native | Electron built-in? | Options (licence) | Lean |
|---|---|---|---|
| **Hold-to-talk** — global key-down *and* key-up, left/right modifiers | **No.** `globalShortcut` fires on press only, no left/right variants, no modifier-only chords | `uiohook-napi` 1.5.5 — MIT wrapper, but compiles in libuiohook, **LGPL-3.0-or-later → rejected**; `node-global-key-listener` — archived, X11 only → rejected; napi-rs over the existing keytap code (keytap 0.4.0 MIT/Apache-2.0; napi 3.14.0 MIT) — rejected 2026-10-05, it keeps Rust for one thing | **decided: a C++ addon** (Node-API, ABI-stable) written against the OS — `SetWindowsHookEx(WH_KEYBOARD_LL)` on Windows, an event tap on macOS (Input Monitoring), evdev/X11 on Linux |
| **System audio capture** | **Windows: yes** — `getDisplayMedia` + `setDisplayMediaRequestHandler` with `audio: 'loopback'`. macOS: CoreAudio Tap by default since Electron 39 (needs `NSAudioCaptureUsageDescription`), but open bug electron#52738 kills the track on the custom-handler path. Linux: no backend; `getUserMedia` on the PulseAudio monitor device (today's `linux.rs` idea) | the C++ addon as the fallback (ported from `macos.rs` / `linux.rs`) | Windows built-in; spike macOS and Linux built-in first. Output becomes a MediaStream, not base64 WAV |
| **Paste the text into the focused app** | clipboard yes (main process); **system-wide key injection no** | `robotjs` 0.9.1 (MIT, revived 2026, N-API prebuilds); `@nut-tree/nut-js` gone from public npm (paid prebuilds) → rejected; the key send in the same C++ addon (`SendInput` / `CGEventPost`) | Electron `clipboard` with a real save/restore (today's code **empties** the clipboard after 500 ms on Windows, and hard-codes the macOS V keycode — wrong off QWERTY — so don't copy it), and the key send in the C++ addon |
| **Play to several output devices** | **yes** — `HTMLMediaElement.setSinkId` / `AudioContext.setSinkId` (one per device; clocks not sample-locked); allow the `media` and `speaker-selection` permissions | — | setSinkId, no native code (an improvement: macOS WKWebView has no `AudioContext.setSinkId`) |
| **macOS permissions** | Accessibility: `systemPreferences.isTrustedAccessibilityClient`; Input Monitoring: none | the addon (`IOHIDCheckAccess`), or `node-mac-permissions` 2.5.0 (MIT) | built-in + the addon |

So **Rust leaves the family entirely.** For JustWrite and docgen nothing native is left. For
JustVoice, the dictation features — when they're built — get a small **C++ addon** (hotkeys +
the paste keystroke, ~400 lines written fresh against the OS). Decided 2026-10-05, the user:
*"c++ addon, record it"*, on the option shown — "A C++ addon. The family would then be
JavaScript plus C++, and C++ is already ours through audio.cpp. It's about 400 lines written
fresh against the OS directly: a low-level keyboard hook and key sending on Windows, the macOS
and Linux equivalents." Rejected: a Rust addon over today's code (keeps Rust for one thing),
`uiohook-napi` (LGPL), `robotjs` alone (it can send the paste but can't see a key released).
If dictation is dropped, there is no native code outside audio.cpp at all.

### 4.4 Electron facts (*web*, 2026-10-05)

- Newest stable **44.5.1** (2026-09-29): Chromium 152, Node 24.21.0. The latest three majors are
  supported (42, 43, 44); 45 goes stable 2026-10-20 — an ~8-week cadence, and each major lives
  about six months, so the family must ship Electron upgrades on a schedule.
- **One binary can run headless**: `ELECTRON_RUN_AS_NODE=1 <app exe> <server entry> serve`
  "starts the process as a normal Node.js process" — no display, and native modules built for
  Electron work unchanged. It needs the `runAsNode` fuse left on (on by default; the security
  guide says disable it if unused). The alternative, a Node single-executable app (SEA), is still
  "Active development" in Node 26.
- Security defaults: `contextIsolation` (since 12), `sandbox` (since 20), `nodeIntegration` off.
- **WebView2 here is 154.0.4258.53** — already ahead of Electron 44's Chromium 152. *measured.*

### 4.5 What gets worse off Tauri

1. **Disk per app**: ~367 MiB unpacked Chromium per app on Windows; three apps = three copies,
   where WebView2 Evergreen is one shared copy.
2. **Browser security patches stop being free**: WebView2 updates itself; Electron's Chromium
   updates only when we ship. The ~6-month support window forces an upgrade cadence.
3. **More security surface**: a Node main process, preload IPC to validate, a CSP to write;
   fuses pull both ways (`runAsNode` for the one-binary headless, `nodeCliInspect` for
   Playwright).
4. **JustVoice keeps a native addon** for dictation (4.3), with per-OS prebuilds in CI.
5. **macOS system-audio** has an open Electron bug on the path we'd use.
6. **The e2e harnesses move** to Playwright `_electron` (experimental).

Not worse: auto-update (none today; electron-updater covers all three OSes), memory on Windows
(§1), and the window's browser now matches the smoke gate's.

### 4.6 Known before the agent reported

- **All three renderers already call the shell through one file**, `src/services/native.js` —
  JustVoice 69 lines (5 `invoke` calls), JustWrite 107 (7), docgen 53 (4); the family guard
  fails any other file that imports Tauri's `invoke` (`../just-llm-runner/scripts/check-family.mjs:256-257`).
  That file is the one seam to swap. *code.*
- **JustWrite was an Electron app once.** `../justwrite-app/src/services/native.js:4-11`: its
  renderer "was once an Electron app talking to preload handlers"; the `window.justwrite` global
  and the Electron-shaped `{ ok, error, cancelled }` returns went on 2026-08-14 (JW `9a23480`).
  The Electron era predates the repo (first commit 2026-05-27 already had `tauri.conf.json`), so
  no reason for leaving it is recorded. *git.*

---

## 5 · Phones — what "Ionic or Capawesome" really is

Researched by an agent, 2026-10-05, every web fact checked that day (npm registry and GitHub API
for versions, licences, dates). *agent + web*, not re-checked by this session.

### 5.1 The names

- **Capacitor** is the native runtime for phones — by Ionic (now OutSystems), MIT, current major
  8 (8.0.0 2025-12-08; 8.5.2 2026-09-11; ~5.9M downloads a week). It "can be dropped into any
  existing modern JavaScript project". Capacitor 8 needs Node 22+, **Xcode 26** (iOS builds need
  a Mac), Android Studio 2025.2.1, API 24+ (capacitorjs.com/docs/getting-started/environment-setup).
- **Ionic Framework** is only a UI toolkit (MIT; `@ionic/vue` 9.0.6). **We don't need it** — Capacitor
  runs our own Vue build on our own kit components. Ionic's *paid* products (Appflow, Identity
  Vault, Auth Connect, Secure Storage, Portals) reach end of life 2027-12-31; Capacitor and Ionic
  Framework "will remain free and open source" (ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products).
- **Capawesome** is Genz IT Solutions GmbH (founded 2022, Robin Genz; Ionic's "preferred
  migration partner" since September 2026). Three things:
  - free MIT plugins under `@capawesome/*` (file picker, live update, background task…);
  - **Insiders** — proprietary plugins on a licence-keyed private registry, **$99/month, $990/year
    or $1,980 one-time**; SQLite, Secure Preferences, Biometrics, OAuth, NFC, BLE and Speech are
    Insiders-only (capawesome.io/insiders, capawesome.io/plugins);
  - **`@capawesome/capacitor-electron`** — Electron as a Capacitor platform. MIT, 3 versions
    (0.0.1 2026-07-12 → 0.1.1), announced 2026-09-25, 13 GitHub stars, ~1.4k downloads a week.
- **`@capacitor-community/electron` is dead** — README "currently unmaintained", points to
  Capawesome's; last release 5.0.1 on 2023-09-21.

**So it isn't Ionic *or* Capawesome.** The phones use Capacitor either way; Ionic Framework is
unused either way; Capawesome's free plugins can be used either way. The real choice is the
**desktop**:

- **A** — the Electron desktop built as a Capacitor platform (Capawesome's);
- **B** — a plain Electron desktop, with Capacitor for the phones only.

### 5.2 The two desktop shapes

| | A — Capawesome's Capacitor-Electron platform | B — plain Electron, Capacitor for phones |
|---|---|---|
| Main-process code | We own a 5-line `main.ts`; extension "never by owning runtime code", only hooks (`beforeReady`, `windowFactory`, `onWindowCreated`); security options "enabled by default and not configurable" | all ours, documented Electron APIs |
| Our native calls (JustWrite: 8 in `native.js`, tray events in `App.vue:159-176`) | each becomes a Capacitor plugin class in the main process | `ipcMain.handle` + `ipcRenderer.invoke` through a preload |
| Plugins on desktop | only `@capacitor/app` and the **paid Insiders SQLite**, plus web fallbacks — `@capacitor/filesystem`'s web fallback is **IndexedDB, not disk** | not needed — desktop uses Node |
| A Node server in a `utilityProcess` | undocumented; the renderer runs at `capacitor-electron://localhost`, whose default CSP (`connect-src 'self' https: wss:`) **blocks `http://127.0.0.1`** — override needed, and the origin added to our CORS/CSRF lists | documented (Electron 22+); the renderer can stay same-origin with the server, the way headless mode serves the UI today |
| SQLite | `node:sqlite` | `node:sqlite` — no flag, "Release candidate (1.2)" since Node 24.15; Electron 44.5.1 ships Node 24.21.0, so one SQLite works in Electron and in plain Node (headless) |
| Maturity | 3 months, v0.1.1, one vendor | Electron since 2013, ~123k stars, 44.5.1 on 2026-09-29, newest 3 majors supported on an 8-week cadence |

**The agent's lean: B.** A gives the phones nothing plain Capacitor doesn't; every desktop need
(dialogs, save-as, tray, data-root move, the server's life) would be ours anyway, squeezed into
plugin classes behind a strict CSP and an extra origin; A's two free wins are hollow
(IndexedDB filesystem, paid SQLite); 3 months against 13 years. B doesn't close the door on A.

### 5.3 What a phone build needs

| Need | Option | Risk |
|---|---|---|
| Runtime | `@capacitor/core`, `/ios`, `/android` 8.5.2, MIT — no Ionic Framework | low; iOS builds need macOS + Xcode 26 |
| SQLite | `@capacitor-community/sqlite` 8.1.1, MIT (2026-08-06, ~173k/week, one maintainer — Robin Genz) | medium; it uses SQLCipher even unencrypted, which may need a US export self-classification report. Rejected: Capawesome's SQLite (Insiders, proprietary) |
| Files | `@capacitor/filesystem` 8.1.4 (sandboxed), `@capacitor/share` for save-as, `@capawesome/capacitor-file-picker` 8.1.0 (MIT) | low |
| HTTP without CORS | CapacitorHttp (in core, off by default) | **high for AI** — it buffers whole responses; SSE unsupported (ionic-team/capacitor#6582); the kit streams with `res.body.getReader()` (`../just-llm-runner/ui/src/client.js:157-169`). Plain `fetch` streaming works to providers that send CORS headers; others need a small native stream plugin |
| Cloud models from the webview | the official JS SDKs' browser modes (`dangerouslyAllowBrowser`; Anthropic's `anthropic-dangerous-direct-browser-access`) — fine for a user's own key on their own device | medium; the kit stores API keys as plain text in SQLite (`llm_runner/llm/stores.py:39,48`) — a phone should use `@aparajita/capacitor-secure-storage` 8.0.1 (MIT; Keychain / Keystore) |
| Local models on the phone | no maintained MIT Capacitor llama.cpp plugin (`llama-cpp-capacitor` 0.1.5, 7 stars; `@cantoo/capacitor-llama` 5 stars; `@capgo/capacitor-llm` is MPL-2.0 and not llama.cpp; `llama.rn` is React Native only) | **high** — would need our own thin plugin over llama.cpp |
| iOS process rules | "iOS apps are not allowed to spawn child processes" (Apple DTS); App Review 2.5.2 forbids downloaded code, but model weights are data | the kit's runner (download a llama.cpp binary, `subprocess.Popen`) cannot exist on iOS — an engine must be compiled into the app |
| Background work | iOS gives ~30 s after backgrounding; `BGContinuedProcessingTask` (iOS 26+) is user-started and can end abruptly; Android 14+ foreground services need a declared type | **high** — long generations stop when backgrounded on iOS; long jobs must resume |
| Talking to a desktop on the LAN | iOS local-network permission + ATS blocks raw IPs; Android blocks cleartext HTTP; mixed content from `https://localhost` | medium-high — the desktop serves HTTPS, or every call goes through native HTTP |

### 5.4 JustWrite on a phone — the shapes

What the code says today: mobile was always deferred ("until JW goes multi-client (Android/web)…
currently a 'maybe'" — `../justwrite-app/docs/plans/archive/2026-06-18-cross-app-runner-and-jw-backend-decision.md:41-44`);
no mention of Capacitor, Ionic or iOS anywhere; the renderer fetches and saves the **whole
book** (`../justwrite-app/src/services/projectApi.js:47,83`); every AI call goes through the
server (`/v1/ai/run`, `/stream`, `/embeddings`); the kit client injects only a base URL
(`ui/src/client.js:9-10`); **no phone layout** (App, Sidebar, TitleBar, RichEditor and the
styles have no width media rules); HTML5 drag-and-drop in six views.

- **(a) Standalone** — all logic in the webview, local SQLite, cloud models. Needs JustWrite's
  domain code and the kit's `llm/` layer runnable in a browser (no `node:*`; storage, HTTP and
  files behind adapters), and a transport seam in the kit client so `/v1/*` can go to handlers
  inside the webview — then every view stays unchanged. The kit's `runner/` and `platform/` don't
  go to the phone. Two separate libraries until sync exists (books move by zip).
- **(b) A client of the desktop** — a phone browser can already open the desktop's headless UI
  over the LAN (`--host 0.0.0.0` + tokens, `../justwrite-app/docs/headless-access.md`); what's
  missing is a phone layout. A Capacitor wrapper of it adds the LAN problems and App Review 4.2
  ("repackaged website") risk.
- **(c) Both, with sync** — needs per-entity writes and conflict handling; a large design of its
  own.

**The agent's lean:** write the new Node server's domain code and the kit's `llm/` port
**browser-safe from the start** (storage, HTTP and file adapters, thin routes) — cheap now, and
the only thing that keeps (a) cheap; the phone app = (a) with cloud models; (b) comes free with a
phone layout; defer local models on the phone and sync.

---

## 6 · Headless, MCP and JustWrite's link

- **JustWrite's link needs nothing.** There is no runtime link — JustWrite exports a book `.zip`
  and the user opens it in JustVoice (`docs/dev/design-decisions.md:101-104`, 3.1). The move
  keeps JustVoice's import of that zip; nothing crosses the apps live.
- **Headless keeps the same server.** The server is one JavaScript entry module. In the app,
  Electron's main process starts it in a `utilityProcess`; headless, `justvoice-server serve`
  starts the same module. Two ways to ship the headless command:
  - **one binary**: a `justvoice-server` launcher that runs the app's own exe with
    `ELECTRON_RUN_AS_NODE=1 <server entry> serve` — no display needed, native modules unchanged,
    nothing extra to ship; costs keeping the `runAsNode` fuse on (4.4);
  - **plain Node** (or a Node single-executable app, still "Active development") — a second
    runtime to ship (`node.exe` is 103 MB here) or to require.
  Either way the launcher must never be named `justvoice` — the CreateProcessW trap moves to it.
  Headless serves the UI at `/ui/` as today (`@fastify/static`), and the data-dir ladder is the
  same JS module the app uses (4.2) — which also ends the dev trap where the app and a bare
  headless run open different databases.
- **MCP** stays at `/mcp`: the official MCP SDK (`@modelcontextprotocol/server` 2.x +
  `/fastify`, Apache-2.0; or v1 `@modelcontextprotocol/sdk`, MIT) as an ordinary route, and the
  client-id ContextVar becomes `AsyncLocalStorage` (3.3).

---

## 7 · Blast radius

### 7.1 Every renderer call into Tauri — pasted grep, 2026-10-05

`grep -rnE '@tauri-apps|__TAURI|isTauri|[^.a-zA-Z]invoke\(|tauri:'` over `src/` of the three
apps and the kit's `ui/src/` (`*.js|*.vue|*.mjs`), tests, mocks and comment lines dropped:

```
JustVioce src/App.vue:425:  const tauriEvent = typeof window !== "undefined" ? window.__TAURI__?.event : null;
JustVioce src/components/DictateWindow.vue:91:    const { emit } = await import("@tauri-apps/api/event");
JustVioce src/components/DictateWindow.vue:191:    const { listen } = await import("@tauri-apps/api/event");
JustVioce src/main.js:17:import { openPath, openUrl } from "@tauri-apps/plugin-opener";
JustVioce src/services/native.js:24:import { invoke } from "@tauri-apps/api/core";
JustVioce src/services/native.js:25:import { isTauriShell } from "@delebash/llm-ui";
JustVioce src/services/native.js:28:export const hasShell = () => isTauriShell();
JustVioce src/services/native.js:35:  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
JustVioce src/services/native.js:43:  return invoke("storage_get_root").catch(() => null);
JustVioce src/services/native.js:50:  return invoke("storage_relocate", { newRoot });
JustVioce src/services/native.js:58:  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
JustVioce src/services/native.js:68:  return invoke("list_audio_output_devices").catch(() => []);
JustVioce src/views/SettingsView.vue:525:    const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
JustVioce src/views/SettingsView.vue:553:    const tauri = window.__TAURI__;
JustVioce src/views/SettingsView.vue:574:  const tauri = window.__TAURI__;
JustVioce src/views/SettingsView.vue:910:  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
justwrite-app src/App.vue:159:  if (window.__TAURI_INTERNALS__) {
justwrite-app src/App.vue:160:    import("@tauri-apps/api/event").then(({ listen }) => {
justwrite-app src/main.js:38:import { openPath, openUrl } from "@tauri-apps/plugin-opener";
justwrite-app src/services/native.js:21:import { invoke } from "@tauri-apps/api/core";
justwrite-app src/services/native.js:22:import { isTauriShell } from "@delebash/llm-ui";
justwrite-app src/services/native.js:25:export const hasShell = () => isTauriShell();
justwrite-app src/services/native.js:32:  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
justwrite-app src/services/native.js:43:    const res = await invoke("pick_file", { title, filterName, filterExt, defaultDir });
justwrite-app src/services/native.js:70:    return await invoke("shell_save_file", bytes, { headers });
justwrite-app src/services/native.js:82:  return invoke("storage_get_root").catch(() => null);
justwrite-app src/services/native.js:89:  return invoke("storage_relocate", { newRoot });
justwrite-app src/services/native.js:97:  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
justwrite-app src/services/native.js:106:  return invoke("set_tray_labels", { labels }).catch(() => {});
just_ai_i18n_docgen src/App.vue:68:  if (window.__TAURI_INTERNALS__) {
just_ai_i18n_docgen src/App.vue:69:    import("@tauri-apps/api/event").then(({ listen }) => {
just_ai_i18n_docgen src/main.js:5:import { openPath, openUrl } from "@tauri-apps/plugin-opener";
just_ai_i18n_docgen src/services/native.js:18:import { invoke } from "@tauri-apps/api/core";
just_ai_i18n_docgen src/services/native.js:19:import { isTauriShell } from "@delebash/llm-ui";
just_ai_i18n_docgen src/services/native.js:22:export const hasShell = () => isTauriShell();
just_ai_i18n_docgen src/services/native.js:29:  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
just_ai_i18n_docgen src/services/native.js:37:  return invoke("storage_get_root").catch(() => null);
just_ai_i18n_docgen src/services/native.js:44:  return invoke("storage_relocate", { newRoot });
just_ai_i18n_docgen src/services/native.js:52:  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
just-llm-runner ui/src/common/index.js:68:export { configureExternal, openExternal, openPath, canOpenPath, isTauriShell } from "./services/external.js
just-llm-runner ui/src/common/services/external.js:36:export function isTauriShell() {
just-llm-runner ui/src/common/services/external.js:37:  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
just-llm-runner ui/src/common/services/external.js:49:  if (config.open && isTauriShell()) {
just-llm-runner ui/src/common/services/external.js:58:  return !!config.openPath && isTauriShell();
just-llm-runner ui/src/common/services/fileSave.js:27:import { isTauriShell } from "./external.js";
just-llm-runner ui/src/common/services/fileSave.js:39:  return !!config.save && isTauriShell();
just-llm-runner ui/src/common/services/serverApi.js:51:    const isTauri = protocol === "tauri:" || hostname === "tauri.localhost";
just-llm-runner ui/src/common/services/serverApi.js:52:    if (!isDev && !isTauri && (protocol === "http:" || protocol === "https:")) return origin;
just-llm-runner ui/src/installLlmUi.js:23:import { configureExternal, isTauriShell } from "./common/services/external.js";
just-llm-runner ui/src/installLlmUi.js:54:  if (isTauriShell()) {
just-llm-runner ui/src/installLlmUi.js:57:      'installLlmUi(app, { external: { open: openUrl, openPath } }) from "@tauri-apps/plugin-opener".',
```

What it says:

- **The kit's `isTauriShell()` (`external.js:36-37`) is the one switch** for `openPath`,
  native save and every app's `hasShell`. Pointing it at a preload bridge flips all three apps.
- **Three places bypass that door**: JV `App.vue:425`, JW `App.vue:159`, docgen `App.vue:68`
  (plus JV's dead `window.__TAURI__` uses in `SettingsView.vue`, 4.1) — they move to it.
- `serverApi.js:51-52` needs no change: an `app:` or `file:` origin falls through like `tauri:`,
  and a page loaded from the server returns its own origin.
- `package.json` in each app holds `@tauri-apps/api`, `@tauri-apps/plugin-opener` and
  `@tauri-apps/cli` (JV `:29,30,43`; JW `:54,55,93`; docgen `:23,24,35` — *agent*). The kit has
  none.
- JW's tray listeners need a preload channel; JV's `DictateWindow.vue` events have no Rust side
  today (*agent*: the dictate window is never created).

### 7.2 The family guard and the structure doc

- The family guard assumes Tauri and Python throughout: `check-family.mjs` check 4 (the Python
  server layout, `:169-191`), the renderer-`invoke` check (`:256-257`), check 14 (the shells
  declare the same Tauri surface, `:273-293`), the ruff pins (`:424`, `:549-551`, `:617-619`).
  ~50 lines mention Tauri or Python; `../just-llm-runner/docs/app-structure.md` ~68. *code.*
- The guard also fails any renderer that installs a `window.<app>` global
  (`../justwrite-app/docs/dev/architecture-notes.md:25-29`, `potential-roadmap.md:257`) — and an
  Electron preload's `contextBridge.exposeInMainWorld` is exactly that. The rule has to become
  "one bridge object, read only by `native.js`". *code.*

---

### 7.3 The rule docs that change

Lines naming Tauri, Rust, Python, pytest, ruff, PyInstaller or the sidecar (`grep -c -i -E
'tauri|rust|python|pytest|ruff|pyinstaller|sidecar'`, 2026-10-05): JustVoice `CLAUDE.md` 25,
JustWrite `CLAUDE.md` 14, docgen `CLAUDE.md` 11, the kit's `CLAUDE.md` 12,
`check-family.mjs` ~50, `app-structure.md` ~68. JustVoice's `design-law.md`: 0. Among them:
"Business logic never goes in Rust", the console-script naming rule, the renderer gate's
`justvoice-server serve --data-dir …` recipe, "`cd server && ruff check . && pytest`".

---

## 8 · The order to move the pieces

A proposal, not decided. The principle: the smallest app proves the whole shape first, the
shared kit moves before the apps that mount it, and every step is checked against the Python it
replaces while that Python still runs.

0. **Spikes that decide designs** (each a day or less): a `utilityProcess` server after a hard
   kill of main (does it orphan?); the koffi Job Object in a `utilityProcess` (the agent proved
   it in plain Node); Kysely (or raw SQL) over the chosen driver and over Capacitor SQLite, if
   the phone is to share query code.
1. **The audio math into audio.cpp** (decided — §9 Q1), while Python is still the server:
   Python calls the new endpoints, and the agent's comparison harness proves them against
   today's functions. That shrinks JustVoice's later port to pure orchestration.
2. **The kit**: `llm_runner` → JavaScript — `llm/` written browser-safe (storage, HTTP and file
   behind adapters, for the phone — §5.4), `runner/` and `platform/` in Node — as a Fastify
   plugin; plus the shared Electron pieces: the main-process module (data-dir ladder, server
   life, tray, dialogs, window state, the preload bridge) and the kit's shell switch
   (`isTauriShell` → a bridge test). The kit's 1,019 tests port with it.
3. **docgen** — the smallest server (4,975 lines, 32 routes, 1 table): the first app on
   Electron + Node end to end, with electron-builder and its e2e on Playwright `_electron`.
4. **JustWrite** (5,863 lines, 35 tables) — then the phone work, as its own plan.
5. **JustVoice** (36,380 lines, 188 routes) — last and largest, on a proven kit and shell.

The check at every step: the old and new servers run against the same database and every route
is diffed — the ported tests are the spec, and the schema stays identical (§9 Q5). The family guard and the rule docs (7.2, 7.3) change with the first app that
moves.

---

## 9 · The rulings

All decided 2026-10-05 except Q8's last part. Q7 by *"c++ addon, record it"* (4.3); Q1–Q6 and
Q8 by **"your rec go"**, on these recommendations, pasted as shown:

> 1. **Audio math: all of it into audio.cpp?** Yes, with the five conditions:
>    - its own module and endpoints in the fork;
>    - the endpoints work with no model loaded;
>    - no sample math left in the server;
>    - mastering stays ffmpeg;
>    - Python stays the reference until the C++ matches.
>
> 2. **Desktop: plain Electron, with Capacitor for phones only?** Yes.
>    - Capawesome's Electron platform is three months old.
>    - It would force our native calls into plugin classes.
>    - Its default security policy blocks our local server.
>    - Its desktop SQLite is a paid plugin.
>    - Plain Electron leaves the door open to switch later.
>
> 3. **Where the window loads its UI?** From `app://`.
>    - The window still opens if the server fails, and shows the kit's connection-error state.
>    - It's the same shape as today's `tauri://`, and the kit's server-address code already
>      handles it.
>
> 4. **Headless?** One binary: the app's own exe run as Node.
>    - Nothing extra to ship.
>    - The native modules (SQLite, the process-tree job) are built once.
>    - The cost, keeping the "run as Node" switch on, only helps someone who can already run
>      programs on the machine.
>
> 5. **Databases?** Keep today's schema exactly.
>    - No reset is needed.
>    - The old and new servers can be diffed route by route on your real data.
>    - After the move, the usual no-migrations rule applies again.
>
> 6. **Dev data root?** `<repo>/data`, gitignored, shared by the dev app and headless.
>    - With one ladder the two can't drift apart again, so the `--data-dir` trap is gone.
>    - When Tauri goes, today's `src-tauri/target/debug/data` gets renamed there once. That's
>      instant on the same drive, and it holds your models and caches.
>
> 8. **JustWrite on phones:**
>    - Separate libraries moved by zip for a first release? Yes; sync is a large design of its
>      own.
>    - Cloud-only AI on the phone? Yes; no maintained llama.cpp plugin exists for Capacitor.
>    - A Mac with Xcode 26 for iOS builds? That one is yours to answer. iOS builds can't be made
>      without macOS.

Q1's five conditions in full, as shown earlier the same day (the user had asked *"i think all
the work should be in audo cpp, what do you think?"*):

> 1. **Keep the DSP in its own module in the fork**, with its own files and endpoints, apart from
>    the model code. That keeps upstream merges clean, since every addition widens the distance
>    from 0xShug0/audio.cpp.
> 2. **The endpoints must work with no model loaded.**
> 3. **The server does no sample math at all.** It passes audio and parameters to audio.cpp.
> 4. **Mastering stays ffmpeg.** It's not our math, and its `loudnorm` is the standard.
> 5. **Python stays the reference until the C++ is proven.** The agent's comparison harness
>    already exists. Point it at the new endpoints and require bit-identical output everywhere
>    except Signalsmith, which gets one deliberate cache reset.

Q7, as shown and decided (*"c++ addon, record it"*): "A C++ addon. The family would then be
JavaScript plus C++, and C++ is already ours through audio.cpp. It's about 400 lines written
fresh against the OS directly: a low-level keyboard hook and key sending on Windows, the macOS
and Linux equivalents." Only when dictation is built.

**Q8's last part, answered 2026-10-05:** *"no i dont have a mack"*. iOS builds need macOS with
Xcode 26, so how iOS gets built (a rented or cloud Mac, or a macOS build runner — GitHub Actions
stay off by the user's ruling) is open for the phone plan. Android builds on Windows.

What the rulings settle elsewhere in this doc: §2.2 option (c) for Signalsmith (pitch and speed
move into audio.cpp with the rest); §5.2 shape B; §6 the one-binary headless; §8 step 1 is no
longer conditional and the schema stays identical.

---

## 10 · Found on the way — not part of the move, not fixed

Each is code-verified (✓) or agent-measured; none was changed. All tracked 2026-10-05 at the
user's word ("track all side finidngs"): the JustVoice ones as FINDING items in JustVoice's
TASKS, the data-dir ladder and the hard-kill stop in the kit's TASKS (the shared Electron main
module closes both).

- ✓ **The release recipe's sidecar dies on start** (§1), and the release job installs
  `./server[dev]` without the `bundle` extra, so the kit is never in the frozen build
  (`.github/workflows/release.yml:42`). The last three Release runs failed (*agent*, gh,
  2026-08-05).
- ✓ **JustVoice's tray "Open settings / About / Copy URL", the updater UI and "Open log file" do
  nothing** — they read `window.__TAURI__`, which no config enables (4.1).
- ✓ **`docs/mastering.md:19` says the analyzer uses pyloudnorm**; nothing imports it (2.2).
- ✓ **The Kokoro "mean" blend changes in its last bits on every restart** (`set(pack)`,
  `engines/blending.py:212`; 2.2).
- ✓ **JustVoice's OpenAPI says the licence is Apache-2.0** (`server/justvoice/app.py:139`); the
  project is MIT.
- **The data-dir ladder's copies disagree** (Rust vs the kit's Python fallback folder, the
  pointer file, the dev root), and **Tauri writes outside the chosen root**
  (`.window-state.json`, `EBWebView`) — against the 2026-08-14 ruling (4.1; *agent*).
- **JustWrite and docgen hard-kill their servers** on stop; only JustVoice stops gracefully (4.2;
  *agent*).
- **`synthetic_keys.rs` empties the clipboard** after a paste on Windows instead of restoring it,
  and hard-codes the macOS V keycode (4.3; *agent*) — dead code today.
