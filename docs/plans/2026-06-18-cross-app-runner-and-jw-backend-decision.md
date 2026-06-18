# Cross-App Architecture Decision — Runner Language + JW Backend

**2026-06-18 (admiring-galileo).** Spans **JustVoice** + **JustWrite**.
Records a design discussion and the **approved** direction. Partially
supersedes `2026-06-16-builtin-llm-runner.md` (see end). Android is a
**"maybe"**, so we take the lighter path with a clear upgrade trigger.

---

## Decision (approved)

1. **JV = Python FastAPI server.** Settled *on the merits*, not for
   symmetry: JV has real API consumers — external integrators
   (`CONTRACT.md`) and headless `justvoice-server serve` deployments.
   A backend is justified by who consumes it; JV has consumers.

2. **JW stays a client-side app for now.** No external API consumers
   today. Documents stay client-side (IndexedDB as-is; optional later
   upgrade to the **Tauri SQL plugin** — SQLite via Rust, *no backend* —
   only if the whole-snapshot IndexedDB model becomes a pain).
   **Do NOT give JW a critical-path Python backend yet.**

3. **One shared Python runner/detection package**, consumed two ways:
   - **JV imports it in-process** (already Python; already does
     `include_router` per the 2026-06-16 plan).
   - **JW runs it as a LAZY sidecar** — spawned only when local LLM is
     first used, so the editor always opens and works even if the
     sidecar fails to spawn.

4. **Runner language = Python, NOT Rust.** Rust only won when JW had to
   be 100% Python-free; that constraint is dropped (Python in JW is
   acceptable). No third active business-logic language — Rust stays the
   thin Tauri shell in both apps. The existing `just-llm-runner` Python
   package (P1.1–P1.5) therefore **stands — no rewrite**.

5. **The runner is the single "hardware authority."** Detection
   (GPU / VRAM / driver / CUDA presence) is ONE implementation used by
   both LLM and voice (TTS/STT) — no duplication. Bonus: a single
   authority can **budget VRAM across voice + LLM** on small cards.

6. **Inference goes DIRECT to `llama-server`.** The runner is NOT in the
   token path — it only detects, downloads (llama.cpp + GGUF), computes
   VRAM-fit flags, and spawns/supervises `llama-server`. Zero inference
   overhead. (The point of llama.cpp over Ollama is the tunable flags;
   the runner's job is to apply them correctly — see §1/§5 of the
   2026-06-16 plan.)

7. **Full symmetry (JW becomes a Python+SQLite server) is DEFERRED**,
   gated on JW going multi-client (Android/web). The lazy Python runner
   sidecar is the **stepping stone**: if Android becomes real, grow that
   existing Python process into the full server (move data into it).

## Why (so a future session doesn't re-derive)

- **Performance is not a differentiator.** Inference is always
  `llama-server` (C++); typing/undo stay client-side; data ops are local
  and sub-millisecond. Decide on product + maintainability, not speed.
- **Backend justified by consumers** → JV yes, JW no (except future
  Android). Don't pay for a critical-path backend on a "maybe."
- **Rust vs Python** → Python: the only Rust advantage was a native
  binary for a Python-free JW; once JW runs Python (even a lazy sidecar),
  Python is simplest and avoids a third active language. Rust's perf edge
  is irrelevant (runner isn't in the inference path).
- **PyInstaller de-risked**: the Tauri + FastAPI + PyInstaller sidecar
  pattern is documented/production-proven. JV must bundle Python anyway
  (PyTorch voice); JW's runner sidecar is the *light* case (no torch).
- **llama.cpp tweaks are the win over Ollama** (same kernels; flags
  differ): `-ngl` max GPU offload, `--flash-attn`, `q8_0` KV-cache, MoE
  `--n-cpu-moe`, MTP. Runner owns VRAM-fit + OOM back-off.

## Options considered

- **A. Python core; JV imports / JW lazy-sidecar — CHOSEN.** Max sharing
  of the hard logic; JW core always works; no critical-path backend;
  Python where it matters; existing Python package reused.
- **B. Rust runner (shared crate/binary).** Clean native binary, JW
  Python-free. *Rejected:* JW-Python-free is no longer required; adds a
  third active language; detection-sharing with Python voice becomes a
  cross-language boundary; no perf benefit.
- **C. Full symmetry now (JW = Python + SQLite server).** Cleanest
  sharing + Android-ready. *Deferred:* JW has no consumers yet; gives a
  single-client editor a critical-path backend on spec. Becomes the path
  IF Android is committed.

## Revisit triggers

- **JW → Python+SQLite server (option C):** when Android/multi-client is
  **committed** (not a maybe). The lazy Python sidecar is already there
  to grow from — one future data migration, deferred until justified.
- **Rust runner (option B):** only if JW must become *strictly*
  Python-free (reverse of the current stance).

## Supersedes in `2026-06-16-builtin-llm-runner.md`

- "Rust in JW's shell, NO Python" (§6 Phase 3, §7) — **dropped.** Runner
  is Python; JW lazy-sidecars the same package.
- "JV mounts in-process / JW Python sidecar" — **refined:** JW's sidecar
  is LAZY (LLM-only) and JW's *data* stays client-side; JW is not a full
  server yet.
- Resolves that doc's internal contradiction (top STATUS vs §6/§7).
- **Still valid** from that doc: the manifest / flag-preset / VRAM-fit
  research (§1, §5), `local-llamacpp` as a provider type (§2.5), the
  voice-migration audit (§4), and "`llama-server` is OpenAI-compatible".

## Next steps (for LATER — not started; mostly hardware-gated)

1. JV — confirm the runner exposes a single `/hardware` detection
   authority consumed by both voice and LLM (today it serves
   `/v1/llm-runner/hardware`; make voice read from it instead of a
   second probe).
2. JW — wire a **lazy** Python runner sidecar (Tauri `externalBin`;
   PyInstaller or standalone-CPython; light = no torch); spawn on first
   local-LLM use; inference direct to `llama-server`.
3. `P1.5b` auto-spawn orchestration + `P1.6` benchmark — **HARDWARE-GATED**
   (need a real GPU + multi-GB downloads).
4. Shared Vue `llm-ui` consuming the runner's HTTP API via the existing
   Tauri-fetch (CORS-bypass) path.
5. (Deferred) JW → Python+SQLite server when Android is committed.

## Sources (this session)

- llama.cpp vs Ollama / LM Studio — same kernels; tuning flags are the
  win: rushis.com (Ollama-vs-llama.cpp deep dive), inferencerig.com
  (best settings), popularai.org (fastest-in-2026).
- Tauri + FastAPI + PyInstaller production pattern — aiechoes,
  "Building Production-Ready Desktop LLM Apps".
- Tauri official SQL plugin (`tauri-plugin-sql`) — SQLite without a
  Python backend.
