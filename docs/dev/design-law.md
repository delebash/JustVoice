# JustVoice design law

The method behind `CLAUDE.md`'s "precedent before pattern" rule. Open this before any UI work or
any design sweep.

## Why it exists

Root cause of a whole inconsistency class the user hit repeatedly (2026-06-12: a bubble sub-nav
next to Settings' tab strip, "+ New" buttons on different sides, three interaction patterns across
four library views): reaching for the nearest component instead of checking what the app already
does for the same job.

## The rule

Before adding ANY UI surface — toolbar, tab strip, list, dialog, button row — stop and answer two
questions **in writing**, in the code comment or the commit message:

1. **Which existing view already solves this shape?** Name the file and the canonical class. Then
   use it.
2. **If genuinely nothing exists**, promote a NEW canonical class into `src/css/app.scss` first — never a
   scoped one-off — so the next view has a precedent to find.

A grep for the obvious class names costs five seconds; the user paying for the inconsistency costs
a test round.

## The canonical inventory (JV-local layout and shell classes)

Form primitives come from the shared `@delebash/llm-ui` kit — `UiButton`, `UiInput`, `UiTextarea`,
`UiSelect`, `UiToggle`, `UiCheckbox`, `UiField`, `UiTag`, `UiChip`, `UiMenu` (all on Quasar's components
since 2026-10-09). The `Jv*` forks were
deleted 2026-06-23 and there is no local `components/ui/` directory. What follows is JV-local
**layout and shell** structure only, all verified present in `src/css/app.scss`:

| Class | Shape it solves |
|---|---|
| kit `UiTabStrip` | ANY horizontal tab strip — a view's own (Voices, Labs) and the one inside `SettingsShell`, which renders this component. `.jv-subnav` was deleted 2026-08-21: it was the same recipe, drifted to 12px (under the 12.5px floor). Not `UiSegmented` — that is a segmented RADIO control for picking a value in a form |
| kit `SettingsShell` | `UiTabStrip` **plus a content panel with its own scroller**. Settings' General/Appearance/…. A `jv-fill` view that already owns its scroll chain takes `UiTabStrip` alone — taking the shell for its strip lands a second scroller in the view |
| `.jv-lib-toolbar` | search → filter chips → data dropdowns → spacer → actions, with "+ New" rightmost |
| ~~`.jv-table`~~ (+ `__actions`, `__empty`) | **LEGACY — do not reach for this in new work.** A data grid is the kit `UiTable`: it owns sorting, filtering, pagination, the empty state, per-cell and per-header slots, `:full-width-row` and `:row-class`. The voices grid, CacheView and WebhooksView moved 2026-08-21, wearing `.jv-table-look` (the modifier that makes a `UiTable` look like this class — without it the sweep is all-or-nothing); 25 data grids are still hand-rolled, blast radius in `docs/plans/2026-08-21-blend-rework-and-consistency-audit.md` §20, so the class stays defined until they are converted. `__actions` / `__empty` remain valid as CELL classes inside a `UiTable` slot |
| `.jv-card` (+ `__header`, `__title`, `__body`, `--bare`, `--flat`, `--soft`) | grouping controls into a section |
| `.jv-row--attention` · `--flag` · `--selected` · `--para-open` (on a `UiTable` with `.jv-table-look`, through `:row-class`) | a record row's STATE: a line that blocks something (warn tint), a line a check marked (accent tint), the selected row (outlined), and a row whose group carries on in the next row (no divider under it — Script's lines of one paragraph). Born 2026-09-29 for Script's chapter page |
| `.jv-overlay` / `.jv-modal` | modal shells |
| `.jv-fill` | pane views that fill the content area (instead of `height: 100%`) |
| `.jv-split` (+ `__col`) | input → result two-column grid for make-a-thing surfaces; stacks below 1100px |
| `.jv-split--wide-left` | an editor beside its summary — the left column 1.5 × the right (the persona page, mock `_s7`; 2026-10-04); stacks below 1100px like `.jv-split` |
| `.jv-knob-grid` (+ `__knob`, `__head`, `__label`, `__row`, `__unit`) | knobs three across: label above (its ↺ at the head's right end), the `UiSlider width="full"` filling its cell, the unit after; narrows the kit's number box through its `--w-num` token. The persona page's How it speaks and Sampling (2026-10-04, where the mock's look was ruled to beat size-to-content). `.jv-knobs` stays the one-per-row shape elsewhere |
| `.jv-field-label-row` | a block field's label with something at its right end — the tag naming the model that reads the field, or a quiet action on it |
| `.jv-drop` (+ `--active`, `--filled`, `__row`) | a drop box for a recording: drag it in, paste a URL, browse, record (born on Voices → Clone; promoted 2026-10-04 when the clone maker moved to the persona's page — `PersonaCloneMaker.vue`) |
| `.jv-field-row` | a row of block-labelled fields with a trailing action, bottom-aligned structurally (strips the kit's `.ui-field` margin — never re-align with per-view nudges) |
| `.jv-col--start` / `.jv-stretch` | card-body children keep content width / one child opts back into full width |
| `.jv-hint` | one quiet line under a row or field — cost or requirement of the choice above. **12.5px floor** (2026-08-21 "stop using small text"): no user-facing text renders smaller |
| `.jv-text-warn` | text that is waiting on you, in the theme's amber (`--warn-ink`, which follows the theme; `--warn` is too light for text) — Script's Check questions (2026-10-06). Red stays for what is broken |
| `.jv-memcells` · `.jv-memcell` | AI Settings' memory strip cell outside AI Settings — eyebrow label, value, the model it holds under it (Home, 2026-10-06). The kit's own cell is scoped to its strip |
| `.jv-transport` (+ `__time`) · `.jv-player-el` | a page's one player: `usePagePlayer()` + `PagePlayer.vue` (the hidden `<audio>`) + `PlayTransport.vue` (seek bar and "0:02 / 0:05") shown in the row whose ▶ started it — never a second `<audio controls>` line under the rows. Voices and Render (2026-10-07) |
| `.jv-lede` | the one-paragraph explanation under a card title — body-size (13.5px) because a lede is content, not a footnote. User-language only, never file formats or internal jargon |
| `.jv-mt10` / `.jv-mt12` / `.jv-mb14` / `.jv-inline-row` / `.jv-note-xs` | spacing + inline-row utilities (SettingsView referenced them for months while nothing defined them — defined 2026-08-21; `-xs` renders at the same 12.5px floor) |

Dialogs are always `confirmDialog` / `promptDialog` — never a native dialog.

## Design-conformance checklist

Born 2026-06-12, after a geometry-only "sweep" missed control-level slop: a sweep that doesn't check
these checked nothing. When asked to sweep the app, use the canonical method verbatim from
`docs/plans/archive/2026-06-12-design-conformance-audit.md` §Sweep method — two passes including screenshot
judgment, modal and data-state coverage, a recorded-exceptions ledger, and findings before fixes.

1. **Booleans** → `UiToggle` (on/off settings) or `UiCheckbox` (multi-select or inline). Never a native checkbox.
2. **Inputs and selects are sized to content** via the `width="name|id|token|…"` prop (→ `.ui-w-*`, token-driven). Never full-width stretch unless the content is prose.
3. **Form rows** → `UiField`. Sections that group controls → `.jv-card`, not naked rows on the page background.
4. **Buttons** → `UiButton` intents only. No scoped one-offs, no raw `.btn` classes.
5. **No internal jargon in user-facing copy** ("pin", "manifest", feature keys). If a knob's effect is invisible — a prompt resolved server-side, say — SHOW the resolved truth in the UI, never an empty box with a "defaults apply" placeholder. (The Speaker Lab lesson.)
5b. **No raw ids in user-facing GUI** (user decree 2026-08-15: *"we should not be using these types of ids in user facing gui"*). A UUID, or a minted id like `voice_<32 hex>`, is never a label, a chip, or a dropdown option — and never the `|| fallback` when a name lookup misses. Two consequences, both load-bearing: **(a) the API ships the name with the id** — `/v1/projects/{id}/cast` carries `persona_name` for exactly this reason — rather than every screen resolving ids against a client-side cache that can be empty; **(b) a lookup that misses says what is wrong** — "(deleted persona)", "(voice unavailable)" — because an id tells the reader nothing they can act on. Exempt, and only as `<code>` technical detail beside a name: engine slugs, audio device ids, job ids, MCP client ids.
6. **Ghost buttons are borderless quiet utilities** — the kit's `intent="ghost"` (`ui-btn--ghost`: no border, no fill, a tint on hover), as the mock draws them (`.btn.g`). Use one for a quiet, secondary action beside the thing it acts on ("Open ➜", "Edit", "↻ Re-check"); a stand-alone action that must be found is `secondary` or `primary`. This line used to say *"No borderless text-only buttons (user decree 2026-06-12: 'no ghost buttons'). The ghost variant renders as a thin-bordered quiet utility"* — the kit's ghost had no border by then, the app used it 126 times, and the mock, approved later, uses it; on 2026-09-30 the user chose the mock (*"your rec on all go"*, option A of `docs/plans/2026-09-30-project-lexicon.md` §6 item 5). Selection chips use `UiChip` with a `:selected` state — a chip pattern, not a button.
6b. **One meaning per word, one wording per fact** (decided 2026-10-06 — the user: *"we have 3 things
   speaker cast persona it is confusing"* · *"same info presented in different ways for no reason"*;
   the audit and its rows: `docs/plans/2026-10-06-one-word-one-meaning-audit.md`).
   - **Speaker** — only ever a person in the book who says lines. A list of them is *the book's
     speakers* / *in this book*; never "the cast", "cast member" or "character".
   - **Persona** — only ever a voice from the library. Next to a speaker it is written **persona X**
     (*Cast: persona June*), because a persona is often named after its speaker.
   - **Cast** — only the Studio step and the act of giving a speaker a persona (*Cast them ➜*, *cast
     with persona June*). "Plays" stays the verb (*persona June plays Nettle*).
   - **A fact has one wording**: how a model can be directed is `personaFacts.directionCell` /
     `DIRECTION_OPTIONS`; a voice's type `voiceKindLabel`; its gender `voiceGenderWord`; a model is
     its **Model** name and its size a **Version**; a line's state the Render words. A screen never
     writes its own sentence for a fact a shared helper words — add to the helper instead.
7. **Layout grammar** (rewritten 2026-06-12 after the copy-JustWrite correction — *"you just decided to copy instead of think"*):
   - Size every control to its content and let rows END where the content ends. Never inflate a field to "use" the width; dead space to the right of well-sized controls is not a defect.
   - Group controls by what they act on — preset actions live beside the preset dropdown.
   - Put the primary action where the eye lands when the user finishes: the end of the form, above its results. Not flung to a far edge.
   - Never orphan a fragment across a spacer.
   - Don't surface internal modes as buttons. Let auto-detection move the selection and show provenance as a muted note.
   - References, including JustWrite, are for extracting PRINCIPLES. Copying a reference's layout inherits its flaws.
