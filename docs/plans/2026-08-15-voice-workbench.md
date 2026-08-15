# 2026-08-15 — The voice workbench: one place to hear, tune, and make voices

> **⚠ SUPERSEDED 2026-08-15 for everything not yet built.**
> **`docs/plans/2026-08-15-voice-workflow-redesign.md` is the resume surface.**
> Slices **C, D and E are FROZEN and must not be built** — they predate the
> design and several of their instructions are now known-wrong (Slice D defers
> to a struck spec; Slice E's inspector-removal ordering assumes a voice-centric
> workbench the redesign reshapes). This doc stays as the **record of Slices A
> and B**, which shipped, and of THE DESIGN section recovered below — which the
> redesign doc carries forward and extends.

**STATUS: SLICES A and B ARE BUILT (2026-08-15). C, D and E are FROZEN —
superseded, see above.**

**Read THE DESIGN below before anything else, including before §0.** It is
the section this plan spent its first two slices without; skipping it is how
Slice B got built correct-to-spec and wrong-to-purpose. §3 and §4 are the
record of what was done, not work to do — their anchors are pre-Slice-A line
numbers and no longer resolve. Slice B's row-drawer mount is a step toward
the workbench, NOT the workbench, and is itself under reconsideration.

Written 2026-08-15, late session, for a fresh Opus session to execute after a
compact. The user's words creating it: *"your rec make detailed plan for opus
to execute without thinking too much i will switch to opus and have him execute
the plan"*. Execution follows the standing law: **one slice per go** unless the
user says otherwise. Every remaining file:line anchor was verified 2026-08-15
and predates Slice A; re-verify before editing — the user commits in parallel.

---

## THE DESIGN — read this before any slice

> **RECOVERED 2026-08-15 from the session transcript** (`364ef093-…jsonl`,
> messages 1219–1245), after the user found the built Slice B thin and asked
> what the actual design doc was. The answer was: there wasn't one. This plan
> was written as five slices of *implementation* and the design that produced
> them — discussed and agreed in that session — was never written down. It
> died in the compact, and the slices were executed against nothing.
>
> **The failure this section exists to prevent:** a spec detailed enough to
> build from, with no statement of what is being built or why, passes every
> gate and still ships the wrong thing. If a future slice contradicts this
> section, this section wins — stop and raise it.

### The complaint (the user's words, 2026-08-15)

*"the voice inspector is hidden behind double click i think we need a better
desing for managing voices blending cloning ect, it just doesnt seem like an
easy workflow, like the generate tab that seems like render tab, we have too
many hidden places to do stuff with voices and not a nice workflow"* — and on
the persona: *"we have voice selection then personality voice hint effect, all
of which change what it sounds like this is another scattered area that
changes what we hear"*.

### The diagnosis (read out of the code, not assumed)

- **One library, four doors.** The same five verbs — clone, design, import,
  blend, train — are spread across a toolbar, a collapsed `<details>` fold,
  the inspector footer, and a Labs tab. There is no single moment where the
  app says "let's make you a voice."
- **Inspection and creation are tangled.** Blend and Train don't inspect
  anything; they *make a new voice from this one*. Burying them at the bottom
  of a viewer, behind a double-click, hides the two most interesting features.
- **Double-click isn't an affordance.** Nothing on the row says it's
  clickable, and ⚙ reads as "settings", not "open".
- **Half the drawer is a promise.** Five disabled buttons, and the samples
  table is *fake* — `inspectedSamples` fabricates rows from a count.
- **Two verb classes in one pile.** Clone/design/import/record create *from a
  source you bring*; blend/train *derive from voices you already own*. Mixing
  them is why the flow feels arbitrary.
- **The persona stacks six sound layers** (voice, engine override, instruct,
  delivery, effects, lexicon) and **cannot edit its own delivery** — `+ Edit`
  raises a toast sending you to Generate, the tab being dissolved.

### The shape — three levels, none hidden

**Identity → hear → make.** Each level earns its place, and the double-click
disappears.

1. **The row is identity.** Name, engine, type, gender, language. Rename and
   the two metadata fields become inline edits or a ⋯ menu — no drawer needed
   for three fields.
2. **Hearing happens inline, in context.** NOT a dock: the user deleted the
   GlobalAudioPlayer the same day, and a persistent audition dock is the same
   fixed furniture wearing a different job. The panel opens under the voice
   row, inside the persona form's "how they sound", in the Studio cast card.
3. **A workbench page is where you make things.** The heavyweight work that
   needs room — samples, training, blend matrices. Reached deliberately.

