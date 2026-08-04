# Troubleshooting

The cross-cutting problems. Per-feature pages keep their own troubleshooting
tails for anything specific to that surface.

**An AI feature answers 501 "LLM not configured".** The LLM features (speaker
attribution, smart assign, show notes, …) need a provider — set one up under
Settings → AI features. TTS itself never needs an LLM.

**Mastering or export answers 503 mentioning ffmpeg.** ffmpeg isn't installed or
isn't on PATH. Install it and restart the server; everything that muxes or
masters audio depends on it.

**A model load hangs or you loaded the wrong one.** Engine loads are
cancellable — the Engines tab's load job has a Cancel; a cancelled load leaves
the previous state intact.

**Restore finished but the data isn't there.** `POST /v1/restore` requires a
server restart (`restart_required: true`) — restart the app (or the headless
process) and the restored state is live.

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
