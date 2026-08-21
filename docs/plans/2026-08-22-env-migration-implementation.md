# 2026-08-22 — Environment migration: the implementation hand-off (per-engine venvs)

**Who this is for.** Opus, coding in a fresh session. Follow the slices IN ORDER;
each is self-contained with its own verification. Every decision is already made —
if a step seems to need a choice, the answer is in the text or in
`2026-08-22-engine-environment-and-platform-research.md` (the WHY doc). If a genuine
gap appears (a word, a label, a behavior this doc does not name): STOP and ask the
user; do not fill it.

**Revision note.** This doc was first written around a shared venv; the 2026-08-22
rethink (user: *"576mb is not bad so if you still think per engine venvs is ok go
with that"*, then *"so your rec is env that is fine update docs"*) changed the model
to **one venv per engine**. This version is the authority; the shared-venv version
exists only in git history.

**What is being built.** Every engine gets ITS OWN venv on **Python 3.13** with a
**family-wide torch pin: torch 2.13.0 + torchaudio 2.11.0** (same pin in every
manifest — divergence is what costs 4.3 GB; agreement costs ~576 MB total via uv
hardlinks). GPU wheel index chosen by GPU tier (kit rule). ROCm 7.2 on Linux.
Pocket TTS excised. peft arrives naturally (each venv installs its manifest's full
list). uv cache pinned beside the venvs. Model revisions pinned to SHAs. The shared
venv, `constraints.txt`, and all `--no-deps`-hand-mirroring EXCEPT chatterbox's die.
Roster after this doc: **chatterbox · kokoro · qwen3 · luxtts + whisper**. TADA and
MOSS stay exactly as they are (marked, hidden, NOT deleted — no word given).

**Why per-engine (one paragraph).** Correctness by construction: each engine gets
exactly its declared versions (chatterbox finally runs its declared
`transformers==5.2.0` — render-proven 2026-08-22), no cross-engine re-resolution,
no constraints ceiling to maintain, the manifest-drift class (the peft hole) becomes
detectable per venv, kokoro stops being a special case, and every engine gets a real
Uninstall (shared engines have none today). Engines already run one-subprocess-each;
`ISOLATION="venv"` is proven code (kokoro runs it today). Measured cost: ~576 MB.

**Ground rules (standing, from CLAUDE.md + user):** no `git add -A` (user + a peer
session edit in parallel — stage by path); gates before any commit = `cd server &&
ruff check . && python -m pytest` (pytest is SILENT ~8 min — wait for the `N passed`
summary; ruff's "All checks passed!" is NOT the end) + `npm run build:vite`;
commit/push only when the user says; pre-release = NO migrations, the user resets;
never write escape-bearing bytes via bash heredocs — use Edit/Write tools; console
script is `justvoice-server`.

**Proven facts — rely on these without re-testing** (renders on this machine,
2026-08-22, receipts in the WHY doc §4): chatterbox@5de7a54a renders on torch
2.9.1+cu128 CUDA and torch 2.13.0 CPU (py3.13, offline), **and at
transformers==5.2.0** (2.56 s audio in 10.4 s CPU — faster than at 4.57.3);
LuxTTS@28ae6a611516 clone-renders on 2.9.1+cu128 CUDA py3.13 (piper-phonemize 1.4.7
has cp313 wheels on all platforms); kokoro-onnx 0.6.1 renders on numpy 2.5.2;
peft 0.20 coexists; qwen-tts imports, flash-attn optional. Least-proven paths, gated
at Slice 9: qwen3 render on the new stack (transformers identical at 4.57.3 → low
risk) and LoRA training on torch 2.13 (the queued Alder/Wren runs are its test).

---

## Slice 0 — the one remaining smoke (run BEFORE coding)

The only unproven combination in the target is torch **2.13.0+cu126 on GPU**
(2.13 proven CPU; GPU proven at 2.9.1+cu128). One scratch test:

```bash
SC=<scratchpad>; uv venv "$SC/v213" --python 3.13
uv pip install --python "$SC/v213/Scripts/python.exe" torch==2.13.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu126
# chatterbox chain per Appendix A, then:
HF_HOME="E:/Dev/Web/JustVioce/server/justvoice/engines/chatterbox/models/hf" HF_HUB_OFFLINE=1 \
  "$SC/v213/Scripts/python.exe" t_chatterbox.py cuda     # script in Appendix B
```

- PASS (expected): torch **2.13.0** everywhere below.
- FAIL with a CUDA-arch error (`no kernel image`): pre-decided fallback — pin
  **torch 2.9.1 / torchaudio 2.9.1** instead, and Linux AMD uses **rocm6.4**
  instead of rocm7.2 (2.9.1's ROCm home). No third option. Report which branch ran.

## Slice 1 — uv cache + managed-python pinning (FIRST, because every later slice builds venvs)

`server/justvoice/engines/manager.py`: one helper `def _uv_env() -> dict` returning
`os.environ` copy with `setdefault`: `UV_CACHE_DIR = ENGINES_DIR / ".uv-cache"` and
`UV_PYTHON_INSTALL_DIR = ENGINES_DIR / ".uv-python"` (same volume as the venvs —
hardlinks depend on it; measured cross-drive fallback = full copies, WHY doc §3;
a user-set env var wins via setdefault). Pass `env=_uv_env()` at EVERY uv call site:
`_run_uv_pip`, the `uv venv` call in `_install_engine_isolated`, `_ensure_plugin_current`,
and any in `installer.py`. Slice 6 re-roots these paths for frozen builds through
`engines_runtime_root()` — keep the helper the single place the location lives.
Blast: `grep -rn "subprocess.run(\[uv\|_run_uv_pip\|uv, \"venv\"" server/justvoice --include=*.py`

## Slice 2 — torch pins + per-tier index selection

1. Every TTS/STT manifest torch step — `chatterbox`, `qwen3`, `whisper`, `luxtts`:
   `{"kind": "torch", "variant": "auto", "packages": ["torch==2.13.0", "torchaudio==2.11.0"]}`
   (no `version` key; the step handler at manager.py:~905 passes `==` pins through
   untouched). torchaudio 2.11.0 is the FINAL torchaudio (no torch pin by design;
   pairing render-proven).
2. `manager.py` `_detect_torch_index_url()` (~line 660) rewritten:
   - NVIDIA: kit detection (`from llm_runner.runner.hardware import detect` — the
     door the accel step already uses) + the kit tier rule (compute cap >= 10.0 →
     cuda13): **cuda12 → `/whl/cu126`**, **cuda13 → `/whl/cu130`**, unknown → cu126.
   - AMD Linux (keep the rocm-smi probe shape): `/whl/rocm7.2`, label "rocm-7.2".
   - AMD Windows: return None (CPU) + one info log naming the
     `JUSTVOICE_TORCH_INDEX` override and docs (Slice 7 writes the recipe).
   - `JUSTVOICE_TORCH_INDEX` env override stays highest priority.
3. Blast (paste outputs): `grep -rn "cu124\|rocm6.2\|2\.6\.0" server/justvoice --include=*.py | grep -v venv`;
   `grep -rn "\"kind\": \"torch\"" server/justvoice/engines`; update every test the
   greps surface (pins to 2.6.0/cu124 in `server/tests/` become the new truths).

## Slice 3 — per-engine venv conversion (the heart)

1. `manager.py`: flip the isolation DEFAULT — `getattr(self.module, "ISOLATION",
   "shared")` → `"venv"` (the `isolation` property, ~line 361) and rewrite its
   docstring (per-engine is the rule; "shared" no longer exists as a value —
   remove the branch entirely, see 3.4).
2. Manifests: DELETE `ISOLATION = "shared"` from chatterbox; DELETE
   `ISOLATION = "venv"` + its numpy-war comment from kokoro (default now covers
   it; replace comment with one line: per-engine since 2026-08-22, see the
   2026-08-22 research doc); DELETE qwen3's darwin conditional line (venv on every
   OS now; the mac MLX arm is already expressed via `oses` filters on its INSTALL
   steps); tada/moss/whisper/luxtts keep no ISOLATION attr (default). tada's
   explicit `"venv"` line may stay or go — it is inert either way; prefer delete
   for one-rule cleanliness, comment preserved if it explains torch 2.7.
3. **chatterbox sub-deps move to its declared truth**: in its manifest pip step set
   `transformers==5.2.0` (render-proven 2026-08-22) — the 4.57.3 era was the shared
   venv's compromise and dies with it. KEEP `--no-deps` on the chatterbox-tts git
   step with this comment: metadata pins torch==2.6.0 (py<3.14) and would downgrade
   our torch; the CODE is proven on 2.9.1–2.13 (research doc §4). Keep the rest of
   the sub-dep list as-is (it mirrors upstream's list minus gradio).
4. DELETE the shared machinery: `server/justvoice/engines/shared_venv.py` (whole
   file), `SHARED_VENV_DIR`, `shared_venv_exists`, `_install_engine_shared`, the
   shared branches of `is_installed` / the load door / `install_engine`, and
   `_constraint_args` + `server/justvoice/engines/constraints.txt` (its whole
   rationale was cross-engine re-resolution inside one env — extinct). Known
   consumers to sweep (grep-verified 2026-08-22): `manager.py`, `installer.py`,
   `training_runner.py` (`_python_for` loses its shared fallback — engines always
   have private venvs now), `api/engines_models_api.py`, `engines/chatterbox/__init__.py`,
   and tests: `test_engine_constraints.py`, `test_engine_deprecation.py`,
   `test_engine_local_load.py`, `test_engine_vram_wiring.py`, `test_os_gate.py`,
   `test_portable_install.py`, `test_uv_resolution.py`, `test_variant_wiring.py`.
   Re-grep at the end: `grep -rn "shared_venv\|SHARED_VENV\|shared-venv\|constraints" server/justvoice server/tests --include=*.py`
   must return nothing (docs references get updated in Slice 7).
5. **Repurpose, don't delete, `test_engine_constraints.py`** → the family-torch-pin
   guard: assert every manifest torch step pins the IDENTICAL torch+torchaudio
   versions (divergence = the 4.3 GB failure mode; a deliberate divergence must
   change the test in the same PR).
6. **Manifest-hash stamp (the drift fix, replaces any generation counter):** at
   install, write the sha256 of the manifest's declared package list into the venv
   beside the origin stamp (`record_venv_origin` shape, manager.py:139-162);
   `is_installed` returns False on mismatch so the UI offers (re)Install when a
   manifest gains a package. This permanently kills the peft class.
7. Renderer: `SpeechEnginesTab.vue` — every engine is venv-isolated now: the
   Install button + Uninstall render for all engines; DELETE the
   `"shared runtime · engine installed automatically"` footer branch (~line 851).
   QuickSetup needs no structural change (it already installs engines one at a
   time via per-engine tasks). NOTE: this file has uncommitted peer-session edits —
   check `git status` and coordinate; stage by path only.
8. Existing installs: the old `.shared-venv` dir and stale per-engine venvs are
   dead weight — do NOT write cleanup code (pre-release, user resets); note in the
   report that a manual delete of `server/justvoice/engines/.shared-venv` reclaims
   ~5.5 GB apparent.

## Slice 4 — Pocket TTS excision (removed means removed)

Delete `server/justvoice/engines/pocket_tts/` (whole dir), then sweep until this
returns EMPTY (paste it): `grep -rni "pocket" server/justvoice server/tests src docs CLAUDE.md -l`
Known holders (verified 2026-08-22): `engines/capability_details.py` (row),
`server/tests/test_c_features.py` (two pocket tests — delete), `test_engine_vram_wiring.py`
/ `test_engine_knob_wiring.py` (ADAPTER_FOR "pocket-tts"), `docs/engines.md`,
`docs/dev/TASKS.md` (already rewritten as the reversal record — verify, don't
duplicate), the 2026-08-17 roster doc (§2.5 SUPERSEDED banner already in — verify).
LuxTTS manifest: strip any retire-pending framing; it is a keeper.

## Slice 5 — model revisions pinned to SHAs

1. `manager.py:1998`: `src.get("hf_revision")` → `src.get("revision")` (dead key).
2. `server/scripts/harvest_revisions.py` (dev-only, stdlib): per variant source,
   read `commit_sha` from `data/speech-cache/<engine>/<variant>/files.json` when
   present, else GET `https://huggingface.co/api/models/<repo>`; print a table. Set
   every `sources` row to `"revision": "<full-sha>"` + dated comment
   (`# <what> @ 2026-08-22; bump = deliberate PR`). Kokoro's GitHub-release URLs are
   already version-pinned — exempt.
3. Test: assert every HF `sources.revision` matches `^[0-9a-f]{40}$` (extend
   `test_variant_wiring.py` or a new pin test).

## Slice 6 — packaging truth (frozen build cannot install engines today)

1. `manager.py`: `ENGINES_DIR = Path(__file__).parent` stops being the runtime
   root when frozen. Add `def engines_runtime_root() -> Path`: frozen →
   `<data_dir>/engines-runtime` (via `justvoice.paths.default_data_dir()`), else
   `ENGINES_DIR`. Route through it: `EngineManifest.venv_dir`, `models_dir`, and
   Slice 1's `.uv-cache` / `.uv-python`. Plugin SOURCE (manifest.py/engine.py)
   still loads from the bundle — only mutable state moves. Paste the
   `grep -n "ENGINES_DIR" server/justvoice --include=*.py` result with a per-line
   source-read vs mutable-state verdict; verify with full pytest AND a
   `justvoice-server serve` boot.
2. `.github/workflows/release.yml`: `--onefile` → `--onedir` on all three OSes
   (voicebox's lesson: onefile+torch = antivirus flags + temp-dir extraction; our
   engine state must not live in a temp dir). Keep `externalBin` pointing at the
   binary inside the dir; add the dir to bundle resources per
   tauri.release.conf.json's `binaries/` shape.
3. **Windows MAX_PATH**: venvs + HF snapshot paths under a user-chosen deep dir can
   cross 260 chars. Add `<ws2:longPathAware>true</ws2:longPathAware>` to the
   sidecar's PyInstaller manifest (and check Tauri's exe manifest), and keep
   `engines-runtime` as the SHORT directory name. Note in docs that machines
   without the LongPathsEnabled registry bit may still hit it on very deep roots.
4. If the pyinstaller onedir build cannot be run in-session, say so plainly — do
   not claim it verified.

## Slice 7 — docs (same change, same PR)

- `docs/engines.md`: per-engine venvs (each engine = own env, own exact versions,
  ~576 MB total overhead via uv hardlinks), Python 3.13, torch 2.13.0 line,
  per-tier CUDA (cu126/cu130), ROCm 7.2 Linux, AMD-Windows override recipe
  (`JUSTVOICE_TORCH_INDEX` + AMD's index + torch 2.9.1 + their supported-GPU note),
  macOS 14+ floor, Pocket gone (one line: rejected over gated cloning weights),
  LuxTTS kept + render-proven, Install/Uninstall now uniform for every engine,
  hardware-accel matrix updated.
- `docs/gpu.md`: tier table (cap≥10 → cu130) + kit-rule pointer.
- AMD-Windows recipe content (for engines.md): AMD's Radeon-on-Windows PyTorch is
  ROCm **7.2.1** + torch **2.9.1** and **requires Python 3.12** (their wheels;
  also Radeon driver 26.2.2; RX 7900 XTX class / AI PRO R9700 per AMD's list;
  flow = install AMD's ROCm SDK pip packages, then torch from AMD's index — source:
  rocm.docs.amd.com/projects/radeon-ryzen → install → Windows → PyTorch). So the
  override venv for a torch engine on Windows-AMD is built `--python 3.12` — legal
  under per-engine venvs (on 3.12 chatterbox's numpy marker flips to <2, which
  only its OWN venv sees; kokoro is ONNX and unaffected). Document as manual
  recipe; auto-detect stays deferred (ROADMAP).
- `docs/dev/design-decisions.md` / `code-map.md`: only where they state "shared
  venv" as fact — grep `shared` in docs/ and update the env-model statements.
- `CLAUDE.md`: the invariants section mentions engines installing "their own
  venvs" already — verify wording still true (it becomes MORE true); adjust the
  one sentence if it names the shared venv.
- `docs/dev/TASKS.md`: the migration item — mark slices as they land; add one item
  for the deferral (AMD-Windows auto-detect).

## Slice 8 — the dev "check engines" command (user asked for this)

`server/scripts/check_engines.py` + `npm run check:engines`. Three modes, no args =
first two:
1. **drift**: per engine, compare manifest-declared packages vs its venv's actual
   (`importlib.metadata` via that venv's python, subprocess `-c`); report
   MISSING/VIOLATED. Per-engine venvs make this exact (no cross-engine ambiguity).
2. **upstream**: manifest git refs vs GitHub HEAD (api.github.com, UA header);
   pip pins vs PyPI latest (`/pypi/<p>/json`); variant `revision` vs HF current
   sha. Print pinned→upstream MOVED/current. Network failures degrade to
   "unreachable", never crash.
3. **--test <engine>**: scratch venv from the engine's declared set (Appendix A
   programmatically), render one line via the engine's module, assert non-silent
   WAV (weights via the app's caches / HF_HOME).
No scheduling, no CI — a command the user runs by hand.

## Slice 9 — gates + hand-back

1. `cd server && ruff check .` clean. 2. Full pytest (`N passed`, ~8 min silent).
3. `npm run build:vite`. 4. Headless smoke per CLAUDE.md (serve 8741 + `JV_BASE`
   smoke); kill the server BY PORT.
5. Engine proof through the APP: each engine Install (fresh venvs — the stamp makes
   stale ones offer reinstall) → load → render one line: chatterbox, luxtts, qwen3,
   kokoro; whisper transcribe one capture. Report duration+rms each. qwen3 and (when
   the user runs Alder/Wren) LoRA training are the two watched paths (least-proven).
6. Report: what changed, gate outputs, Slice-0 branch taken, greps pasted, deferrals
   (AMD-Windows auto-detect; pyinstaller run if skipped). NO push unless told.

## Appendix A — proven install recipe (per-engine flavors)

Common: `uv venv <dir> --python 3.13` then torch step:
`uv pip install --python <py> torch==2.13.0 torchaudio==2.11.0 --index-url <tier index>`

chatterbox venv (render-proven set, now at declared transformers):
```
uv pip install --python <py> transformers==5.2.0 librosa==0.11.0 soundfile safetensors \
  "conformer>=0.3.2" diffusers==0.29.0 omegaconf pykakasi s3tokenizer spacy-pkuseg \
  pyloudnorm "peft>=0.14"
uv pip install --python <py> "resemble-perth @ git+https://github.com/resemble-ai/Perth.git@ce86c49d029f"
uv pip install --python <py> --no-deps "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```
qwen3 venv: `transformers==4.57.3 accelerate==1.12.0 qwen-tts==0.1.1 "peft>=0.14" librosa soundfile safetensors` + its git ref `022e286b98fb`.
whisper venv: `transformers>=4.45 accelerate soundfile librosa safetensors`.
kokoro venv: `kokoro-onnx==0.6.1` (NO torch step — pure ONNX).
luxtts venv: torch step + `soundfile librosa huggingface_hub` +
`--find-links https://k2-fsa.github.io/icefall/piper_phonemize.html piper-phonemize` +
`linacodec @ git+...@c0ae7c7285e1` + `zipvoice @ git+...@28ae6a611516`.

## Appendix B — test scripts (verbatim from the proven 2026-08-22 runs)

`t_chatterbox.py`:
```python
import sys, time
import numpy as np
import torch
device = sys.argv[1] if len(sys.argv) > 1 else "cuda"
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
model = ChatterboxMultilingualTTS.from_pretrained(device=device)
t0 = time.time()
wav = model.generate("The quick brown fox jumps over the lazy dog.", language_id="en")
arr = wav.squeeze().cpu().numpy(); dur = len(arr)/model.sr
rms = float(np.sqrt(np.mean(arr**2)))
print(f"RENDER {dur:.2f}s in {time.time()-t0:.1f}s rms={rms:.4f}")
assert dur > 1.0 and rms > 0.005
```
`t_lux.py` (key calls; prompt WAV made by kokoro):
```python
from zipvoice.luxvoice import LuxTTS
model = LuxTTS(model_path="YatharthS/LuxTTS", device="cuda", threads=4)  # HF_HOME -> engines/luxtts/models/hf
enc = model.encode_prompt("prompt.wav", duration=5)
out = model.generate_speech("The quick brown fox jumps over the lazy dog.", enc,
                            num_steps=4, guidance_scale=3.0, speed=1.0)  # 48 kHz
```
`t_kokoro.py`:
```python
from kokoro_onnx import Kokoro
k = Kokoro("data/speech-cache/kokoro/kokoro-v1.0/kokoro-v1.0.onnx",
           "data/speech-cache/kokoro/kokoro-v1.0/voices-v1.0.bin")
samples, sr = k.create("The quick brown fox jumps over the lazy dog.",
                       voice="af_heart", speed=1.0, lang="en-us")
```