### The voice page is a WORKBENCH, not a profile

Open a voice and you get, in this order:

- **Hear it** — your own text, not a canned line, with the engine auto-loading
  if it isn't. *"This is Generate's good half, and it's where item 6 lands:
  **Generate doesn't get deleted, it gets absorbed.**"* A take you like is
  keepable from here.
- **Tune it** — *"the params modal stops being a modal."* The delivery knobs
  sit beside the audition box so you change one and hear it. **Add axes and
  the same panel becomes the render lab**: same line, three exaggeration
  values, heard side by side. *"Advanced mode of one control, not a separate
  destination."*
- **Feed it** — the samples workbench, once the API exists. Until then, one
  honest sentence instead of five dead buttons.
- **Derive from it** — Blend and Train under one heading, both pre-filled with
  this voice as the source. Train gets the roomy layout the user ruled for,
  because the page is roomy.

**The payoff:** Generate, the render lab, Train and the inspector become ONE
surface, and the thing you do most — hear whether this voice is right — stops
being the thing that's hardest to reach.

### One audition component, three resolutions

The same component, resolving a different stack:

| Level | What it resolves |
|---|---|
| Voice | just the voice |
| Persona | the whole character — voice + engine + instruct + delivery + effects + lexicon, so you hear *Mara*, not *Bella* |
| Render preset | the above + the preset chain + master target |

**Every audition states its sum**, in one line: *"Hearing Bella (kokoro) ·
instruct · speed 1.1× · 1 effect · Stillwater lexicon."* Same move as ruling
16's master pill — scattered stops feeling scattered when the total is visible
where you're working. Fable's verdict on reviewing the whole design: *"the
single best idea in this."*

### What that does to the persona

- Split the form **by job, not by field type**: *How they sound* (voice,
  engine, instruct, delivery, effects, lexicon) and *How they're written* (the
  sheet the LLM reads).
- **The panel's knobs ARE the delivery editor.** That deletes
  `openDeliveryHint` and the Generate dependency in one move, and it is
  precisely where Generate's dissolution lands: its tuning half becomes the
  persona's, its typing-and-hearing half becomes the audition.
- **Studio's cast card gets the same panel inline**, replacing its tuner
  modal. One control in three places instead of three controls.

### What that does to Labs

Today: Compare · Train · Render lab · Audio.

