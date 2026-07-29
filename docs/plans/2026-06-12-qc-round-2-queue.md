# QC round 2 queue — accepted 2026-06-12 ("I accept your recommendations and you can code now")

<!-- SPDX-License-Identifier: MIT -->

Execution per RULE #2: one item at a time, full read of the touched
surface, written current-state → target, implement, verify, commit.
Unfinished items carry to the next session — never skimmed in.

1. **Home FOUC + slow** — seed the page from a session cache of the last
   visit (Engines-flash pattern); Continue card renders immediately,
   workflow-strip counts fill in async; parallelize probes.
2. **Studio layout rework** (design contract = the two JustWrite Audio
   Studio screenshots): big step cards with live subtitles (Cast · 3/3
   voiced …) + process lede under the title; header engine chips
   (TTS · <engine> · loaded | Script · <llm>) linking to Engines/AI
   features; Cast = two separated cards — left Narrator + Characters
   (section headers, "N characters · M unassigned" count), right VOICE
   LIBRARY (own header, engine dropdown, search, live "Picking voice
   for X", ✓ on the assigned row, accent outline on selected card);
   independent scroll areas, fixed page height; named wizard buttons
   bottom-right ("← Cast" secondary / "Next: Script ➜" primary) as a
   NEW canonical class reused by Import review; per-card cast remove ✕
   (confirm; persona stays in library) — DELETE endpoint exists.
3. **Stall indicator honesty** — single-call tasks (extract etc.) say
   "working…" instead of "stalling" at ~10s; stall only after a real
   timeout.
4. **Render: "Select all with blocks" → "Select unrendered"** using
   cache-stats (exclude fully-cached scenes); keep plain "Select all".
5. **Export QC** — no auto-run on mount; checklist sits "unchecked"
   until Re-check; 400 renders as a friendly needs-engine/render line.
6. **Studio voice library = Voices** — engine dropdown + search (same
   controls), LOCAL badge shown too (not just online·metered), same
   classes/tooltips; cast-level notice when the cast spans engines /
   includes metered voices ("chapters will swap engines while
   rendering").
7. **"instruct" → "takes direction"** — chip + tooltip + Personas
   verdict wording (matches the "+ direction" block pill language).
8. (folded into 2) cast remove.
9. **Self-hosted providers** — provider config gains self_hosted
   (auto-detect localhost/LAN URL + manual override); self-hosted
   providers list under the LOCAL tab beneath their declared kind
   heading with a `self-hosted` chip and provider verbs only; online
   tab + 💳 warning = cloud only; EngineInfo surfaces locality;
   voiceLocality() honors it (badges stay honest).
10. **Voice inspector edit matrix** — preset voices render read-only
    rows (plain text, not textboxes) + "shipped with <engine> — not
    editable"; editable for presets: gender hint + hide only. Stored
    voices keep editable fields. Samples section for presets replaced
    by: "Baked into the model. To make a voice from a recording, clone
    one with Chatterbox" + link. (Kokoro voices can NEVER take a WAV /
    in-app recording — embeddings baked in voices.bin.)
11. **Captures always visible** — drop its visibleFor gate (cross-
    cutting utility like Generate). Timeline + Labs stay kind-gated
    (user's call deferred until it annoys someone real).
12. **Voices inspector → inline expand-row** (precedent: Projects
    inline detail row / Engines provider rows): double-click or ⚙
    expands beneath the row; per-voice "Reset to defaults" (gender
    override · tuned params · unhide; enabled only when overridden);
    toolbar "Reset all voice tweaks" behind a confirm stating blast
    radius. No checkbox selection.

## Status (2026-06-12 19:35)

QUEUE COMPLETE (2026-06-12 ~20:30): all 13 items shipped, one at a
time, each verified live and committed separately. 13 was executed out
of turn on arrival — the process error that produced the mid-execution
intake rule in CLAUDE.md RULE #2.

New reports from the user land HERE as numbered items, not in the
editor.
