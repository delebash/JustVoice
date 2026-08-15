# Troubleshooting

The cross-cutting problems. Per-feature pages keep their own troubleshooting
tails for anything specific to that surface.

**An AI feature answers 501 "LLM not configured".** The LLM features (speaker
attribution, smart assign, show notes, …) need a provider — set one up under
AI Settings (the sidebar page). TTS itself never needs an LLM.

**Mastering or export answers 503 mentioning ffmpeg.** ffmpeg isn't installed or
isn't on PATH. Install it and restart the server; everything that muxes or
masters audio depends on it.

**A model load hangs or you loaded the wrong one.** Engine loads are
cancellable — the Speech engines tab's load job has a Cancel; a cancelled load leaves
the previous state intact.

**A voice preview or engine load answers 500 / 503 with "Numba needs NumPy
2.0 or less".** The shared Python environment your speech engines run in has
picked up a numpy newer than they support, and every engine except Kokoro
fails at load — Kokoro is the one engine with no numba anywhere in its
dependencies, so it keeps working and makes the problem look narrower than
it is. JustVoice pins the version that engines need, so this means something
installed into that environment from outside the app. To repair it, delete
the folder `server/justvoice/engines/.shared-venv/` and then click **Install
engine** on any engine under **AI → Speech engines** — JustVoice rebuilds the
environment from its own recipe when it finds none. Your downloaded models
live in the speech cache, not in that folder, so nothing re-downloads. See
[Engines](engines.md#where-the-python-environments-live).

**Restore finished but something looks off.** A restore (Settings → Backups →
Import backup…) replaces the data live and reloads the app. If a view still
shows pre-restore state, reload once more; speech engines are unloaded by a
restore, so load one again from the AI page before generating.

**MCP clients can't find the server.** MCP mounts at `/mcp` on the app port
(17494) — if it's missing, the server log will say the `fastmcp` package is
absent; install it in the server environment. See [MCP server](mcp-server.md).

**Dictation won't start.** The Captures tab shows six readiness gates
(microphone permission, engine loaded, hotkey registered, …) — the failing one
is named. Recordings under half a second are discarded by design.

**A render sounds different from last week.** Check which render preset the
scene binds (presets copy values at render time — editing a preset changes
future renders only) and the project's mastering target. The
[QC report](projects.md) will name a loudness drift.

**Generations pile up and disk fills.** Settings → cache for the render cache;
the bulk-delete admin operation ([Run modes](run-modes.md)) clears old
generations safely — dry-run first.