- **Train** → the Voices workbench (the user's roomy-layout ruling).
- **Render lab** → the Tune section's axes. Its own description is *"pick a
  voice, 1-3 sample sentences, 1-2 parameter axes"* — that isn't a lab, that's
  auditioning with n>1.
- **Compare** (two takes → verdict) and **Audio** (one WAV → analyze/master)
  are the same tool at n=2 and n=1. Merge them into one analyzer bench.

Labs collapses from four tabs to one bench. *"I'd not keep a container called
'Labs' for one utility."*

### One ＋ New voice door

A single primary button opens a chooser with the paths as cards, each stating
its precondition honestly — clone needs Chatterbox and a 10s–2min clean
sample; design needs Qwen3; blend needs two voices; train needs samples. The
toolbar/fold/Labs split disappears. **What isn't available yet says why**,
instead of hiding in a fold. And: stop shipping disabled buttons — either
build sample collection or replace the five greyed controls with one honest
sentence.

### The physics the design must state, not discover

`synth()` is **slot-coupled** — one TTS engine resident at a time (the VRAM
think, Q8). Auditioning a kokoro voice then a chatterbox voice is a full model
swap. Ensure-load handles the mechanics, but the panel must *say* it: *"if the
panel pretends switching voices is free, cross-engine browsing feels broken
and we get a bug report that's actually physics."*

### Sequencing (why it slices, and what that does NOT license)

The slices exist so each step ships — *"big-banging that is how a 2000-line
view becomes two"*: audition component first, then the persona resolve +
knobs-as-delivery-editor, then Generate's dissolution once both its halves
have homes, then the ＋New-voice door and the Labs collapse, and inspector
removal **last**, after rename and the derive verbs have homes. Samples API
rides parallel.

**The first slice is a step toward the workbench, not a substitute for it.**
Slice B shipped the audition component mounted on a voice row and stopped
there — correct as a step, wrong as a destination, and the doc said nothing
about a destination, so nothing caught it.

### Known contradiction in this plan — resolve before building Slice D

§6 (Slice D) defers to the pipeline plan's item 6, which says *"Delete
`src/views/GenerateView.vue`"* and *"Knob home: delivery knobs live on the
persona (VoiceParamsModal) — **no new surface**."* That directly contradicts
the design above: Generate is **absorbed**, and the workbench **is** the new
surface. Item 6's spec predates this design and must be rewritten, not
executed.

### Open questions the design does not answer

1. **Does the workbench own per-line work?** (The user raised the Alexandria
   audio-editor shape: speaker · text · emotion/style · Gen per row.) Studio's
   Script/Render already own per-line. Whether these merge or stay separate
   decides the page's scope. **Unanswered.**
2. **Samples API** — build it, or remove the five controls with one line.
3. **Where the merged analyzer bench lives** — sidebar seat or under Settings.

---

## §0 Execution rules (non-negotiable, all slices)

1. **Per-slice go.** The user says which slice; build exactly that slice.
2. **Never `git add -A`.** The user edits and commits in parallel. Stage
   explicit paths; re-check `git status` immediately before staging.
3. **Gates per slice**: server touched → `cd server && ruff check . && pytest`
   (all green, ~550 tests, ~6 min). Renderer touched → `npm run lint`,
   `npm run test:unit`, `npm run build:vite`, then the smoke:
   server on 8741 with `JUSTVOICE_DATA_DIR=<scratch dir>` (console script is
   at `server/.venv/Scripts/justvoice-server.exe`; repo-root `.venv` does NOT
   exist), `JV_BASE=http://127.0.0.1:8741 npm run smoke`, then **kill by port
   8741, never by image name**. No slice touches the kit; sibling suites are
   not needed.
4. **Push only on the user's word**, and only after `gh workflow list --all`
   shows CI / CodeQL / release.yml `disabled_manually` — check BEFORE and
   AFTER.
5. **Docs land in the same commit** as the change they describe. User-facing
   docs live in `docs/*.md`; find the page, don't invent one.
6. **No DB migrations** (user law): schema changes land in the models only;
   **Slice A requires a data reset** — tell the user in the completion report,
   loudly (see §A0).
7. **Verify before editing**: if an anchor below doesn't match, STOP and
   re-grep — do not improvise around a moved line.
8. **Report failures plainly.** A red test is reported as red with output, not
   worked around.

## §1 The rulings this plan executes (user, verbatim, 2026-08-15)

- The redesign direction: *"i think we need a better desing for managing voices
  blending cloning ect… we have too many hidden places to do stuff with voices
  and not a nice workflow, think on a redesgin"* — then, on the persona layers:
  *"another place is the persona… all of which change what it sounds like this
  is another scattered area that changes what we hear"*.
- Train gets room: *"roomier layout"* (a Voices-owned surface, NOT a modal).
- Inspector: *"sounds to me like we dont really need voice inspector, think we
  should remove it?"* → removal **by replacement** (my rec, accepted by the
  redesign go): nothing deleted until its working controls have homes.
- The split: *"personality split i thought you recommended…"* → confirmed, and
  after the code trace the user's *"so why do we need bio and personlity aree
  they basically the same?"* led to the **two-field model** (his instinct was
  right; three fields was over-modeled): `voice_instruct` (audio) + `personality`
  (the one character sheet), **`bio` deleted everywhere**.
- This plan: *"your rec make detailed plan for opus to execute without
  thinking too much"*.
- Earlier, still in force: audition opens **inline, in context** — the user
  deleted the GlobalAudioPlayer 2026-08-15 (no fixed bottom chrome;
  `App.vue` ~:624 records it). No dock.

## §2 The verified truth this plan is built on (all traced 2026-08-15)

**What `personality` actually drives today** (one field, two masters — the bug):
- **Audio**: becomes `delivery.instruct` when no explicit instruct is set —
  `generate_api.py:218-240` and `:332-349` (Generate), `render_chapter_api.py
  :118-160` (every chapter-render line). Only engines with
  `supports_instruct_field=True` consume it (qwen3 CV via
  `generate_custom_voice(..., instruct=…)`, LuxTTS); kokoro/chatterbox/dia and
  qwen3 Base silently drop it.
- **Compose 🎲 / Rewrite ✏️**: `personas_api.py:223-235` refuses when empty;
  `:247-265` compose fills `{{personality}}`; `:288-315` rewrite.
- **Smart-assign**: FALLBACK only — `smart_assign_api.py:75-78` reads
  `bio` first, `personality` when bio is empty.
- **Game export sidecar**: `project_export_api.py:123`.
- **MCP**: `mcp/tools.py:176` lists `has_personality` (display only).

