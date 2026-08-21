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
2. **If genuinely nothing exists**, promote a NEW canonical class into `styles.css` first — never a
   scoped one-off — so the next view has a precedent to find.

A grep for the obvious class names costs five seconds; the user paying for the inconsistency costs
a test round.

## The canonical inventory (JV-local layout and shell classes)

Form primitives come from the shared `@delebash/llm-ui` kit — `UiButton`, `UiInput`, `UiTextarea`,
`UiSelect` (Reka), `UiToggle`, `UiCheckbox`, `UiField`, `UiTag`, `UiChip`. The `Jv*` forks were
deleted 2026-06-23 and there is no local `components/ui/` directory. What follows is JV-local
**layout and shell** structure only, all verified present in `styles.css`:

| Class | Shape it solves |
|---|---|
| `.jv-subnav` (+ `__tab`, `__tab--active`) | a VIEW's own tab strip (Voices, Labs) |
| kit `SettingsShell` | a MENU INSIDE a view — sections as data, top strip, full-width panel. Settings' General/Appearance/… strip, and the LoRA tab's Preparer/Dataset/Training. Not `.jv-subnav`: the hand-rolled one died with the parity batch |
| `.jv-logbox` (+ `--short`, `__line`, `__empty`) | a background job narrating itself while it runs (the LoRA Preparer + trainer). NOT the kit `LogsPanel`, which is server log FILES per day with download |
| `.jv-progress` (+ `__track`, `__track--wide`, `__bar`, `__bar--done`, `__bar--fail`) | a determinate job's completion, in a table cell or under a heading |
| `.jv-lib-toolbar` | search → filter chips → data dropdowns → spacer → actions, with "+ New" rightmost |
| `.jv-table` (+ `__actions`, `__empty`) | library CRUD, row-click opens the full-form dialog |
| `.jv-card` (+ `__header`, `__title`, `__body`, `--bare`, `--flat`, `--soft`) | grouping controls into a section |
| `.jv-overlay` / `.jv-modal` | modal shells |
| `.jv-fill` | pane views that fill the content area (instead of `height: 100%`) |
| `.jv-split` (+ `__col`) | input → result two-column grid for make-a-thing surfaces; stacks below 1100px |
| `.jv-field-row` | a row of block-labelled fields with a trailing action, bottom-aligned structurally (strips the kit's `.ui-field` margin — never re-align with per-view nudges) |
| `.jv-col--start` / `.jv-stretch` | card-body children keep content width / one child opts back into full width |
| `.jv-hint` | one quiet line under a row or field — cost or requirement of the choice above. **12.5px floor** (2026-08-21 "stop using small text"): no user-facing text renders smaller |
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
6. **No borderless text-only buttons** (user decree 2026-06-12: "no ghost buttons"). The ghost variant renders as a thin-bordered quiet utility. Selection chips use `UiChip` with a `:selected` state — a chip pattern, not a button, and exempt.
7. **Layout grammar** (rewritten 2026-06-12 after the copy-JustWrite correction — *"you just decided to copy instead of think"*):
   - Size every control to its content and let rows END where the content ends. Never inflate a field to "use" the width; dead space to the right of well-sized controls is not a defect.
   - Group controls by what they act on — preset actions live beside the preset dropdown.
   - Put the primary action where the eye lands when the user finishes: the end of the form, above its results. Not flung to a far edge.
   - Never orphan a fragment across a spacer.
   - Don't surface internal modes as buttons. Let auto-detection move the selection and show provenance as a muted note.
   - References, including JustWrite, are for extracting PRINCIPLES. Copying a reference's layout inherits its flaws.