**What `bio` actually drives** (much less than believed):
- smart-assign primary description (`smart_assign_api.py:75-76`);
- PersonasView list subtitle `:395`, search `:80`, usage line `:331`, form
  field `:464`;
- the Lab mirror `labTestData.js smartAssignCharactersBlock` (`p.bio ||
  p.personality`).
- **NOT attribution**: `_resolve_cast` (`extraction_api.py:145-167`) fetches
  bio into the characters dict, but `format_characters`
  (`extraction/prompts.py:82-97`) reads only id/name/role/gender/pronouns/
  aliases — **bio is dropped on the floor**, and `_resolve_cast` hardcodes
  role/gender/pronouns=None, aliases=[]. The production analyze prompt gets
  **id + name only** per character. (Finding, filed in TASKS.md.)

**Dead flag**: `MCPBinding.default_personality` (`database/models.py:451`,
API shapes `mcp_bindings_api.py:32,49,67,76`, migration `migrations.py:320-321`)
has **zero readers**. Stored, returned, never consulted.

**JW import** (`imports/adapters/justwrite.py` + `projects_api.py:739-753`,
re-import `:1202-1213`): book.json characters carry
`gender/age/role/oneLiner/aliases`. The adapter builds `voice_hint` =
"gender, age N, role" (`:118-126`) and `notes` = oneLiner + "Also known as:
aliases" (`:129-139`). The materializer squashes BOTH into **`bio`**
(`bio_text = notes + "\n\nVoice hint:\n" + voice_hint`). **`personality`
receives NOTHING from a JW import** — so every imported character refuses
compose/rewrite and contributes nothing to the instruct. Smart-assign is the
only consumer that benefits.

**Preview/auto-load already half-exists**: voice previews POST
`/v1/voices/{id}/preview?auto_load=true|always` (`VoicesView.vue:284,306`,
`StudioView.vue:601,613`) — canned text, LRU-cached, server
`voice_preview_api.py`.

**Audition latency physics** (VRAM think Q8): `synth()` is slot-coupled — ONE
TTS engine resident at a time. Cross-engine audition = full model swap. The
panel must SAY this, not pretend switching is free.

**Delivery has no editor**: PersonasView `+ Edit` on the delivery overlay
raises a toast sending you to Generate (`openDeliveryHint`,
`PersonasView.vue:301-307`) — the tab item 6 dissolves.

**Studio steps** are now Script → Cast → Render → Export for prose
(`src/views/studioSteps.js`, ruling 12, commit `bb4366b`).

---

## §3 SLICE A — the sound-truth data model — ✅ BUILT 2026-08-15

Everything mechanical. Server + renderer + docs, one commit.

**Built as specced, with these deltas worth knowing:**

- Five extra sites the spec had not named, all found by the sweep and fixed:
  `ProjectsView.vue:728` (add-to-cast subtitle), `migrate_profiles.py:86`
  (the legacy voice_profiles migrator — `description` → sheet,
  `personality` → instruct, since a profile's personality WAS a style
  prompt), `extraction_api.py:1002/1037` (`PromoteCandidate`, renamed on
  both ends with `StudioView.vue:1349`), `App.vue:50` (the Personas lede),
  and three test fixtures (`test_discover_speakers`, `test_reimport_update`,
  `labContracts.test.js`).
- `test_render_chapter_scene_mode.py`'s affordance tests #4/#5 asserted the
  old field and were rewritten in place; the new `test_voice_instruct.py`
  covers the SPLIT rather than duplicating them — a persona holding BOTH
  fields renders with the instruct and never the sheet.
- `docs/personas.md`'s Fields table listed role / gender / pronouns /
  aliases as persona fields. They are not, and never were. The table now
  says so, pointing at the tracker finding.
- The narrator seeds took the exact strings the spec named. No migration was
  added (user law); an existing DB **must** be reset.

### A0 — the reset warning (put it in the completion report)

`Persona` gains a column and loses one; `MCPBinding` loses one. There is no
migration (user law: seeds-only). **An existing DB will crash on the first
Persona SELECT after this lands. The user must reset JV data before running
the server.** Say this in the report's first line.

### A1 — schema (`server/justvoice/database/models.py`)

- Persona (~:87-108): add `voice_instruct = Column(Text, nullable=True)`
  beside `personality`; **delete** `bio`. Rewrite the class comment (:87
  currently calls personality "a TTS delivery instruction") to:
  `voice_instruct` = the spoken-delivery instruction (engines with an
  instruct field); `personality` = the character sheet (compose/rewrite,
  smart-assign, export sidecar). Update the header comment ~:61-64 the same
  way.
- MCPBinding: **delete** `default_personality` (:451).
- `database/migrations.py`: delete the `default_personality` add-column lines
  (:320-321) per "delete extinct ones". Add NOTHING.
- `database/migrate_profiles.py` mentions personality (:6,:91,:117) — this is
  the legacy voice_profiles migrator; check whether it references `bio`
  (grep) and update only what breaks imports of the module.

### A2 — API shapes + server logic

- `server/justvoice/models.py` (the cross-language shapes file): find the
  Persona request/response models (grep `bio`); replace `bio` with
  `voice_instruct` alongside `personality`.
- `storage/personas.py`: the store's create/update/list mapping — same swap
  (grep `bio` in the file).
- `personas_api.py`: create (:149) and update (:176) — drop `bio`, add
  `voice_instruct=body.voice_instruct`. Compose/rewrite (:223-315) unchanged
  — they read the SHEET, which keeps the name `personality`.
- `generate_api.py` :218-240 and :332-349 — `persona.personality` →
  `persona.voice_instruct` (both sites; keep "explicit instruct wins").
  Update the :234 comment.
- `render_chapter_api.py` :118-160 — same swap; update the module docstring
  :7 and :69.
- `smart_assign_api.py` :29-36 drop the `bio` field; :75-78 becomes: use
  `c.personality[:200]` as description (single branch, no fallback chain).
- `projects_api.py` import materializer :739-753 AND re-import :1202-1213:
  `bio_text` becomes the sheet — `personality=` instead of `bio=`; keep the
  composition `notes + "\n\nVoice hint:\n" + voice_hint`. **`voice_instruct`
  stays EMPTY on import** — "female, age 34, protagonist" is a casting hint,
  not a delivery instruction; do not put it in the instruct.
- `api/_persona_helpers.py ensure_project_persona`: parameter `bio=` →
  `personality=` (and its write).
- Narrator seeds — THREE sites: `projects_api.py:302-303` (_ensure_narrator),
  `projects_api.py:647-657` (import-time), `database/session.py:123` (init
  seed). Each sets BOTH fields with these exact strings:
  - `voice_instruct="Steady, clear, unhurried — carries the prose between dialogue."`
  - `personality="The book's narrator: reads everything that is not a character's line. Steady, clear, unhurried."`
- `mcp_bindings_api.py`: remove `default_personality` from both models and
  both write sites (:32,:49,:67,:76). `mcp/tools.py:176 has_personality`
  stays (reads the sheet).
- `project_export_api.py:123`: unchanged (sidecar ships the sheet).

### A3 — renderer

- `PersonasView.vue`: delete the bio form field (:464) and every bio read
  (:80 search, :133 draft, :157 blank, :188 save, :252 snapshot, :331 usage
  line, :395 list subtitle — all switch to `personality`); empty-state copy
  :379 drops "bio". The form gets its two sections (labels only in this
  slice; the audition panel arrives in Slice C):
  - **"How they sound"**: voice, engine override, NEW `voice_instruct`
    textarea — move the current personality placeholder to it verbatim
    ("Clipped, world-weary noir delivery. Dry wit. Boston accent in stressful
    moments. Never overshares." — it was always instruct-shaped), label
    "Spoken delivery (engines that take instructions: Qwen3, LuxTTS)" —
    then delivery overlay, effects, lexicon.
  - **"How they're written"**: `personality` relabeled **"Character sheet"**,
    helper line "Drives Compose and Rewrite, casting suggestions, and the
    game export sidecar — it never changes the audio." New placeholder:
    "Lead detective. Dry wit, hates the fog, protective of Sarah. Speaks in
    short declaratives."
- `StudioView.vue` promote path (~:1340-1345): body sends
  `{name, bio: role_hint}` — check the promote endpoint's request shape in
  `personas_api.py`/`projects_api.py` (grep `promote`), rename the field to
  `personality` on BOTH ends.
- `src/services/labTestData.js smartAssignCharactersBlock` (:75-79):
  `p.bio || p.personality` → `p.personality`.
- `SettingsView.vue` MCP bindings: grep `default_personality` in `src/` —
  remove if present.
- `extraction_api.py _resolve_cast` (:156-167): remove the dead `bio` key
  from the dict it builds (the formatter never read it). Leave
  role/gender/pronouns/aliases exactly as they are — wiring them is the
  OPEN tracker finding, not this slice.

### A4 — the receipted sweep (removed-means-removed)

`grep -rn "\bbio\b"` over `server/justvoice`, `server/tests`, `src`, `docs`
must come back EMPTY except: engine model caches (`engines/*/models/**`),
`docs/plans/archive/**`, and genuine English uses of the word if any (read
each hit). Same sweep for `default_personality` — empty everywhere. Paste
both receipts in the completion report.

### A5 — tests

Update: `test_projects.py` (Persona(bio=…) at ~:49), any other `bio=` uses
(grep in server/tests), builtin-narrator tests if they assert personality
text. New file `server/tests/test_voice_instruct.py`:
1. persona with `voice_instruct` → chapter-render line carries it as
   `delivery.instruct` (drive `collect_project_line_kwargs` or the
   `_resolve_scene_to_lines` path the render-truth tests already use);
2. persona with ONLY `personality` → instruct stays unset (the sheet never
   reaches audio);
3. explicit request instruct beats the persona's;
4. JW import: run the adapter fixture through the materializer → the created
   persona's `personality` contains the one-liner AND "Voice hint:", and
   `voice_instruct` is None (reuse `test_import_justwrite.py`'s fixture);
5. smart-assign `_format_characters`: description comes from personality,
   truncated at 200.

### A6 — docs (same commit)

- `docs/personas.md` (exists — `toc.json` carries it): the two sections, which
  field drives what, the JW-import note ("an imported character's sheet is
  its one-liner + aliases + casting hint; the spoken-delivery box starts
  empty — that one is yours to write").
- `docs/ai-features.md`: smart-assign description source (~:239-241 wire
  example), compose/rewrite personality wording.
- `docs/generate.md`: the instruct section — persona fallback now named
  `voice_instruct`.
- `docs/import-and-export.md`: what a JW import fills.
- `docs/dev/design-decisions.md` is NOT touched (no boundary change).

Commit message theme: "One field, one master: the instruct and the character
sheet split, and bio dies". List the reset requirement in the body.

---

## §4 SLICE B — the audition panel — ✅ BUILT 2026-08-15

The pipeline plan's item 5 (`2026-08-15-pipeline-truth-and-first-run.md` §5)
is absorbed here — do not build it separately.

**Built as specced, with these deltas worth knowing:**

- **The spec's premise about the cache was wrong.** §2 above says row
  previews are "LRU-cached" — they were not. The LRU in
  `voice_preview_api.py` belongs to the *candidate* preview flow
  (`POST /v1/voices/preview` → `preview_id` → save), a different endpoint.
  The row preview re-synthesized every click. So the cache the spec asked
  to re-key had to be built: `_AUDITION_CACHE`, 32 entries, 10-min TTL,
  keyed exactly as specced. `audition_cache_hits` is the test hook.
- **The cap reading**: effective cap = `max(300, limits.text_max_chars)`.
  The floor is what keeps an operator's tight generation limit from making
  auditioning useless; it never lowers the cap.
- **A real gap found while wiring the knobs** (filed in TASKS.md, needs its
  own go): the capability schema's engine-private keys (exaggeration,
  cfg_weight, talker_temperature, top_k/top_p, repetition_penalty) are
  saved FLAT by `VoiceParamsModal`, but every engine reads them from the
  `delivery.engine` subdict — so they have never reached an engine at
  render. `services/audition.js canonicalDelivery` routes them properly, so
  the panel applies them and the render does not. `docs/voices.md` says so
  plainly rather than letting the user find out by ear.
- **The cache is process-global**, which is exactly the kind of state that
  silently voids the next test written against this endpoint — so an
  autouse fixture in `server/tests/conftest.py` clears it per test, with
  the reasoning written next to the existing subprocess reaper.
- Verified beyond the gates: the panel was driven in a headless browser
  (click a row → panel mounts, both honesty lines carry real data, toggle
  closes, zero JS errors) and the endpoint exercised live for the body,
  the dropped-bogus-knob path and the over-cap refusal.
- The inspector is untouched, per the slice's own instruction.

### B1 — server: preview with your own text

`voice_preview_api.py`: the preview endpoint accepts an optional JSON body
`{text?: string, delivery?: dict}`. Rules: text capped at
`settings.limits.text_max_chars` floor 300; cache key becomes
`sha1(voice_id + "\x00" + text + "\x00" + canonical-json(delivery))` (sorted
keys); empty body = today's canned behavior byte-identical; keep the
`auto_load` param exactly as is (it already ensure-loads). If the current
handler takes no body, add it back-compatibly (body optional). Tests in a new
`server/tests/test_voice_preview_text.py`: (1) custom text renders and caches
(second call hits cache — assert via the cache's own counter or monkeypatch);
(2) over-cap text 400s with a clear message; (3) canned call unchanged;
(4) delivery dict changes the cache key.

### B2 — renderer: `src/components/VoiceAudition.vue`

New component. Props: `voice` (object), optional `personaContext` (Slice C).
Contents, top to bottom:
- text box (UiTextarea, 2 rows, placeholder "Type a line to hear in this
  voice — or leave empty for the stock sample.");
- ▶ button → POST preview with text + knob values; plays via the inline
  `.jv-audio-inline` pattern (the ruled player — grep its use in
  `ChapterView.vue` for the canonical markup);
- the delivery knobs for THIS engine (reuse the capability lookup
  `VoiceParamsModal.vue` already does — engine caps from
  `/v1/engines/capabilities`); an instruct input when the engine has
  `supports_instruct_field`;
- **the honesty line** (always visible): if the voice's engine is not the
  loaded TTS engine → "⏳ {Engine} isn't loaded — the first listen loads it
  and can take a minute." (read the engines store's status; the store is
  already reactive); when loaded → "● {Engine} loaded — listens are quick."
- **the resolved-stack line**: at voice level "Hearing {voice.name}
  ({engine})" + the knob values that differ from default.
Mount: `VoicesView.vue` — row click (single, the whole row, not dblclick)
expands an inline panel row rendering `<VoiceAudition>` (same expansion slot
the inspector uses today, but audition-only). **Do not remove the inspector
in this slice** — ⚙/dblclick keep opening it; removal is Slice E.
Tests: vitest for the cache-key/param serialization helper (extract it to
`src/services/audition.js` so it's testable) + the honesty-line logic given
a fake engines store. Smoke must stay green.

Docs: `docs/voices.md` — "Hear a voice with your own text" section replacing
whatever describes preview today.

---

## §5 SLICE C — the persona resolves (form split + delivery editor + Studio)

- `PersonasView.vue`: mount `<VoiceAudition>` inside "How they sound" with
  `personaContext` = the draft (voice_instruct, default_delivery,
  effects_chain names, lexicon name). The panel's knobs READ AND WRITE
  `draft.default_delivery` — this IS the delivery editor. Delete
  `openDeliveryHint` (:301-307) and the `+ Edit` button that calls it; the
  chips row stays as the summary.
- Resolved-stack line at persona level: "Hearing {persona.name}: {voice}
  ({engine}) · instruct · speed 1.10× · 2 effects · {lexicon}" — each part
  only when set.
- `StudioView.vue` `openVoiceTuner` / `VoiceParamsModal`: the modal's body is
  replaced by `<VoiceAudition>` with the persona context (keep the modal
  shell — Studio's cast card stays a card). `VoiceParamsModal.vue` keeps only
  shell + wiring.
- Preview with a persona context sends the persona's stack: voice +
  merged delivery (draft overrides) + instruct. Effects/lexicon are NOT
  applied to previews in this slice (the preview endpoint has no effects
  path); the stack line marks them "(applies on render)". Honest, no fake.
- Docs: `docs/personas.md` gains "Hear the character while you edit them";
  `docs/studio.md`'s cast section names the same panel.
- Tests: vitest — persona resolved-stack line composition (pure function in
  `src/services/audition.js`); smoke.

## §6 SLICE D — Generate is ABSORBED (⚠ item 6's spec is wrong — do not execute it)

**Superseded 2026-08-15.** This section used to say "execute item 6 exactly as
specced in `2026-08-15-pipeline-truth-and-first-run.md` §5". That spec says
*"Delete `src/views/GenerateView.vue`"* and *"Knob home: delivery knobs live
on the persona (VoiceParamsModal) — **no new surface**"*, which contradicts
THE DESIGN above on both counts: Generate is **absorbed**, and the workbench
**is** the new surface.

Generate is also, today, the best-designed surface in this area and the thing
the user points at when asked what good looks like: a capability banner with
per-engine chips and notes, sliders paired with numeric boxes, **Delivery
direction** as a first-class textarea that disables *with its reason on it*,
seed + randomize, the lexicon line, and take history. That layout is the
workbench's skeleton, not something to throw away and rebuild thinner.

Rewrite item 6 against THE DESIGN before building. Nothing here proceeds until
the per-line question at the end of THE DESIGN is answered.

## §7 SLICE E — one door, Labs collapse, inspector removal

Order within the slice matters — homes first, demolition last.

1. **Train's roomy surface**: new Voices-owned route/section hosting
   `TrainView.vue` as a component (it keeps its 460 lines; the host supplies
   the title; TrainView must not hand-roll a page header). Ruling: roomier
   layout, NOT a modal.
2. **＋ New voice door**: one primary button on VoicesView opening a chooser
   with five cards — Clone (needs Chatterbox loaded + a 10s–2min clean
   sample) · Design from prose (needs Qwen3 — today disabled with the honest
   note that VoiceDesign isn't shipped; see qwen3 manifest comments) ·
   Import .justvoice.zip · Blend (needs two voices) · Train (needs samples).
   Each card states its precondition and disables with the reason when unmet.
   The toolbar Clone/Import buttons and the `<details>` fold (:748-769) fold
   into it.
3. **Labs collapse**: `LabsView.vue` SUBS — `train` entry removed (its home
   is #1); `compare` + `audio` merge into ONE "Audio tools" sub (CompareView
   becomes a mode of AudioToolsView or sits beside it under one tab — pick
   the smaller diff); `renderlab` is ABSORBED: the audition panel's knobs
   cover single-axis listening; if the matrix (N sentences × M values) is
   still wanted it becomes a "Compare settings…" expansion of the audition
   panel later — for now RenderLabView retires and the sidebar's Labs entry
   is renamed "Audio tools" (`App.vue:69`, help slug follows). If anything
   here looks wrong at build time, ASK — do not improvise.
4. **Inspector removal** (only now): name/gender/language edits move to a ⋯
   menu on the row (promptDialog per field, or inline edit — match the
   design law's row-action grammar); Train/Blend buttons move to the voice
   row's expansion footer ("Make another voice from this one: 🔀 Blend ·
   🧪 Train"); the fake `inspectedSamples` table, the five disabled buttons
   (:938,:961-962,:979-981) and the whole `inspectedId` drawer are DELETED.
   One honest line replaces the samples promise: "Reference samples (add /
   record / promote) aren't built yet — tracked in TASKS.md." The samples
   API decision stays OPEN in the tracker.
5. Redirects: anything routing to `#labs?tab=train` → the new Train surface;
   grep `labs` deep links in `src/`.
Docs: `docs/voices.md` (the door, the workbench, Train), whatever documents
Labs (`toc.json` slug — retitle), `docs/studio.md` if it links Labs.
Tests: vitest — Labs SUBS has no train and the merged audio entry; the door's
precondition logic as a pure function; smoke.

## §8 OPEN — need the user's word, do NOT build

- **Samples API** (`/v1/voices/{id}/samples` list/add/delete + transcription
  + SNR): build vs leave the honest line. (The five dead buttons die in
  Slice E either way.)
- **Attribution prompt enrichment**: wire a short description
  (`personality[:200]`) + aliases into `format_characters` — changes every
  analyze prompt and its token cost. Tracker finding; separate ruling.
- **MCP speak + instruct**: after Slice A, decide whether the MCP speak path
  should apply the persona's `voice_instruct` (the deleted `default_personality`
  flag was probably meant to gate this and never did anything).
- Where the merged Audio tools bench ultimately lives (sidebar vs Settings).

## §9 Session state at plan time (2026-08-15, late — for the post-compact reader)

- **Unpushed commits** (push needs the user's word + workflow check):
  JV `4c284a0` (cast names), `1f21dba` (stale lists), `bb4366b` (ruling 12
  Studio order; also carries rulings 12–16 into TASKS.md + pipeline-plan §6
  rewrite + the timeline design in IDEAS.md). Kit `cd6b450` + `0f7c9e8`
  (Lab pickers). JW `f7d5f0f` (picker docs). The user's own parallel commits
  interleave (`d10a9b1`, `d79b9a7`, `3e1bcd0`, kit `e680b07`) — never assume
  the tree.
- **Today's earlier work** (pushed): pipeline plan items 0–2 (catalog truth,
  render truth), docs truth pass, cast-endpoint names, store-failure fixes.
- **Ruling 12 is BUILT** (`bb4366b`); 13/16 are specced in the pipeline plan
  §6 but item 13's build is superseded by Slice E here; 14 = design pass, no
  go; 15 = timeline design in IDEAS.md, retraction not built.
- **Loose ends not in any slice**: SettingsView MCP-bindings persona list is
  a private stale fetch + prints a raw persona id on lookup miss
  (`SettingsView.vue:644-659`, `:656`, dropdown ~:1790) — small fix, needs a
  go. YouTube master target typed `audio/aac` encoding MP3 — product call.
  `effects.md` take-baking claim unverified. Flaky
  `test_prefetch_cancel_via_http_endpoint` seen once 2026-08-15.
