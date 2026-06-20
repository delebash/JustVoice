# Design analysis: Persona/Profile/Voice + multi-use audiobook workflow

## Context

JustVoice grew out of JustTTS, where the only use case was audiobook production. JustWrite drove the workflow end-to-end through a "straightforward" 3-tab Cast → Script → Render flow in `StudioView.vue`, with ML speaker attribution gluing prose to characters.

JustVoice now serves five audiences (audiobook, game/Unreal, podcast, dictation, accessibility) sharing the same engines + voices + lexicons + personas. The user is asking two related questions:

1. **What's the difference between a Persona and a VoiceProfile per use case? Do they need to be separate, or just slightly different per use case?**
2. **For audiobook speaker attribution we were lifting JustWrite's pipeline — what's done, what's next? And now that the app is multi-use, what should the workflow look like?**

This file is a design proposal — not an implementation plan — produced after reading the actual code state in JustVoice + JustWrite.

---

## Q1: Persona vs VoiceProfile vs Voice

### What each is today

- **Voice** — the TTS artifact (engine preset, or cloned/designed WAV). No `Voice` SQL table. Stored as JSON manifests at `$DATA_DIR/voices/<id>/manifest.json` (`server/justvoice/storage/voices.py:32`); a `Voice` Pydantic DTO (`server/justvoice/models.py:321-328`) is a lightweight list-shape that fuses engine presets + stored clones for `/v1/voices` consumers.
- **VoiceProfile** — voice + delivery defaults + effects chain + personality prompt + lexicon override + default engine, bundled as a reusable cross-project config (`server/justvoice/database/models.py:57-94`). Created via `/v1/profiles`.
- **Persona** — a named character with bio + FK to a VoiceProfile (`server/justvoice/database/models.py:127-149`). Stored as JSON files (`server/justvoice/storage/personas.py` + `server/justvoice/api/personas_api.py:19-63`), not in the SQLite Persona table directly — there's a duplicated storage layer.

### The actual problem

There's a real **layering bug** plus **field duplication**:

| Layer | What it says Persona points at |
|---|---|
| DB schema | `personas.voice_profile_id` → `voice_profiles.id` (`models.py:139`) |
| API + Pydantic | `voice_id: str` (`models.py:367`, `personas_api.py:24`) |
| PersonasView UI | Fetches `/v1/voices` (raw Voice IDs), assigns to `voice_id` (`PersonasView.vue:52, 102`) |

So today, a Persona created in the UI references a raw Voice ID stored as if it were a VoiceProfile ID. This works only because nothing downstream enforces the FK match.

Duplicated semantics across Persona and VoiceProfile:

- `personality` on VoiceProfile (`models.py:82`) drives the Compose button; `bio` + `personality_enabled` on Persona (`models.py:138, 144`) drive LLM rewrite. Same purpose, two places.
- `default_delivery` on VoiceProfile (`models.py:88`); also a writable Persona API field that **isn't stored in the Persona DB row** (`personas_api.py:24`, `models.py:368`). Dead write.
- `lexicon_id` on both Persona + VoiceProfile; Persona's overrides Profile's.
- `engine_override` on Persona shadows `default_engine` on VoiceProfile.

### Per-use-case relevance (what each layer actually means)

| Use case | Voice | VoiceProfile | Persona |
|---|---|---|---|
| Audiobook | Yes — library of presets/clones to pick from | Yes — narrator + per-character locked configs that survive across books | **Yes — per-book cast roster, each character with bio + voice assignment** |
| Game (Unreal) | Yes | Yes — locked-once NPC voice configs | **Yes — NPC roster, often cross-project (one Mara across 12 quests)** |
| Podcast | Yes | Yes — host + recurring guest profiles | **Optional** — only when there are multiple recurring speakers worth naming |
| Dictation | Yes | Yes — user's single saved voice config | **No** — speaker is the user |
| Accessibility | Yes | Yes — user's accessibility voice | **No** — speaker is the user |

So: Voice + VoiceProfile are **universal**. Persona is the **identity layer that's only meaningful for multi-speaker content** (audiobook + game always; podcast sometimes).

### Corrected model (locked after user clarifications)

The three layers stay but the boundaries change:

- **Voice** = TTS artifact. Library. Unchanged.
- **Persona** = character. **Self-contained, no FK to Profile.** Has `name`, `bio`, `personality`, `voice_id` (FK to Voice), optional `engine_override`, optional `lexicon_id`, optional `render_preset_id`. The character identity layer. Cross-project for game NPCs, per-book for audiobook characters.
- **Voice template** (the entity currently called Profile / VoiceProfile) = a **saved set of defaults** for filling in a new Persona. Same shape as Persona basically (`name`, `voice_id`, `delivery`, `effects`, `lexicon_id`, default `personality`). "Apply template" copies the template's fields into a Persona at apply time. **Not a linked entity** — once applied, the Persona is independent; the template is just a starting point.

### Personality semantics (LOCKED)

`Persona.personality` is **a TTS delivery instruction**, not LLM rewrite at render time:

- Engines that declare `supports_instruct_freeform` (Qwen3-TTS, LuxTTS today): the personality string is passed as the engine's `instruct` / style-prompt field at render time. Affects HOW the line is delivered (tone, pacing, emphasis, accent). The manuscript words stay verbatim.
- Engines that don't accept freeform delivery instructions: personality is ignored at render. It's still used by Smart-assign (LLM uses it as input context to match the right voice to the character) and shown in the UI as character documentation.
- **No automatic LLM rewrite at render.** Manuscript words are sacred.

### Rewrite is a separate, explicit LLM tool

Compose and Rewrite are LLM-only actions, both manual, both with user-visible preview:

- **Compose**: LLM writes a fresh in-character line from nothing, using `persona.personality` as the system prompt. Drops the result into the textarea. User reviews + edits + sends to TTS when ready.
- **Rewrite**: LLM takes the current textarea text + `persona.personality` and produces a rewritten in-character version. Shows the result in a preview (or side-by-side diff). User accepts → text replaces the textarea. User rejects → original stays. THEN user sends to TTS (regular Generate flow).
- Neither runs automatically at Render time. The existing "🎭 Persona rewrite" checkbox in Generate's floating bar (today a dead stub at `GenerateView.vue:603-616`) becomes a **"Rewrite"** *button* that previews-then-accepts.
- In Studio Script tab: per-block right-click → "Rewrite this line in character" → same preview-then-accept flow, but the accepted text overwrites `block.text`.

### Schema changes (revised — much smaller than I first proposed)

1. **Persona points at Voice directly.** Rename the current `voice_profile_id` column to `voice_id`. Point it at `voices.id`, not `voice_profiles.id`. PersonasView fetches `/v1/voices` (which it already does) — that part was actually correct.
2. **Keep all per-character fields on Persona.** `bio`, `personality`, `voice_id`, `engine_override`, `lexicon_id`. These ARE the character. **`personality_enabled` drops** — it's no longer needed because personality is always-on as a TTS instruction (or ignored if the engine doesn't accept it).
3. **Drop the dead `default_delivery` API field on Persona** — writes are accepted but never persisted.
4. **VoiceProfile becomes a template/preset entity.** Same schema basically (`name`, `voice_id`, `delivery`, `effects_chain`, `default_lexicon_id`, `personality`). Naming pending — see "What to call Profile" below.
5. **Personas tab gates by use_case.** Audiobook + game + podcast show it; dictation + accessibility hide it.

### What Profile / Voice template is FOR — concrete use cases

A user creates a template when they have a setup they want to reuse:

- **Reusable narrator across many books.** Aria voice + warm-narration delivery + standard pronunciation lexicon + "calm, intimate, slightly conspiratorial" personality. Save as a template. Book 1's narrator Persona → click "Apply template" → fields filled in. Book 2: same template. Book 3: same template. If the template changes later, existing Personas don't change (they already copied the fields) — power users re-apply if they want the update.
- **NPC voice config across games.** Cloned Jane Smith voice + Chatterbox at temperature 0.85 + Boston lexicon + "Clipped, world-weary, dry" personality. Save as a template. Any NPC who should sound like Jane Smith → Apply template → done.
- **A user's "default for new characters."** Save your most-used voice + delivery as a template; new Personas start from it.

If the user never creates a template, the app still works fine — every Persona is self-contained and configured directly. The template is a power-user shortcut for repeating patterns, not a required layer.

### What to call Profile

The name "Profile" is overloaded in TTS-land (engine voice profiles, voice profiles, character profiles…). Renaming to something self-describing reduces friction. Candidates surfaced in Q1b below.

---

## Q2: Audiobook speaker attribution + multi-use workflow

### What's actually landed

**The data model is fully ready.** From the exploration:

- `Block` table has `persona_id` FK (`server/justvoice/database/models.py:239-255`).
- JustWrite import adapter (`server/justvoice/imports/adapters/justwrite.py`) maps `characters[]` → Persona rows and lines with `character_id` → Block rows with `persona_id` FK (`projects_api.py:474-541`).
- Block CRUD endpoints work: `GET/POST/PATCH /v1/scenes/{id}/blocks` with `persona_id` round-trip (`projects_api.py:306-345`).
- ChapterView renders blocks with the persona pill (`ChapterView.vue:362`).

**End state today:** you can import a JustWrite-attributed book and render it. You **cannot** take raw prose pasted into JustVoice and produce attributed Blocks.

### What's missing

The **extraction layer is completely absent**:

- No `/v1/scenes/{id}/analyze`, no `/v1/scripts/detect-speakers`, no extraction module under `server/justvoice/`.
- No LLM service in the renderer (`src/renderer/src/services/` has no `llm.js` / `aiStream.js` — JustWrite's are 857 LOC + supporting files).
- No `StudioView.vue`, no `SpeakerLabView.vue`, no Script-tab UI.
- No `SpeakerCorrection` table; no correction memory.
- No 3-tier (Guided / Direct / Reasoned) prompt system.
- No dialogue-anchor propagation, no confidence-floor demotion to "unknown".

### Why the multi-use workflow feels confusing

JustWrite's flow was straightforward for one reason only: **one use case → one mental model → 3 tabs in a fixed order.** The user couldn't get lost because there was nothing else to do.

JustVoice has 17 sidebar tabs serving five use cases. Today the codebase has the right primitives — `project_type` enum (`audiobook` | `game_voicelines` | `podcast` | `custom`), `useCopy()` composable that swaps terminology, `WelcomeOnboarding.vue` that captures the user's primary use case, App.vue routes to a use-case-aware landing tab. But:

- **Sidebar isn't filtered** by use case. A game dev sees Chapter; an audiobook producer sees Captures.
- **ChapterView hardcodes "Scene/Block"** instead of using `useCopy()`.
- **OverviewView's empty-state copy** ("renders started from Generate, Chapter, or batch renders from `{{ copy.book.plural }}`") is audiobook-shaped.
- **Mastering preset default** only applies ACX for audiobook (`projects_api.py:467`); game/podcast/custom get None with no UI prompt.
- **There is no "first thing to do" flow per use case.** Onboarding picks a use case, lands them on a generic Overview, and stops.

### Recommended solution

A **per-use-case "primary flow" view** — call it Studio — that gives each audience one opinionated entry path the way JustWrite did:

| Use case | Studio shape | Primary tabs |
|---|---|---|
| Audiobook | 3-tab Cast → Script → Render (JustWrite parity) | Cast / Script / Render |
| Podcast | Same 3-tab when multi-speaker; else single-pane Generate-into-Story | Cast / Script / Render |
| Game | NPC-centric: Voice library + per-character cross-project line list + batch render | NPCs / Lines / Render |
| Dictation | Captures + Generate directly (no Studio) | n/a — Captures is the primary flow |
| Accessibility | Generate directly (no Studio) | n/a |

**Sidebar gates by project_type**: Studio + Personas surface for audiobook/podcast/game; Captures surfaces for dictation; Stories surfaces for podcast/game; Chapter surfaces for audiobook. Universal tabs (Engines, Voices, Profiles, Settings, Overview, Generate) stay always-on.

This matches backlog task **#81 (Lift JustWrite StudioView)** but reframes it: Studio is the audiobook+podcast+game opinionated flow, not just "port the JustWrite view 1:1". The same Studio shell adapts via `useCopy()` so audiobook says "Chapter / Cast" and game says "Quest / NPCs" but both walk the same Cast → Script → Render arc.

### Speaker attribution — sequenced steps

Mapping to backlog tasks the user just recreated:

1. **#75 Project/Scene/Block research** (small, blocks the rest). Decision doc: confirm one schema across use cases. From the exploration this is already true in code — Project → Scene → Block is generic — so the deliverable is a short markdown that locks it.
2. **#74 Backend extraction endpoint**. Lift JustWrite's `speakerAttribution.js` pipeline to `server/justvoice/extraction/`. Build `POST /v1/scenes/{id}/analyze` that takes scene text + cast → returns `[{position, speaker, confidence}]`. Use Claude/GPT structured output with the 3-tier prompt system. Stores results as Block rows with `extraction_confidence`.
3. **#81 Studio view — Cast + Script tabs first**. Surface the Studio shell for audiobook/podcast/game. Wire the Script tab to `/v1/scenes/{id}/analyze`. Editable speaker dropdown per row.
4. **#84 SpeakerCorrection table + memory loop**. New SQLAlchemy table; up to 200 per project; top 12 most recent injected into the next analyze call as worked examples. Closes the feedback loop that made JustWrite's attribution improve over time.
5. **#83 Smart-assign**. Cast tab button that sends characters + voice library to LLM, returns proposed character→voice mapping. Requires VoiceProfile / Voice to carry gender/age/accent/tone descriptors (some already on `VoiceRecord`).
6. **#82 Render Lab** + **#78/79/80 Extraction lab** — post-MVP polish; not on the critical path to a working audiobook flow.

### Workflow after this lands

Audiobook user: onboarding → picks "audiobook" → lands on Studio → Cast tab (assign voices to characters, optional Smart-assign) → Script tab (paste prose or import from JustWrite, click Analyze, fix any low-confidence rows) → Render tab (batch render, ACX master, export M4B). One linear flow. Same Cast → Script → Render mental model as JustWrite.

Game user: onboarding → picks "game" → lands on Studio → NPCs tab (Persona roster with cross-project line counts) → Lines tab (per-NPC line list, batch select, edit/regen) → Render tab (WAV per line + JSON sidecar export). Different content, same shell.

Dictation user: onboarding → picks "dictation" → lands on Generate (or Captures). Studio never appears; sidebar hides Chapter/Stories/Personas. The complexity isn't visible.

---

## Q3: What is Generate for? How does it relate to Studio? What about Compose + Persona rewrite?

### What Generate actually does today

`src/renderer/src/views/GenerateView.vue` (1115 LOC) is **five surfaces fused into one**:

1. **Single-line synthesis workbench** — textarea + Voice picker + ▶ Generate → audio. Posts to `/v1/generate` with `{voice, text, delivery?, profile_id?, lexicons?}` (`GenerateView.vue:386-398` → `server/justvoice/api/generate_api.py`).
2. **Engine capability surface** — capability banner pills (cloning / IPA phoneme / multi-speaker / emotion taxonomy / paralinguistic taxonomy / free-form delivery), pitch/temp/seed gating, **dynamic engine-knob renderer** that reads `engineCaps.knobs` from `/v1/engines/capabilities` and renders typed sliders + number inputs per `KnobSpec` (`GenerateView.vue:167-185, 817-873`). This is the canonical "what does THIS engine support" reference in the app.
3. **Inline-tag playground** — `SlashTagMenu` at `/` keystroke, engine-aware emotion + paralinguistic + SFX tag categories, button-triggered "🏷️ Insert tag…" affordance (`GenerateView.vue:560-580`).
4. **Profile testing surface** — Profile chip in the floating bar; selecting a profile pulls its `default_lexicon_id`, gates Compose + Persona rewrite, and passes `profile_id` to `/v1/generate` so the 3-tier delivery merge applies (`generate_api.py:201` → `delivery_merge.merge_delivery`).
5. **Take history table** — `/v1/takes/recent` (route lands with #87), bottom of the view, ▶ routes back to the global audio player.

### What Compose is

`POST /v1/profiles/{id}/compose` (`server/justvoice/api/profiles_api.py:202-233`).

- **Intent:** LLM writes a fresh in-character line of dialogue using the profile's `personality` prompt, drops it into the Generate textarea.
- **Trigger:** 🎲 Compose button in Generate's floating bar (`GenerateView.vue:622-632`), disabled until a profile with non-empty `personality` is selected.
- **Status today:** STUBBED. Returns HTTP 501 with `"LLM service not configured. Add an OpenAI-compatible endpoint to settings.llm to enable the Compose action."` Both `composeLine()` (`GenerateView.vue:309-329`) and the backend (`profiles_api.py:227-233`) exist; the LLM service that would resolve the 501 doesn't.
- **Useful for:** prototyping a personality prompt ("does this character voice sound how I want?"), filler line generation, discovering whether the prompt produces coherent dialogue.

### What Persona rewrite is

Checkbox "🎭 Persona rewrite" in the floating bar (`GenerateView.vue:603-616`).

- **Intent:** take whatever the user typed in the textarea → run it through the LLM with the selected profile's `personality` prompt → that REWRITTEN text gets TTS'd.
- **Gating:** same as Compose — requires `selectedProfile.personality` non-empty.
- **Status today:** Checkbox exists with title "Re-roll the input through the profile's personality prompt via LLM before TTS", but `personaRewrite` is **never read** by `generate()` (`GenerateView.vue:360-415`) — it's a UI stub with no backend wire-up. Not even a 501; the request goes through silently with the raw text.
- **Useful for:** "I have a generic line, make it sound like THIS character" — ad-hoc rewriting at single-line granularity.

### Compose vs Persona rewrite — the actual difference

| | Input | LLM does | Output |
|---|---|---|---|
| **Compose** | profile.personality only | generates a brand-new in-character line from nothing | text → textarea (user can edit, then Generate) |
| **Persona rewrite** | user_text + profile.personality | rewrites the user's line in the character's voice | text → directly into the synthesis pipeline (no textarea round-trip) |

Same primitive (LLM + personality prompt), two directions. Both blocked on the same missing piece: the LLM service in the renderer (planned as the new "Port LLM service from JustWrite" task in the execution sequence above).

### Generate vs Studio — does the playground role still make sense in multi-use?

Yes, and there's no destructive overlap if the boundary is drawn at **single line vs script**:

- **Generate** = **single-line workbench**. One line, ad-hoc, rendered immediately. The view exposes everything about the loaded engine + voice + profile + delivery; it's the canonical "try a thing" + "see what this engine can do" surface.
- **Studio** = **script production environment**. Cast → Script → Render. Multi-line, multi-character, batched, persistent.

Per use case:

| Use case | Generate's role | Studio's role |
|---|---|---|
| **Audiobook** | Test a voice before adding to cast. Try delivery knobs. Preview a character's personality via Compose before locking it on a Profile. Quick one-off lines outside a book. | Primary production flow. |
| **Game** | Prototype an NPC line. Check engine capability for batch-render planning. Test a voice. | Primary production flow (NPCs / Lines / Render). |
| **Podcast** | Try out host voices + designed voices. Compose sample dialogue. | Primary production flow when multi-speaker; thin when solo. |
| **Dictation** | **Primary production view.** User types, hits Generate (or speaks via Captures → text → Generate). No Studio. | Hidden. |
| **Accessibility** | **Primary production view.** Persistent voice, persistent settings, ad-hoc TTS. | Hidden. |

So Generate is **always relevant**: workbench for the four script-producing audiences, primary view for the two single-line audiences. Studio adds a layer ABOVE Generate for batched / character-attributed work — it doesn't replace the workbench.

### Where Compose + Persona rewrite belong

- **Compose stays on Generate.** It's a single-line-from-nothing action — prototyping ergonomic, not script-production ergonomic. In Studio you don't compose lines; you import a manuscript or write into the Script tab.
- **Persona rewrite stays on Generate** for the ad-hoc single-line case. **Studio gets a parallel batch action**: "Rewrite N selected blocks in character" on the Script tab. Same backend primitive (LLM + personality prompt + input text), different ergonomic. The new LLM service ports once; both views drive off it.
- **Compose semantics could expand** once Studio lands: a "Compose into Script" action on the Studio Script tab that LLM-writes filler dialogue and inserts it as a new Block (instead of into the Generate textarea). Same underlying endpoint, different drop target. Note this as a follow-on, not a v1 commitment.

### What this changes in the execution sequence

The "Port LLM service from JustWrite" task (Phase 2 above) is now load-bearing for **three** features, not two:
1. Compose endpoint (resolves the 501 — `profiles_api.py:227-233`)
2. Persona rewrite checkbox (wires the stub to backend — `GenerateView.vue:603-616`, `personaRewrite` ref)
3. Speaker attribution extraction (#74 — `POST /v1/scenes/{id}/analyze`)

All three share the same LLM client + streaming wrapper + provider routing. Ports once.

---

## Q4: Whole-app UX architecture — how to make the workflow obvious

The user asked for a deep look at the whole application and a recommendation. This section is the audit + the recommendation, cited per surface.

### Per-surface audit — what each piece does today and where it confuses the user

#### Entry-point surfaces

| Surface | What it does today | Where it confuses | Cite |
|---|---|---|---|
| **WelcomeOnboarding** modal | 6 cards (audiobook / game / podcast / dictation / accessibility / "a bit of everything") + "Choose later" button. Picking persists `primaryUseCase`; closing = `unset` | "A bit of everything" looks equal-rank with the real choices — most users will pick it to be safe, then land in the worst (generic) terminology mode. "Choose later" + backdrop click both go to the same `unset` state, which keeps every tab visible with neutral copy. No use-case-specific follow-up ("you picked audiobook — what's your typical book length?") | `WelcomeOnboarding.vue:35-72, 88-98, 100-105` |
| **App.vue sidebar** | Flat 18-item list, 80 px icon-only column, no grouping, all tabs always visible regardless of `primaryUseCase` | A first-time user sees the same surface as a power user. Webhooks looks as load-bearing as Generate. There's no "your work / your library / advanced" mental hierarchy | `App.vue:37-57, 180-196` |
| **App.vue DEFAULT_TAB_BY_USE_CASE** | Routes per use case: audiobook → `chapter`, game → `voices`, podcast → `chapter`, dictation → `generate`, accessibility → `settings`, multiple/unset → `overview` | Audiobook + podcast land on `chapter` but the user has no projects, no chapters → empty state with no "create one" prompt. Game lands on `voices` which is the LIBRARY, not the workflow. **Accessibility lands on Settings** — the config screen, not a working TTS surface | `App.vue:90-98, 111-125` |
| **OverviewView hero + quick-actions** | "JustVoice." display title + tagline + 4 use-case quick-action cards. Highlights the user's onboarded primary use case | Only shown when DEFAULT_TAB sends them here (multiple/unset). Audiobook/game/podcast/dictation/accessibility users SKIP this hero entirely. The brand intro + tagline + use-case CTAs are buried. Accessibility is missing from the 4 cards (`audiobook / game / podcast / dictation` only) | `OverviewView.vue:18-23, 147-173` |
| **useCopy() terminology layer** | Reactive dict mapping book/chapter/cast/line per use case (`audiobook=Book/Chapter/Cast/Line`, `game=Voice line set/Scene/NPC/Voiceline`, `podcast=Episode/Segment/Host/Block`, `dictation=Capture/Session/Voice/Block`, `accessibility=Document/Section/Voice/Line`, `multiple/unset=Project/Section/Character/Block`) | The mechanism is good, but ChapterView still hardcodes "Scene/Block" (per Agent 3 audit) and ProjectsView (BooksView.vue) labels its sidebar entry "Projects" instead of `copy.book.plural` — meaning the audiobook user sees "Projects" in the sidebar but "Books" everywhere inside the view. Inconsistency reads as a bug | `services/copy.js:19-64`; `App.vue:40` (hardcoded "Projects"); ChapterView per Agent 3 |

#### Sidebar tabs — per-tab role + confusion source

Format: tab → what it is for THE WORKFLOW (not the technical surface), where it lives in the user's head, where it's confusing.

| Tab | Mental category | Today's confusion |
|---|---|---|
| Overview | **Home** | Only the hero. No "what's next given my state" prompt. An audiobook user with zero projects sees the same overview as a power user. |
| Generate | **Workbench** (single-line). Always relevant; primary for dictation/accessibility | Mixes 5 jobs (playground / engine-capability surface / inline-tag playground / profile testing / take history). The Profile chip + Compose button + Persona rewrite checkbox suggest "Studio-like" but actually all operate on a single line |
| Projects | **Library** of work (audiobooks, game line-sets, podcasts) | Sidebar label "Projects" doesn't match in-view "Books" copy. No "create your first book" wizard — empty state is just an empty list |
| Stories | **Workflow** for podcast + game multi-track assembly | Tab is always visible even for audiobook / dictation users who never use multi-track |
| Chapter | **Workflow** for audiobook + podcast (multi-block scripted work) | Hardcoded "Scene/Block" labels instead of `useCopy()`; visible to game/dictation/accessibility users who don't need it |
| Voices | **Library** — TTS artifacts (presets + clones) | Generates the second-most confusion (after Personas vs Profiles). Combined with the Persona/Profile FK bug, users don't know what to "pick" |
| Profiles | **Library** — reusable voice configurations (voice + delivery + effects + lexicon + personality) | Overlap with Persona (per Q1). Compose button on the Profile makes it look like the production surface, not the config surface |
| Personas | **Library** — characters (audiobook/game/podcast); irrelevant for dictation/accessibility | Voice-id-vs-profile-id FK bug (Q1). Always visible even for dictation users |
| Lexicons | **Library** — pronunciation dictionaries | Reasonable; surfaces only when the user knows they need one. No "discover a lexicon" entry point — easy to never know it exists |
| Captures | **Workflow** for dictation (push-to-talk → text → clipboard) | Always visible. For an audiobook producer this looks like cruft |
| Effects | **Library** — pedalboard chains | Reasonable as a library; could be folded into Voice/Profile editing |
| Engines | **Setup** — install / load model engines | Critical first-step for every use case, but it lives at position 12 in the sidebar. New users don't know to start here |
| Train | **Advanced** — PEFT/LoRA fine-tuning | Doesn't belong with primary workflow surfaces |
| Compare | **Tool** — A/B audio comparison | Reasonable as a tool but mixed with workflow tabs |
| Cache | **Infrastructure** — disk-LRU stats | Should never be a primary-level sidebar tab. Useful for debugging only |
| Audio | **Tool** — analyze/master a WAV outside the chapter pipeline | Tab name is just "Audio" — completely ambiguous. Belongs in tools, not main nav |
| Channels | **Infrastructure** — output channel routing | OS-level multi-monitor / OBS routing config. Most users never touch this |
| Webhooks | **Infrastructure** — HMAC-signed event notifications | Power-user feature, sidebar position equal to Generate |
| Settings | **Setup** — every operator knob | Reasonable; well-placed at the bottom of the list |

#### Empty-state + first-action audit

| Where | What today | Gap |
|---|---|---|
| Overview empty | "No renders yet. Open Generate to produce your first line, or import a manuscript from Books" | Says "Books" via `copy.book.plural` but only for `audiobook` use case; otherwise reads "Sections" / "Episodes" / "Voice line sets". No use-case-aware "do THIS first" prompt | `OverviewView.vue:310-311` |
| Active tasks empty | "Nothing in flight. Renders started from Generate, Chapter, or batch renders from {{copy.book.plural}} show up here" | Lists 3 entry paths but doesn't differentiate which is right for this user's use case | `OverviewView.vue:274-276` |
| Loaded engine empty | "No engine loaded. Go to Engines → Load to pick one." | Good — explicit next step. But it's buried 3 sections down inside Overview, and only shown when Overview is the landing tab | `OverviewView.vue:246` |
| Per-view ledes | Every view has a lede in `App.vue:37-57` describing the technical surface | The ledes explain WHAT the view is, not WHAT TO DO NEXT given the user's state | `App.vue:lede` per view |

### Synthesis — the three things that make this confusing

1. **18 tabs presented flat = no hierarchy.** A user can't tell which tabs are their daily workflow, which are library/setup, which are advanced. Webhooks looks as important as Generate.

2. **Landing tab assumes state that doesn't exist yet.** New audiobook user → Chapter view → zero projects → empty UI with no obvious "create one" CTA. The DEFAULT_TAB routing optimizes for repeat users at the cost of first-runners.

3. **The use-case onboarding does the right RECEIVING but the wrong TRANSMITTING.** It captures intent (great) but doesn't then drive a first-run flow that says "you picked audiobook → step 1: install an engine, step 2: import a manuscript, step 3: assign voices." So the customization stops at "what's this tab called" and never reaches "what should I do first."

### Recommended UX architecture (high-impact, low-risk changes)

Eight concrete moves, ordered by impact-to-effort:

#### 1. **Group the sidebar into 4 lanes.** (Highest leverage. Cheap to ship.)

Restructure the flat 18-item list into:

```
─── WORKFLOW ─────────────────────
  🏠 Home                  (renamed from Overview — always visible)
  🎬 Studio                (NEW — Cast / Script / Render for multi-line work)
  📝 Generate              (single-line workbench — always visible)
  📑 Chapter               (audiobook only)
  🎬 Stories               (podcast + game only)
  🎚️ Captures              (dictation only)

─── LIBRARY ──────────────────────
  📖 Projects              (renamed from Books)
  🎙️ Voices
  👤 Profiles
  🎭 Personas              (hidden for dictation + accessibility)
  📚 Lexicons
  🎛️ Effects
  🧠 Engines

─── TOOLS ────────────────────────
  ⚖️ Compare
  🔧 Audio Tools           (rename Audio → Audio Tools)
  🏋️ Train

─── ADVANCED ─────────────────────  (collapsed by default)
  💾 Cache
  🔊 Channels
  🔔 Webhooks
  ⚙️ Settings              (always pinned at very bottom outside the Advanced collapse)
```

Visible-by-default count drops from 18 → ~8-10 typical case. Mental hierarchy emerges: "do work" / "manage assets" / "use a tool" / "configure."

Filter within lanes by `project_type` per the locked decision in this plan (audiobook hides Captures; dictation hides Chapter/Stories/Personas/Studio; etc.).

#### 2. **Replace the use-case landing tab with a state-aware Home.**

App.vue's DEFAULT_TAB_BY_USE_CASE table goes away. Every user lands on **Home** (the new Overview). Home shows:

- The hero ("JustVoice." + tagline) — always, not just for "unset"
- A **"Next step"** card (the load-bearing UX change) that adapts to:
  - **No engine loaded** → "Install your first engine — JustVoice ships with 7. We recommend Kokoro for CPU realtime." [Install Kokoro] [Browse Engines]
  - **Engine loaded, zero projects (for non-dictation use cases)** → "Create your first {{copy.book.singular}}" or "Import from JustWrite" or "Start with a sample chapter"
  - **Project exists, zero blocks rendered** → "Render Chapter 1" / "Open Studio Script tab"
  - **Active work in progress** → the current Active tasks + Recent generations panels
- The use-case quick-actions card (only if no recent activity in the past 7 days)

This is the difference between dropping someone in a room and saying "good luck" vs handing them the first thing to do.

#### 3. **Make WelcomeOnboarding commit harder, then chain a 3-step setup.**

- Drop the "A bit of everything" card from the grid — make it a tertiary "Use neutral terminology" link under the cards. The 5-card grid (audiobook / game / podcast / dictation / accessibility) is cleaner.
- After picking a use case, show a follow-up step inside the same modal:
  - Audiobook → "Install Kokoro (realtime CPU) for testing, Chatterbox for production?" → installs in background
  - Game → "Install Kokoro + Chatterbox?" → installs
  - Dictation → "Bind your dictation hotkey (default Ctrl+Alt+Space)" → captures hotkey
  - Accessibility → "Choose your default voice from 54 presets" → voice picker
- This turns onboarding from "ask a question, persist, drop them somewhere" into "ask a question, set the user up so the first 30 seconds in the app work."

#### 4. **Build Studio per the locked decision (Q1+Q2 above).**

Three-tab Cast / Script / Render shell, useCopy()-driven labels, surfaced in the WORKFLOW lane for audiobook + podcast + game. This is the single biggest UX shift — it gives the multi-line use cases the same "straightforward" linear flow JustWrite had.

#### 5. **Per-view ledes become next-action prompts.**

Today: `Generate` lede says "Pick a voice. Type the line. Apply delivery overlay." — true, but it's a label for the surface, not the action.

Replace with state-aware prompts:
- Generate, no engine: "Load an engine on Engines → Load to start"
- Generate, engine but no voice: "{{ engine.name }} is loaded. Click Voices → pick a preset, or clone one from a reference WAV"
- Generate, ready: "Type a line below. Hit ▶ Generate."
- Chapter, no project: "Open Projects → Create new → {{ copy.book.singular }} to start"
- Chapter, no chapter: "Add a {{ copy.chapter.singular }} via Projects → {{ project.name }} → Add"

The lede becomes the always-visible "what to do next."

#### 6. **Fix the Persona/Profile/Voice mental model in the UI even before the schema cleanup.**

Per Q1's locked decision, the schema cleanup will happen. While that's in flight:
- PersonasView changes the dropdown title from "Voice" → "Profile" (matches the actual FK target).
- Add an inline explainer at the top of each library tab:
  - Voices: "The TTS artifact — a preset from an engine or a clone from a reference WAV. Pick one when you Generate."
  - Profiles: "A reusable voice configuration. Bundles a voice + delivery + effects + personality + lexicon. Use a Profile when you want the same setup across many lines."
  - Personas: "A character. Has a bio + voice assignment. Audiobook / game / podcast cast members live here. Hidden if you're using JustVoice for dictation or accessibility."

#### 7. **Add a "Help me start" topbar action that fires the Home next-step flow from any view.**

The topbar already has the per-view `HelpTrigger`. Add a small button next to it: "🧭 What now?" → opens a slide-out panel showing the user's current state ("Engine: Kokoro loaded · Projects: 0 · Recent renders: 0") + the next 3 actions. Always one click away from being unstuck.

#### 8. **The "Settings → re-run welcome" path is good — surface it more.**

`WelcomeOnboarding` already supports re-opening via "Run welcome again" in Settings → About. But make it discoverable: if the user is in `unset` mode for more than a session, banner at the top of Home: "Pick your primary use case to streamline the UI →" with a button.

### What this changes in the execution sequence

The plan's existing execution sequence stays, with these UX-architecture tasks inserted:

| Phase | What's added |
|---|---|
| **1 — Foundations** | + Sidebar lane structure (Workflow / Library / Tools / Advanced); + Home view rebuilt as state-aware (next-step card); + ChapterView `useCopy()` swap (already listed); + library-tab explainer headers |
| **2 — LLM plumbing** | (unchanged) |
| **3 — Extraction backend** | (unchanged) |
| **4 — Studio Cast + Script** | (unchanged — this IS the Studio rollout) |
| **NEW: 4.5 — Onboarding chain** | WelcomeOnboarding gets the follow-up "install + configure" step per use case |
| **5+ — Feedback loop, Studio Render, polish** | (unchanged) |

### New tasks this surfaces (to create after plan approval)

In addition to the four tasks listed in the prior "Locked decisions" section:

5. **Sidebar lane structure** — restructure `App.vue:37-57` into 4 lanes, per-tab visibility filtered by `project_type` and "advanced" collapse. Includes the `Audio` → `Audio Tools` rename and the Books → Projects sidebar-label fix.
6. **Home rebuild** — OverviewView becomes "Home", adds the **state-aware Next-step card** that reads engine/project/take state and renders the right CTA. Hero + quick-actions stay; "do this now" card is added above the catalogue.
7. **Onboarding chain** — WelcomeOnboarding adds a step 2 per use case (install engines, bind hotkey, pick default voice). Persists onboarding completion state so the next-step card doesn't show "install an engine" if onboarding already installed one.
8. **Per-view next-action ledes** — replace the static ledes in `App.vue:37-57` with state-aware prompts. Pulls state from store getters (engine loaded? project exists? takes rendered?).
9. **Library-tab explainer headers** — Voices / Profiles / Personas / Lexicons get a one-paragraph inline explainer at the top describing the role in the production model. Stops "I don't know what this is for" cold.
10. **Topbar "🧭 What now?" trigger** — small button next to HelpTrigger, opens a slide-out with current state + 3 next actions.

---

## Q5: EnginesView bugs + the LLM-engine architecture (one TTS + one LLM)

The user surfaced six concrete EnginesView bugs and a broader architecture question: the system loads one engine at a time, but speaker attribution needs an LLM *while* a TTS engine is loaded. Plus a recommendation lift target — JustWrite's audio + AI engine registry.

### Per-bug strict-diff (EnginesView.vue)

| # | Bug | Cause (file:line) | What changes |
|---|---|---|---|
| 1 | Click Load on Qwen3 0.6B → **both** variants' Load buttons spin | `EnginesView.vue:722` — `:loading="busy[e.id] === 'load'"` is keyed by **engine id**, not variant id. Any in-flight load on the engine lights every variant's button | Track in-flight loads as `busy[`${e.id}:${v.id}`] === 'load'` (or a `Set<string>` of `engineId:variantId` keys). Only the clicked variant's Load button shows the spinner |
| 2 | Spinner where there should be a **progress bar** | Load goes through `tasks.start({...})` (`EnginesView.vue:291-307`) but `statsFn` returns static strings (`['spawning subprocess', 'loading model weights']`); `tasks.update(task.id, {percent: ...})` is never called for load. The button itself is `JvButton :loading` which renders a spinner. Server-side load only polls the cancel flag at "safe steps" (per memory `project_state_2026_06_09_evening` §5) — no progress events are emitted | Two-part fix: (a) replace the JvButton spinner with a per-variant determinate progress track (reuse `.engine-card__progress-track` already in the CSS at line 1001). (b) Server-side: have `EngineManager.load()` emit phase events ("spawning" / "downloading" / "loading_weights" / "warming_up") through a job-like channel (mirror the install-job pattern at `EnginesView.vue:138-182` which already has phase + bytes_dl/bytes_total). Until that lands, render an **indeterminate** track (existing `.indeterminate` class at line 1017-1024) labelled by phase, not a spinning button |
| 3 | One global **Unload** button, not per-model | `EnginesView.vue:741-747` — top-of-card Unload calls `unload()` which POSTs `/v1/engines/unload`. Only one model loads at a time, so "per-variant unload" only means "show Unload on the row that's actually loaded" | In the model list (`EnginesView.vue:690-728`), the row matching `currentLoadedVariant` already gets a `--current` class. Replace its Load button (currently hidden by `v-if="v.id !== currentLoadedVariant"`) with an Unload button that calls `unload()`. Remove the top-of-card global Unload to reduce duplicate affordance |
| 4 | "Loaded: **default**" instead of the actual loaded model | `EnginesView.vue:645` — falls back to `e.default_variant_id` (the manifest recommendation) when `currentLoadedVariant` is unset. `currentLoadedVariant` is set ONLY when load() resolves inside this client (`EnginesView.vue:316`); on app reload / fresh tab, the server is the source of truth — but `/v1/engines` doesn't expose `current_variant_id` per engine. Two layer gap: server doesn't track it, client falls back to the wrong thing | Server-side: `EngineManager.current_variant_id()` getter + add `current_variant_id: str \| null` to `EngineInfo` (server/justvoice/models.py:500-512 area). Client: derive `currentLoadedVariant` from `engine.current_variant_id` on every `refresh()`, not from local state |
| 5 | LuxTTS shows "Load model" + "Remove downloaded models" before any model is downloaded | `EnginesView.vue:750-756` — destructive button shows whenever `e.status !== 'not_installed'`. For shared-venv engines (LuxTTS is one — see card foot at line 763), the venv install and model download are **decoupled** — venv can exist without any model present | Tri-state the status: `not_installed` (no venv) → `provisioned` (shared venv exists, zero models) → `installed` (at least one model downloaded) → `loaded`. Manifest can report `downloaded_variant_ids: list[str]` so the UI knows whether ANY model is present. Hide the destructive button when `provisioned` (nothing to remove); show only when at least one variant has weights on disk |
| 6 | User preferred a denser layout — the card form is too tall, the per-variant row grid I first proposed is still busy | `EnginesView.vue:603-759` — current card layout, ~50 lines per engine even before the model list nests inside | **Updated per user direction (lines up with JustWrite's SettingsProviderForm pattern):** each engine collapses to a compact row with a **model dropdown** + **info panel that updates when the dropdown selection changes** + **one pair of action buttons** (Download / Load / Unload / Delete, contextual to the selected variant's state). Same shape JustWrite already uses for provider config. The dropdown holds every variant; the info panel below shows the selected variant's size, VRAM requirement, license, "Currently loaded ✓" indicator, model description. Buttons swap based on the selected model's state: not downloaded → `[Download]`; downloaded but not loaded → `[Load]`; loaded → `[Unload]`. This gives all-engines-visible-on-one-screen back without the per-variant row clutter |

### The "one TTS + one LLM at a time" architecture

The current EnginesView foot text (`EnginesView.vue:762`) declares: *"Engines load one at a time — loading a new model unloads the previously loaded one to free GPU memory."*

This is enforced by `EngineManager` having a single `current_id()` slot. Today every engine in JustVoice is a TTS engine; loading Qwen3-TTS unloads Chatterbox.

**The problem**: speaker attribution (Q2) needs an LLM **loaded at the same time** as the TTS engine, because the user's workflow is: write a chapter → analyze speakers (LLM) → assign voices → render lines (TTS) → review → fix → re-analyze (LLM) → re-render (TTS). One-at-a-time forces a slow unload/reload cycle on every iteration.

**The right architecture**: extend the engine pool with a `kind` discriminator and one slot per kind.

```python
# server/justvoice/engines/base.py — proposed
class EngineMeta:
    engine_id: str
    kind: Literal["tts", "llm", "embedding"]  # NEW
    ...

class EngineManager:
    _loaded: dict[str, str]  # NEW — kind → engine_id
    def current_for(self, kind: str) -> str | None: ...
    def load(self, engine_id: str, ...) -> None:
        kind = self.get_manifest(engine_id).kind
        # unload only the same-kind slot, leave other kinds alone
        if self._loaded.get(kind) and self._loaded[kind] != engine_id:
            self.unload(self._loaded[kind])
        ...
```

One TTS slot + one LLM slot + optionally one embedding slot. Loading Claude doesn't kick Chatterbox out of VRAM. Loading a new TTS only kicks the prior TTS.

### What's wrong with "JustVoice has only local connections"?

The user's claim, verified against the code:

- **TTS — partially wrong.** `server/justvoice/engines/external_openai.py` (read in full) IS an HTTP TTS adapter that speaks the OpenAI `POST /v1/audio/speech` spec. It works against any URL — local OR online (ElevenLabs, OpenAI TTS, Speechify, etc., as long as they're OpenAI-compat). So online TTS is *possible* today. But the UI is a single-engine registration shape (one `external-openai-tts` row), not a multi-provider registry like JustWrite's 11-provider catalogue. ElevenLabs, Speechify, OpenAI TTS, Speechmatics aren't independently registered.
- **LLM — fully correct.** Zero LLM engines anywhere in JustVoice. No Claude / OpenAI / Gemini / Ollama / DeepSeek / OpenRouter. The Compose stub at `server/justvoice/api/profiles_api.py:227-233` returns HTTP 501 because the LLM service the code wants to call doesn't exist. Speaker attribution (#74) is blocked on this same gap.

So: the user is right that the LLM side needs to land, and right that the TTS side needs the same multi-provider-registry treatment JustWrite gives it.

### JustWrite's engine architecture (what to lift)

From the Explore audit of `E:\Dev\Web\justwrite-app\`:

- **6 LLM providers** registered as seed data: OpenAI-compatible (Ollama), OpenAI, Claude (Anthropic), Gemini (Google), DeepSeek, OpenRouter. All speak the OpenAI chat-completions shape except for special-cased Ollama `/api/chat` for thinking models.
- **11 TTS providers**: OpenAI TTS, ElevenLabs, Speechify, Speechmatics, Kokoro (local), Chatterbox (local), Dia (local), Edge TTS (system), Voicebox (local multi-engine), Qwen3-TTS (local), CosyVoice 3 (local).
- **Settings registry** in `views/SettingsProviderForm.vue` — one editor surface that handles baseUrl + apiKey + per-provider parameter schema (`domain/providerParams.js`) + live model discovery ("Fetch models") + live voice discovery ("Fetch voices") + tier pinning per model.
- **Unified LLM call wrapper** `runAiStream()` (`services/aiStream.js`) — handles abort signal, task panel registration, usage tracking, retries, tier-aware prompt selection.
- **Unified TTS dispatch** `clientFor(provider)` (`services/tts.js`) — branches by provider type to `OpenAICompatClient` / `ElevenLabsClient` / `SpeechifyClient` / `VoiceboxClient`.
- **Tier classification** (`services/modelMeta.js`) — heuristic match on model id → guided / direct / reasoned tier; user can pin a model to a specific tier.

Lift targets for JustVoice:

1. The provider-registry concept: every engine is a row with `{kind, providerType, name, baseUrl, apiKey, defaultModel, parameterSchema}`. Stored in settings.json under `settings.engines.providers[]`. UI: SettingsProviderForm-equivalent.
2. The `runAiStream` wrapper, ported to JustVoice's renderer with the same abort + task-panel + usage-tracking semantics.
3. The OpenAI-compat client with the special-case detectors (Ollama thinking, ElevenLabs proprietary, Speechmatics URL voice param) — but renamed to fit JustVoice's engine model.
4. Tier classification + per-feature LLM pinning (e.g. Settings → AI Features → "Speaker attribution" → pin to Claude Haiku 4.5 Direct tier).
5. The per-provider parameter schemas — they're the data that powers the dynamic settings form.

Note on lift fidelity: per RULE #3, the actual file-by-file port must be verified line-by-line in JustWrite at port time. The Explore agent's summary is research, not a wiring diagram — the file paths it cited need re-verification before any line is copied.

### Recommended approach — folding this in

A single architectural extension threads through everything above:

1. **Engine `kind` discriminator.** `EngineMeta.kind ∈ {tts, llm, embedding}`. `EngineManager` holds one slot per kind. Loading Claude doesn't unload Chatterbox.
2. **Provider registry on top of the engine pool.** Each provider (OpenAI / Claude / ElevenLabs / Ollama / etc.) registers as a multi-engine adapter — one provider can expose multiple engines (Claude provider → Haiku 4.5 + Sonnet 4.6 + Opus 4.7 engines). Mirrors JustWrite's pattern of `provider.models[]`.
3. **Online TTS as first-class.** Extend `external_openai.py` into a `providers/` package: `openai_tts.py`, `elevenlabs.py`, `speechify.py`, `speechmatics.py`, alongside the existing local engine adapters in `engines/`. Or: keep them under `engines/` with `kind=tts` and `backend=external-openai-tts` / `backend=elevenlabs` / etc., and the EnginesView treats them as just-another-row.
4. **LLM engines mirror.** A new `engines/llm/` directory (or `providers/llm/`) for `openai.py`, `claude.py`, `gemini.py`, `ollama.py`, `deepseek.py`, `openrouter.py`, `local_qwen.py`. Each registers with `kind=llm`. EnginesView renders them in a tabbed split (TTS Engines | LLM Engines) or two collapsing sections.
5. **EnginesView dropdown-selector rewrite (JustWrite-aligned).** Top-level tabs by kind (TTS / LLM / Embeddings). Each tab lists engines as compact rows. Per engine: a **model dropdown** picks a variant; the panel below it shows the **selected variant's info** (size, VRAM, license, description, "Currently loaded ✓" if applicable); the action area shows **one contextual button** based on the selected variant's state — `[Download]` if not on disk, `[Load]` if downloaded but not loaded, `[Unload]` if it's the active model. This mirrors JustWrite's `SettingsProviderForm` pattern exactly (one provider per row, dropdown for model, panel updates with the selection).
6. **The 6 EnginesView bugs collapse into the dropdown rewrite.** (a) Spurious dual-spin can't happen — there's only one Load button per engine. (b) Progress bar replaces button spinner — the action area is its own component, not a button's `:loading` flag. (c) Per-variant unload — Unload only appears when the dropdown selection IS the loaded variant. (d) "Loaded: X" reads from server truth (`current_variant_id` on EngineInfo). (e) Shared-venv tri-state — the action button is contextual, so `[Remove]` only appears when at least one variant has weights on disk. (f) Density — one row per engine, info appears inline below the dropdown only for the active selection.

### What this changes upstream of the plan

- **Studio Script tab + Compose + Persona rewrite all light up** once the LLM provider registry lands — same backend dispatch.
- **#74 ML extraction** uses the same LLM provider registry. Tier-aware extraction model selection (#79) maps directly to JustWrite's tier classification system.
- **The "Port LLM service from JustWrite" task** (already in execution sequence Phase 2) expands to: "Port LLM + TTS provider registry from JustWrite". Same lift, same files, double the surface absorbed.
- The migration is **non-breaking** for existing users: keep the single `external-openai-tts` adapter as legacy until the registry replaces it, then migrate any persisted external server config into a registry row.

### New tasks this surfaces (to create after plan approval)

In addition to the new tasks already listed above:

11. **Engine `kind` discriminator + multi-slot pool** — extend `EngineMeta` with `kind: tts | llm | embedding`; replace `EngineManager._current_id` with `_loaded: dict[kind, engine_id]`. Update `/v1/engines/{id}/load` and `/v1/engines/unload` to operate on one slot per kind. Backward-compatible default `kind=tts` for existing manifests.
2. **EnginesView dropdown-selector rewrite** — per-engine compact row with model dropdown + selection-driven info panel + contextual Download/Load/Unload/Delete button. Tabbed by kind (TTS / LLM / Embeddings). Mirrors JustWrite's `SettingsProviderForm` pattern. Fixes all six EnginesView bugs as a single restructure.
3. **Server-side load-progress events** — `EngineManager.load()` emits phase events (`spawning` / `downloading` / `loading_weights` / `warming_up`) through the existing job-channel pattern used by install. EnginesView consumes them like it already does for install (`EnginesView.vue:138-182`).
4. **`current_variant_id` reporting** — `EngineManager.current_variant_id()` getter; `EngineInfo` gains `current_variant_id` field; EnginesView derives "Loaded: X" from server truth on every refresh, not from local state.
5. **Provider registry — LLM side first** — lift JustWrite's `services/aiStream.js`, `services/openai-compat.js`, `services/modelMeta.js`, `domain/providerParams.js` and `views/SettingsProviderForm.vue` (file-by-file verified at port time per RULE #3). Six providers: OpenAI, Claude, Gemini, Ollama, DeepSeek, OpenRouter. Backend `server/justvoice/engines/llm/` package with one adapter per provider; all register with `kind=llm`.
6. **Provider registry — TTS side** — extend with OpenAI TTS, ElevenLabs, Speechify, Speechmatics, Edge TTS as separate adapters under `engines/` (or new `providers/`). Migrate the legacy `external_openai.py` into the registry. UI gets all of them in the TTS tab of the EnginesView grid.
7. **Wire Compose + Persona rewrite + speaker attribution to the LLM provider** — once the LLM registry exists, `profiles_api.py:227-233` calls the user's pinned LLM via the new `runAiStream` equivalent; the persona-rewrite checkbox at `GenerateView.vue:603-616` gets wired (currently dead — `personaRewrite` ref is unread).

---

## Plan synthesis after Q5 research — what changes, and why

I re-read the plan against the JustWrite Studio + Speaker Lab + hardware-recommendation audits. Below is what shifts, with the reason for each shift, followed by the revised execution sequence.

### Six reframes

| # | What changes | Why (grounded in the research) |
|---|---|---|
| 1 | **The 3-tier system (Guided / Direct / Reasoned) is Phase 2, not Phase 7.** Move task #79 (tier-aware extraction model selection) from "polish" into the LLM-dispatch phase | Each tier carries `system_key` (which prompt body to send), `think` flag (Ollama reasoning), and `confidence_floor` (0.7 vs 0.5) — `modelMeta.js:61-67`. The extraction backend can't dispatch the right prompt without it. Auto-classifier in `modelMeta.js:82-115` heuristic-matches model ids: reasoning-first families → Reasoned, ≥14B Qwen3 → Reasoned, ≥12B non-reasoning → Direct, sub-12B → Guided. Lift as part of the LLM dispatch port; it's not a separate task |
| 2 | **Phase 3 extraction backend ships with anchor propagation + confidence floor + corrections injection. Three are one feature, not three.** | Anchor propagation (`speakerAttribution.js:218-303`) is a deterministic pre-LLM pass over `said`/`asked`/`replied` + 40 dialogue-tag verbs with forward+back sweep. Anchors **win over LLM on tie-break**. Confidence floor demotes below-threshold LLM picks to "unknown" with a "was: X" audit badge. Corrections (top-12 most-recent) inject as few-shot. This trio is **what makes JustWrite's attribution feel reliable** — without it the user sees random LLM misattributions on every run. They must ship together as the extraction backend, not later as a polish |
| 3 | **Replace my Q4 "onboarding chain step 2" with JustWrite's QuickSetup wizard pattern.** | JustWrite's QuickSetup (`QuickSetup.vue` + `quickSetupPresets.js:32-129`) does GPU probe → tier-pick (`tierForVramMb`: cpu / 8 / 12 / 16 / 24 / 32 GB) → preset declares `{defaultChatModel, fastChatModel, pulls, estimatedDownloadGb, recipe}` → user reviews + accepts → wizard kicks off model downloads AND writes feature-routing into settings. This is a concrete, ready-to-lift wizard. My "onboarding chain step 2" was hand-waved. Replace it with this wizard, adapted to JustVoice's per-engine + per-variant install flow |
| 4 | **The "3-tier voice tuning" memory becomes a thread, not a separate task.** | The 3 tiers map cleanly: Tier-1 engine defaults (already in `capability_details.py` KnobSpec.default), Tier-2 per-voice overrides (the VoiceParamsModal at `VoiceParamsModal.vue:1-205`, opens from Cast tab ⚙ button, stores sparse `voice.params`), Tier-3 per-chapter render preset (`studio.js:271-315`, `RenderPresetsCard.vue`). JustWrite's `tts.js:47-57` cascades provider→voice→preset; JustVoice already has `delivery_merge.merge_delivery` (`generate_api.py:201`). The work is wiring the three UI surfaces, not designing a new system. Folds into Phase 4 (Studio Cast modal) + Phase 6 (Render preset editor) — no new task |
| 5 | **Add Speaker Lab as a Tools-lane advanced view, not a Studio sub-tab.** The Explore agent recommended LEAVE-for-MVP on the prompt editors, preset save/load, and multi-column A/B. **I disagree with the agent here** | The user explicitly named Speaker Lab as "good for advanced users." Audiobook producers tuning attribution for their specific writing style (epithet-heavy, dialogue-dense, free-indirect) is exactly the use case JustVoice serves better than ElevenLabs Studio. The Lab surfaces: provider/model + tier override per column, anchor propagation toggle, confidence floor slider with auditable "floored from X" badges, multi-column A/B (up to 4), prompt WYSIWYG editor with `{{characters}}`/`{{corrections}}`/`{{paragraphs}}` placeholders, preset save/load per mode. Gate behind the Tools lane (Q4 sidebar decision) so MVP / casual users don't see it; advanced users find it explicitly |
| 6 | **Smart-assign and the Render-preset Suggest button are now concrete lifts, not design tasks.** | JustWrite's prompts are file-cited and ready to copy. Smart-assign (`llm.js:139-172`): temperature 0.2, system prompt at `DEFAULT_CAST_SYSTEM`, user template `DEFAULT_CAST_USER_TEMPLATE`, characters interpolated as `- id=X, name="Y", role="Z", gender="?", pronouns="?", aliases="…", description="…"`, voices as `- id="X", name="Y", gender=?, age=?, accent="…", tone="…"`, output `{charId: voiceId}`. Render Suggest (`llm.js:229-275`): temperature 0, samples chapter (first 2000 chars + last 1500), output `{preset: "name", reason: "one sentence"}`. Tasks #83 and the Render-tab Suggest button become wire-it-don't-design-it |

### What stays unchanged (confirmed by the new research)

- **Q1 Persona/Profile/Voice schema cleanup** — no conflict with anything new.
- **Q2 Studio Cast/Script/Render shell for audiobook + podcast + game** — JustWrite's StudioView confirmed structurally sound to lift; the agent's "lift wholesale" verdict on the Cast tab + voice library merge + param-merging stack + batch render orchestration matches my Q2 design.
- **Q3 Generate as single-line workbench** — confirmed by negative evidence: JustWrite has **no Compose / persona-rewrite analogue**. Those stay JustVoice-only features built on the LLM dispatch. Generate remains the workbench.
- **Q4 four-lane sidebar + state-aware Home** — confirmed.
- **Q5 dropdown-based EnginesView UX** — matches JustWrite's `SettingsProviderForm` pattern exactly.
- **Engine `kind` discriminator (tts / llm / embedding)** — confirmed necessary: JustWrite holds an LLM provider AND a TTS provider AND an embedding provider in settings simultaneously (`SettingsView.vue:91-100` AI_FEATURES feature-pin table).

### Revised execution sequence

| Phase | Tasks + concrete deliverables |
|---|---|
| **1 — Foundations** | NEW: Persona/Profile schema cleanup; sidebar 4-lane structure; Home rebuilt with state-aware Next-step card; ChapterView `useCopy()` sweep; library-tab explainer headers; **NEW: QuickSetup wizard** (lift `QuickSetup.vue` + `quickSetupPresets.js` pattern — GPU probe → tier-pick → preset → bulk download + feature routing) |
| **2 — Engine + dispatch infrastructure** | NEW: Engine `kind` discriminator (tts / llm / embedding) + per-kind slots in `EngineManager`; **NEW: EnginesView dropdown-selector rewrite** (per-engine row + model dropdown + selection-driven info panel + contextual single action button — fixes all 6 EnginesView bugs); server-side load-progress events; `current_variant_id` reporting; **provider registry** lift from JustWrite (`aiStream.js`, `openai-compat.js`, `modelMeta.js`, `domain/providerParams.js`, `SettingsProviderForm.vue`); **tier system** (Guided/Direct/Reasoned with `system_key` + `think` + `confidence_floor` + auto-classifier) — formerly #79, promoted here because Phase 3 blocks on it |
| **3 — Extraction backend (one feature, three pieces)** | #74 Extraction backend AND anchor propagation (deterministic pre-LLM pass) AND confidence-floor demotion with audit badges. `POST /v1/scenes/{id}/analyze`. Ships as one cohesive feature, not three phases. #75 model-fork decision doc (small, in parallel) |
| **4 — Studio Cast + Script + Smart-assign** | #81 Cast tab + Script tab; #83 Smart-assign (concrete prompt from `llm.js:139-172`); VoiceParamsModal port = Tier-2 voice tuning in Cast tab. Studio shell adapts via `useCopy()` for audiobook/podcast/game |
| **4.5 — Speaker Lab (Tools-lane advanced view)** | NEW: SpeakerLabView port. Surfaces tier override per column, anchor toggle, confidence-floor slider, multi-column A/B (up to 4), prompt WYSIWYG editor with placeholders, preset save/load. Gate behind Tools lane (Q4 sidebar). Sample fixture (a public-domain Project Gutenberg passage, picked once → reused as #80's corpus seed) |
| **5 — Feedback loop** | #84 SpeakerCorrection table + top-12-most-recent injection into prompt; "re-Analyze improves with corrections" is the closing-the-loop deliverable |
| **6 — Studio Render** | #81 Render tab: chapter list + batch select + sequential render with cancel/retry; per-chapter render preset dropdown; **Render-preset Suggest button** (concrete prompt from `llm.js:229-275`); RenderPresetsCard for editing presets = Tier-3 voice tuning |
| **7 — Multi-use depth** | #76 cross-project NPC view (game/audiobook character mgmt); #95 Stories timeline deep mechanics (podcast/game); #82 Render Lab matrix harness (advanced Tools-lane view, complements Speaker Lab) |
| **8 — Extraction quality gate** | #78 extraction lab leaderboard + #80 ground-truth corpus collection. Post-MVP because the basic pipeline (Phase 3) ships with anchor propagation + confidence floor, which deliver 80% accuracy on their own per the audit. The lab is for tuning the LAST 20% |
| **9 — Deferred** | #49 / #68 (UE integration), #72 (external TTS export formats research), #97 (i18n), #58 (USPTO TM check — user action, can run any time) |

### Why this ordering produces a usable v1 sooner

The shortest path to a working audiobook flow is **Phase 1 → 2 → 3 → 4 → 5 → 6**. Each phase is independently shippable:

- After Phase 2: user can load Claude + Chatterbox simultaneously, see provider config UI, but no Studio yet.
- After Phase 3: user can hit `POST /v1/scenes/{id}/analyze` via curl and get attributed Blocks back — testable in isolation.
- After Phase 4: user can run Cast + Script tabs end-to-end. Manuscript → analyzed → corrected → ready to render (rendering still happens via existing `/v1/render_chapter`).
- After Phase 5: corrections persist, attribution improves over time.
- After Phase 6: Studio Render tab batches the whole book.

Phases 4.5, 7, 8, 9 are quality / advanced / deferred and can run in any order after the spine ships.

### Additional new tasks this synthesis surfaces (in addition to the 17 in the prior sections)

18. **QuickSetup wizard (Phase 1)** — lift `QuickSetup.vue` + `quickSetupPresets.js` from JustWrite. Tier breakpoints: cpu (<7 GB) / 8 (7-11) / 12 (11-14) / 16 (14-20) / 24 (20-28) / 32 (28+). Per tier: preset of `{defaultChatModel, pulls, estimatedDownloadGb, recipe}`. JustVoice's GPU detection already exists (`/v1/system/info`); just need to read VRAM and pick a tier. Recipe writes feature routes (`settings.engines.feature_pins.speaker_attribution`, `compose`, `persona_rewrite`) into `settings.json`.
19. **Speaker Lab view (Phase 4.5)** — lift `SpeakerLabView.vue` to JustVoice's Tools lane. Affordances: provider/model picker per column (defaults to `ai.defaultLlmId`), tier radio (Guided/Direct/Reasoned), anchor propagation toggle, confidence-floor slider with "was: X" badge, multi-column A/B up to 4 with run-all and cancel, prompt WYSIWYG editors per stage with `{{characters}}`/`{{corrections}}`/`{{paragraphs}}` placeholders + Reset-to-tier-defaults, preset save/load per mode, streaming output + token/elapsed counters. Sample fixture from Phase 8 corpus (a public-domain Gutenberg passage).
20. **VoiceParamsModal port (Phase 4, inside #81)** — lift the per-voice parameter override modal: sparse `voice.params` object, preview-before-save, per-engine schema introspection via `getParamSchema(engine)`. Becomes Tier-2 voice tuning surface in Studio Cast tab.
21. **Render-preset Suggest button (Phase 6, inside #81 Render)** — lift the LLM-driven chapter-tone classifier. Samples first 2000 + last 1500 chars, sends preset list + chapter title, parses `{preset: "exact name", reason: "one sentence"}`, applies on click. Temperature 0.
22. **Feature-pin system (Phase 2, inside the provider registry)** — lift JustWrite's `AI_FEATURES` array (`SettingsView.vue:91-100`). JustVoice features pinnable to specific LLM provider/model: `speaker_attribution` (default to Reasoned tier), `compose` (Direct tier), `persona_rewrite` (Direct tier), `render_preset_suggest` (Direct tier), `smart_assign` (Direct tier). Settings → AI features panel shows the pin table; QuickSetup wizard pre-fills based on tier preset.

---

## Locked decisions (from iteration with the user)

1. **Kill Profile entirely; Persona absorbs the voice config.** Drop `VoiceProfile` table, `/v1/profiles` endpoints, `ProfilesView.vue`, the Profiles sidebar tab. Migrate every existing Profile row → a Persona row (orphan: no project link) carrying the absorbed fields. The new Persona schema is `{ name, bio, language, avatar_path, voice_id (FK → Voice), personality (text), default_delivery (JSON), effects_chain (JSON), lexicon_id, engine_override, imported_from, imported_id, created_at, updated_at }`. Drops `personality_enabled` (presence of `personality` text is the on signal) and the old `voice_profile_id` FK.

2. **`Persona.personality` is a TTS delivery instruction.** Passed to engines that declare `supports_instruct_freeform` (Qwen3-TTS, LuxTTS) as the engine's `instruct` / style-prompt field at render time. Ignored by engines that don't accept it. Also used by Smart-assign as input context. **Never an LLM rewrite of the manuscript at render time.**

3. **Rewrite is a separate explicit LLM tool.** Lives as a button on Generate (single-line, preview-then-accept) and as a per-block right-click action on Studio Script tab. LLM takes current text + `persona.personality`, returns a rewritten version, user accepts/rejects before TTS. The current dead-stub "🎭 Persona rewrite" checkbox at `GenerateView.vue:603-616` becomes this button.

4. **Personas are global and cross-project.** Top-level entities, never project-scoped. The Personas tab gains two new UI affordances: (a) **library mode (default)** — all Personas visible with a "Used in N projects" badge per card and filter chips `All / Used in current project / Unused / By project`; (b) **add-to-project action** — when inside a Project, an "Add Personas" multi-select pulls from the global library to bind chosen Personas via `ProjectPersona`. No schema change needed (Personas already top-level; `ProjectPersona` m2m already exists).

5. **Effects are v1 first-class.** Wire pedalboard into the render pipeline (`render_core.py` + `generate_api.py`): after TTS produces WAV bytes, cascade `Persona.effects_chain` → `RenderPreset.effects_chain` (overlay) → optional per-block override. Build `EffectsView` editor + `EffectsChainEditorModal` that opens from Persona cards (Cast tab) and from RenderPreset editors. Eight effect types: reverb, distortion, gain, EQ (3-band), compressor, pitch shift, delay, filter. The current state (CRUD wired on Profile, render path ignores it, EffectsView is a UI stub) gets finished, not deferred.

6. **Studio scope — three use cases (audiobook + podcast + game).** One `StudioView.vue` shell, terminology swapped per use case via `useCopy()`. Audiobook says Cast / Chapter / Render; game says NPCs / Quest / Render; podcast says Hosts / Episode / Render. Same Cast → Script → Render arc; different content surfaces.

7. **Sidebar — filter by project_type.** Universal tabs (Overview, Generate, Voices, Engines, Settings) always shown. Conditional: Studio + Personas + Chapter + Stories + Captures + Effects surface per use case. Personas hidden for dictation + accessibility. Driven by `WelcomeOnboarding`'s `primaryUseCase` value.

## Execution sequence (binding the backlog tasks)

| Phase | Backlog task(s) | What ships |
|---|---|---|
| 1 — Foundations | NEW: kill Profile + Persona-absorbs-voice-config migration; NEW: Personas library mode + add-to-project action; NEW: sidebar filter by use case; NEW: ChapterView `useCopy()` swap; NEW: Effects v1 pipeline wiring (pedalboard apply in render_core/generate_api) + EffectsChainEditorModal (8 effect types) opening from Persona cards + RenderPreset editor | Profile gone; Persona is the sole identity layer with effects + delivery + lexicon + personality + voice all on it; effects actually apply at render; sidebar adapts to project_type; no hardcoded "Scene/Block" labels |
| 2 — LLM plumbing | NEW: port `llm.js` + `aiStream.js` from JustWrite; #75 (Project/Scene/Block decision doc) | LLM service exists in the renderer; data model locked as one schema |
| 3 — Extraction backend | #74 (extraction backend half) | `POST /v1/scenes/{id}/analyze` returns `[{position, speaker, confidence}]`; Block extraction_confidence column |
| 4 — Studio Cast + Script | #81 Cast + Script tabs; #83 Smart-assign | First end-to-end attribution flow lands for audiobook |
| 5 — Feedback loop | #84 SpeakerCorrection table + memory injection | Re-Analyze improves with user corrections |
| 6 — Studio Render | #81 Render tab | Batch render, per-chapter preset, cancel/retry |
| 7 — Polish | #76 cross-project NPC view; #95 Stories timeline (podcast/game); #82 Render Lab; #78/79/80 extraction lab | Game-specific flow; podcast multi-track; quality gates |
| 8 — Deferred | #49 / #68 (UE integration); #72 (external import); #97 (i18n) | Post-MVP |

## New tasks to create after plan approval

1. **Kill Profile + Persona absorption migration** — drop `VoiceProfile` table, `/v1/profiles` endpoints, `ProfilesView.vue`, Profile sidebar tab. Migration in `database/migrations.py`: every existing VoiceProfile row → an orphan Persona row carrying voice_id, personality, default_delivery, effects_chain, default_lexicon_id → lexicon_id, default_engine → engine_override, description → bio, language, avatar_path. Update Persona Pydantic models (`server/justvoice/models.py`) + drop `personality_enabled` flag (presence of `personality` text is the on signal). Rewire PersonasView to render the absorbed fields.
2. **Personas library mode + add-to-project action** — Personas tab: cards show "Used in N projects" badge derived from ProjectPersona m2m. Filter chips: All / Used in current project / Unused / By project. When a Project is open, add an "Add Personas" button that opens a multi-select against the global library and writes ProjectPersona rows. Existing `ProjectPersona` schema unchanged.
3. **Effects v1 — render pipeline wiring** — `server/justvoice/render_core.py` + `server/justvoice/api/generate_api.py`: after TTS produces WAV bytes, walk Persona.effects_chain → RenderPreset.effects_chain (overlay) → per-block override, apply each step via `pedalboard.Pedalboard([...])`. Cache key in `cache.py` must include the effects-chain hash so cache busts on chain change.
4. **Effects v1 — EffectsChainEditorModal** — new Vue component. Drag-drop ordered list of effects, add/remove, per-effect parameter form. 8 effect types matching pedalboard primitives: `Reverb` (room_size, damping, wet_level, dry_level), `Distortion` (drive_db), `Gain` (gain_db), `EQ` (low/mid/high gain), `Compressor` (threshold, ratio, attack, release), `PitchShift` (semitones), `Delay` (delay_seconds, feedback, mix), `HighpassFilter / LowpassFilter` (cutoff_hz). Opens from a Persona card's "Effects" row in Studio Cast tab AND from RenderPreset editor's "Effects" row.
5. **EffectsView rebuild** — the sidebar Effects tab becomes a global effect-preset library (saved chains the user can apply from the modal). Drop the dead-stub current implementation; rebuild around the EffectsChainEditorModal with a "Save chain as preset" action.
6. **Sidebar filter by project_type** — `App.vue` reads `onboarding.primaryUseCase`, filters sidebar entries through a `tab.visibleFor: useCase[]` table. Settings → Appearance gets no "Show all" toggle (locked decision: clean filter, no escape hatch).
7. **ChapterView useCopy sweep** — replace hardcoded "Scene/Block" labels with `useCopy()` lookups so audiobook says "Chapter / Line" and game says "Quest / Voiceline".
8. **Port LLM service from JustWrite** — `src/renderer/src/services/llm.js` + `aiStream.js` + `modelMeta.js`. SPDX + attribution headers per `project_licensing_attribution`. Provider routing (Claude / OpenAI / Ollama / local-qwen) + streaming + tier mapping.
9. **Rewrite button (replaces Persona-rewrite stub)** — wire the dead `personaRewrite` ref at `GenerateView.vue:603-616` to a "Rewrite" button (preview-then-accept). Same backend dispatch as Compose. Per-block right-click variant on Studio Script tab post-Phase 4.

## Critical files this design touches (not yet edited)

- `server/justvoice/database/models.py` — Persona absorbs VoiceProfile's fields (voice_id, personality, default_delivery, effects_chain, language, avatar_path); drop VoiceProfile table; SpeakerCorrection table add
- `server/justvoice/database/migrations.py` — VoiceProfile → Persona migration (orphan rows)
- `server/justvoice/api/personas_api.py` — expose absorbed fields; `voice_profile_id` → `voice_id` (FK → Voice)
- `server/justvoice/api/profiles_api.py` — **delete**
- `server/justvoice/models.py` — Pydantic shape mirrors new Persona; drop ProfileResponse/CreateProfileRequest/UpdateProfileRequest/ComposeResponse
- `server/justvoice/render_core.py` — pedalboard apply step in the chunked + non-chunked render paths
- `server/justvoice/api/generate_api.py` — same pedalboard apply step for single-line synth; effects-chain cascade Persona → RenderPreset → per-block override
- `server/justvoice/cache.py` — cache key includes effects-chain hash
- `server/justvoice/imports/adapters/justwrite.py` — no change; reference for import contract
- `src/renderer/src/views/PersonasView.vue` — render absorbed fields; library mode + add-to-project action
- `src/renderer/src/views/ProfilesView.vue` — **delete**
- `src/renderer/src/views/EffectsView.vue` — rebuild as global effect-chain preset library
- `src/renderer/src/views/GenerateView.vue` — Profile chip → Persona chip; rewire dead `personaRewrite` ref to preview-then-accept Rewrite button
- **New** `src/renderer/src/components/EffectsChainEditorModal.vue` — drag-drop chain editor, 8 effect types
- **New** `server/justvoice/extraction/` package — port from `E:\Dev\Web\justwrite-app\src\renderer\src\services\speakerAttribution.js` (857 LOC) + prompts
- **New** `server/justvoice/api/extraction_api.py` — `POST /v1/scenes/{id}/analyze`
- **New** `src/renderer/src/services/llm.js` + `aiStream.js` — port from JustWrite
- **New** `src/renderer/src/views/StudioView.vue` — Cast/Script/Render shell adapting via `useCopy()`
- `src/renderer/src/App.vue` — sidebar filter by `project_type`; remove Profiles entry; add Personas to dictation/accessibility hidden list
- `src/renderer/src/views/ChapterView.vue` — replace hardcoded "Scene/Block" with `useCopy()`

## Roadmap notes (post-v1 / future iteration)

### Shared utilities between JustWrite and JustVoice — separate repo?

**Recommendation: don't extract a shared repo for v1. Copy + attribute, mirroring the existing voicebox pattern. Revisit in v2 if the apps converge.**

What could be shared today: JustWrite import schema (the StandardImport JSON shape JustVoice's `imports/adapters/justwrite.py` parses), the voice-provider seed data (ElevenLabs / Speechify / Kokoro / etc. configs JustWrite has), `modelMeta.js` tier classification, `speakerAttribution.js` (857 LOC), `aiStream.js` LLM dispatch wrapper, `openai-compat.js`.

Why a shared repo is the wrong call right now:

1. **Divergent trajectories.** JustWrite is shrinking (audio side being absorbed into JustVoice); JustVoice is growing. Code shared today will diverge tomorrow.
2. **Coordinated-release cost.** A shared npm/git-submodule package means every bug fix needs both apps to bump in lockstep. For two-person hobby projects this is friction without payoff.
3. **The Lift+Port pattern already works.** Files copied from JustWrite carry SPDX + attribution headers, identical to the voicebox pattern (`voicebox-pin.txt` records the upstream commit). Adding "JustWrite as a second attribution upstream" costs zero new infrastructure.
4. **Amount actually shared is small.** Estimated ~1500-2500 LOC of genuinely shareable surface. That's a heavy lift to extract, version, document, test independently, and republish for marginal duplication savings.
5. **Cross-language reality.** JustWrite is JS+Rust; JustVoice is JS+Rust+Python. The Python backend can't share code with JustWrite anyway. The truly-shareable surface is JS-only, narrower than the headline suggests.

When a shared repo WOULD make sense (revisit triggers):

- A third app emerges (JustRead / JustDictate / etc.) that wants the same primitives.
- The shared JS surface grows past ~3000 LOC and accumulates its own meaningful test coverage.
- JustWrite + JustVoice are explicitly planned to converge into one combined product in v2.

**Concrete next step (when ready):** when v1 ships, audit the actual ported surface in JustVoice and see what's still genuinely shared (not divergent). If at that point there's a clean ~2 kLOC subset, extract it as `@justwrite-justvoice/shared` (an npm package), version it semver-strict, and migrate both apps. Until then, copy + attribute.

---

## Verification (once built)

- Import a JustWrite book → Studio Script tab → every block has correct persona — already works today, regression-test it.
- Paste raw 1-chapter manuscript into Studio Script → click Analyze → 80%+ accuracy on a 5-character scene (compared against a manually-attributed ground truth in `server/justvoice/labs/extraction/corpus/`).
- Fix 3 lines manually → re-Analyze → fixed lines remain correct AND similar misattributions elsewhere converge.
- Switch project_type to "game" → Studio shell reshapes to NPCs / Lines / Render with cross-project NPC view.
- Switch project_type to "dictation" → Studio + Personas + Chapter disappear from sidebar; Generate is the landing tab.

---

## Q6: UX density + width architecture (added 2026-06-10)

### The problem

Controls in JustVoice default to `width: 100%` (the global rule at `src/renderer/src/styles.css:435` on `.jv-input` / `.jv-textarea` / `.jv-select`). Every form field — port-number, API-key, display-name, URL, byte-limit — stretches to the column width. On a 27" monitor, a 5-digit port input becomes a 1700px-wide bar; an API-key field next to a "Display name" field stretches to identical width even though one holds 60 chars of opaque token and the other holds 30 chars of friendly name. The control's visible width is a silent claim about its information content — when everything stretches equally, that claim is broken, no field reads as more important than another, and the page becomes a wall of stretched bars.

JustWrite's settings is an *example* of the alternative shape (not full-width because it doesn't need to be) but its specific solution (1100px shell + 220px label column, `SettingsView.vue:1039`) is settings-shaped and would break Studio Script (needs ~880px reading column) and the library grids (need full width). The right answer is **content-typed control widths + per-surface page-shell rules**, not a global page cap.

### Five surface types in JustVoice

| Surface | Examples | What right-sized means |
|---|---|---|
| **Workspaces** | Studio Script, Generate, ChapterView | Page is full-width (split panes), but the *editing column* caps at ~880px reading width |
| **Forms / setup** | SettingsView, AddProviderModal, RenderPreset editor, Persona editor | Form column caps at ~720px; controls inside are content-sized |
| **Library grids** | PersonasView, VoicesView, LexiconsView, EnginesView, EffectsView | Use full width, auto-fill cards at ~280-320px |
| **Tools** | SpeakerLabView, CompareView, AudioToolsView, RenderLabView | Split into panes; each pane's controls follow content widths, panes share width |
| **Modals** | EffectsChainEditorModal, VoiceParamsModal, AddProviderModal | Modal width sized to densest control (typically `min(540px, 100vw - 32px)`); controls inside still respect content widths |

A single "max-width on the shell" rule would break workspaces and library grids. So the design must hold both edge-to-edge layouts AND content-sized fields inside them.

### Proposed solution — content-typed widths

Add 7 width tokens to `styles.css`:

```css
--w-token:  110px;  /* port, version string, 4-digit number, ratio */
--w-id:     180px;  /* short ID, model name like "gpt-4o-mini", slug, enum select */
--w-name:   280px;  /* display name, file name, persona name, title */
--w-url:    360px;  /* URL, API key, secret token */
--w-path:   480px;  /* file path, folder selector */
--w-prose:  640px;  /* description, bio, hint paragraph */
--w-edit:   880px;  /* manuscript / script editing reading width */
```

Then change the global default at `styles.css:435`:

```css
/* before */
.jv-input, .jv-textarea, .jv-select { width: 100%; }
/* after */
.jv-input, .jv-textarea, .jv-select { width: auto; max-width: var(--w-name); }
```

One CSS change kills 60-70% of stretched-control offenders automatically (the default becomes "name-sized" instead of "100%"). Components opt up (`--w-url` for API keys) or down (`--w-token` for port numbers) where the default doesn't fit.

### Layout primitives — replace `.jv-field`'s hardcoded label column

Today `.jv-field` (`styles.css:488-499`) uses `grid-template-columns: 160px 1fr` — fixed pixel column. Short labels waste space, long labels truncate. Replace with auto-sized labels:

```css
/* Form row — label self-sizes to its content */
.jv-form-row {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 16px;
  align-items: baseline;
}

/* Form section sits anywhere on the page, caps its own width */
.jv-form-section { max-width: 720px; }

/* Workspace prose column for script / manuscript editing */
.jv-prose-column { max-width: var(--w-edit); margin: 0 auto; }
```

`grid-template-columns: max-content minmax(0, 1fr)` lets labels self-size to whatever's longest in the section ("Port" → 28px; "Default delivery overlay weight" → 200px). No section-by-section guessing at column widths.

### Per-surface shell rules

- **Workspaces** — page is full-width (`.app-shell` already does this). Editing column inside uses `.jv-prose-column` (max 880px). Side panels stay at the edges of the available space.
- **Forms** — page is full-width; the form sits in `.jv-form-section` (max 720px) anchored left or centered per the page's information density.
- **Library grids** — `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`. Use the whole width; cards reflow.
- **Tools** — split into N panes (input | output), each pane's controls respect content widths but the panes share full width.
- **Modals** — width sized to densest row, capped at `min(540px, calc(100vw - 32px))` (which `AddProviderModal.vue:264` already does correctly — propagate that pattern).

### Concrete sweep targets (file:line)

The fix is three layers — global default change + per-view tagging + form-section wrapping. Worst offenders spotted so far:

| File:line | Today | Fix |
|---|---|---|
| `styles.css:431-446` | Global `.jv-input { width: 100%; height: 36px; font-size: 13px; }` — every control stretches by default | Change to `width: auto; max-width: var(--w-name)`; add `.jv-input--full` opt-out class for textareas / paste targets |
| `styles.css:488-499` | `.jv-field { grid-template-columns: 160px 1fr }` | Replace with `.jv-form-row { grid-template-columns: max-content minmax(0, 1fr) }` |
| `SettingsView.vue:735` | Port number input full-width | Wrap in `.jv-form-row`; apply `--w-token` |
| `SettingsView.vue:832-835, 852-861, 979-1015, 1205-1217` | 25+ `<JvInput type="number">` rows, each full-width | Apply `--w-id` (byte limits, durations) or `--w-token` (counts) per field semantic |
| `SettingsView.vue:1076` | External-engine API-key field stretches | Apply `--w-url` |
| `SettingsView.vue:1039+` | External-engine add row is 4 stacked full-width inputs | Wrap in `.jv-form-section` + `.jv-form-row` grid with content-sized controls |
| `AddProviderModal.vue:184-247` | All fields `class="jv-input"`, stretch to 540px modal width | `--w-name` for display name / id; `--w-url` for base_url / api_key; `--w-id` for default_model; modal width already correctly capped |
| `EnginesView.vue` | Model dropdown + info panel is full-width band ~1800px on wide monitors | Cap dropdown row at `.jv-form-section` (720px) — model IDs are short, no value in stretching |
| `StudioView.vue` Cast tab | Voice search/filter (if added) and casting controls | `--w-name` for search; `--w-url` for cast row controls |
| `StudioView.vue` Script tab | Block editor stretches to full page width | Wrap block list in `.jv-prose-column` (880px reading width) |
| `GenerateView.vue` | Textarea stretches to viewport width | Wrap in `.jv-prose-column`; floating bar controls stay full-width (they already use the action-bar pattern, OK) |
| All views | `.jv-field` instances | Mechanical sweep to `.jv-form-row`; same shape, auto-sized labels |

### Visual rhythm rules (the "why" behind the widths)

1. **Don't bake horizontal padding/margins into the control.** The control has its own width; the column or row it sits in handles layout.
2. **Compact where it makes sense, readable where it matters.** Settings + tool panes drop to 12.5px font (read once per session); script + manuscript editor stays at 14-15px (read repeatedly).
3. **Inline label + control for power-user dense pages** (Settings second-pass, modals); **stacked label-above-control for discovery / first-time setup pages** (WelcomeOnboarding, QuickSetup wizard).
4. **Sections separate with whitespace + a thin rule, not boxes everywhere.** JustVoice has too many surrounding panels; the chrome should fade into the content.

### Execution sequence

| Phase | What ships |
|---|---|
| **Q6 / Slice 1** | Add 7 width tokens + `.jv-form-row` + `.jv-form-section` + `.jv-prose-column` to `styles.css`. Change global `.jv-input` / `.jv-textarea` / `.jv-select` default from `width: 100%` to `width: auto; max-width: var(--w-name)`. Add `.jv-input--full` opt-out class. **One file, ~30 LOC. This single change fixes the majority of offenders automatically.** |
| **Q6 / Slice 2** | Sweep `SettingsView.vue` — wrap all sections in `.jv-form-section`, replace `.jv-field` with `.jv-form-row`, tag every input with its content-type width class. Highest-leverage view because it has the most controls. |
| **Q6 / Slice 3** | Sweep `AddProviderModal.vue` + `EffectsChainEditorModal.vue` + `VoiceParamsModal.vue` + other modals. Apply same pattern. |
| **Q6 / Slice 4** | Sweep workspace views (`StudioView.vue`, `GenerateView.vue`, `ChapterView.vue`) — wrap prose columns in `.jv-prose-column`, leave page chrome full-width. |
| **Q6 / Slice 5** | Sweep library grid views (`PersonasView.vue`, `VoicesView.vue`, `LexiconsView.vue`, `EnginesView.vue`, `EffectsView.vue`) — standardize on `auto-fill, minmax(280px, 1fr)` grid; tag search/filter controls. |
| **Q6 / Slice 6** | Sweep tools views (`SpeakerLabView.vue`, `CompareView.vue`, `AudioToolsView.vue`, `RenderLabView.vue`) — split-pane layout, content-sized controls in each pane. |

---

## Q7: Other UX issues to fix in the polish pass (added 2026-06-10)

These surfaced during the Q6 audit and earlier work. Categorized by family so the fixes can batch.

### Layout & navigation

1. **Sidebar is still a flat 18-item list** (`App.vue:47-71`). No Workflow / Library / Tools / Advanced lanes. Webhooks visually equals Generate. (Already in the gap list from the earlier audit; reiterated here so it's part of the polish-pass tracking.)
2. **No breadcrumb / location context.** In StudioView you can't tell "audiobook 'My Novel' → chapter 3 → Cast tab" from the chrome alone. Easy to lose place when projects nest. Add a breadcrumb strip below the topbar that reads from the current route + active project + active scene.
3. **Floating action bar overlaps content** in `GenerateView.vue:550-640` — covers textarea on short viewports while typing. StudioView's tab nav stays at top with scrolling content underneath — inconsistent pattern. Pick one (sticky-top tab nav) and apply globally.
4. **Tab indicators differ per view** — StudioView's tabs use one shape, SettingsView's sub-nav uses another. Standardize on a single `.jv-tabs` component with one active-tab visual (bottom border + accent color).

### Forms & input

5. **Validation timing** — most forms `pushToast({ message: "Name required" })` on submit. Should validate on blur with inline error text under the field. Adds a `:error` prop to `JvInput` / `JvSelect` and an `<JvFieldError>` block below.
6. **Modal footer button order varies** — most are `[Cancel] [Primary]` right-aligned, but a few have action-on-left or save-then-cancel. Lock the convention: right-aligned, secondary-then-primary, primary uses `variant="primary"`.
7. **No keyboard shortcuts surfaced** — no `?` overlay, no shortcut tooltips. Power users discover by reading source. Add a `?` shortcut that opens a slide-out cheatsheet keyed by current view.

### Feedback & loading

8. **Inconsistent loading states** — JvButton `:loading` spinner in some places, TaskStrip elsewhere, inline skeleton sometimes, frozen UI other times. Convention: sub-second ops → button spinner; multi-second ops → TaskStrip with cancel; page-load → skeleton.
9. **No undo for destructive actions** — delete a Persona, it's gone. A 5-second toast with "Undo" (Gmail style) covers misclicks cheaply. Add `pushToast({ kind: "info", action: { label: "Undo", handler: ... }, duration: 5000 })`.
10. **Empty states without affordance** — ProjectsView with zero projects, ChapterView with no chapters, PersonasView with no characters — most just say "Nothing here yet." Should be `<EmptyState>` component with one-line "what is this" + `[Create your first X]` primary button.

### Visual consistency

11. **Card-grid spacing drifts** — PersonasView 12px gap, VoicesView 16px gap, EnginesView larger. Add `--gap-grid: 16px` token, use everywhere.
12. **`.jv-btn--danger` not consistently red.** Some destructive buttons look like normal buttons until hover. Lock `--danger` color on every destructive action.
13. **Font-size scale not documented.** 12px / 12.5px / 13px / 14px used inconsistently. Define a 4-step scale (xs 11px / sm 12.5px / md 13px / lg 15px) and document when to use each.

### Discoverability

14. **Hint density varies** — some controls have `v-tooltip`, some have inline `.jv-muted` text below, some nothing. Rule: hints copy lives as `.jv-muted` text under the control (the `AddProviderModal.vue:195-197` pattern); tooltips only for icon-only buttons.
15. **Studio Cast voice library has no search/filter** — with 50+ voices it's pure scroll. Add engine selector at top of Cast tab + name search field. (This is the JustWrite parity callout from the audit, repeated here.)
16. **Long names break list layout** — cloned voices with 80-char names blow out cards. Add `text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` + `:title="name"` for hover tooltip.

### State visibility

17. **Engine "loaded" indicator too subtle.** Given engine state is load-bearing, "Loaded ✓" in body text is too quiet. Add a persistent pill in the topbar showing current TTS + LLM engines at all times; clicking it jumps to EnginesView with that engine focused.
18. **No initial-boot skeleton.** When the Python server is spinning up, the UI shows empty stores, looks broken. Add skeleton placeholders in each view for the period between "rendering started" and "first API response arrived."

### Execution sequence

| Phase | What ships |
|---|---|
| **Q7 / Slice 1** | Layout & nav: 4-lane sidebar (#1 above — already on the gap list), breadcrumb strip (#2), sticky-tab convention (#3 + #4 — single `.jv-tabs` component). |
| **Q7 / Slice 2** | Forms: validation on blur with inline error (#5), modal-footer convention (#6), keyboard shortcut cheatsheet (#7). |
| **Q7 / Slice 3** | Feedback: loading-state convention (#8), undo toast (#9), `<EmptyState>` component swept across views (#10). |
| **Q7 / Slice 4** | Visual: spacing token (#11), danger color enforcement (#12), font-size scale documented + applied (#13). |
| **Q7 / Slice 5** | Discoverability: hint copy convention (#14), Cast tab engine selector + voice search (#15 — also closes the StudioView Cast gap from the audit), long-name truncation (#16). |
| **Q7 / Slice 6** | State visibility: topbar engine pill (#17), skeleton placeholders during boot (#18). |

---

## New tasks Q6 + Q7 surface (in addition to the 22 from prior sections)

23. **Q6 / Slice 1 — Width tokens + form primitives** — add 7 `--w-*` tokens + `.jv-form-row` + `.jv-form-section` + `.jv-prose-column` to `styles.css`; change global `.jv-input` default. One file change cascades to the whole app.
24. **Q6 / Slice 2 — SettingsView sweep** — wrap all sections, replace `.jv-field` with `.jv-form-row`, tag every control with content-type class.
25. **Q6 / Slice 3 — Modal sweep** — AddProviderModal, EffectsChainEditorModal, VoiceParamsModal, RenderPreset editor.
26. **Q6 / Slice 4 — Workspace sweep** — StudioView, GenerateView, ChapterView prose columns capped at `.jv-prose-column`.
27. **Q6 / Slice 5 — Library grid sweep** — standardize `auto-fill, minmax(280px, 1fr)`; tag search/filter controls.
28. **Q6 / Slice 6 — Tools sweep** — split-pane layout for SpeakerLab / Compare / AudioTools / RenderLab; content-sized controls per pane.
29. **Q7 / Slice 1 — Layout & nav polish** — 4-lane sidebar, breadcrumb strip, `.jv-tabs` component standardization.
30. **Q7 / Slice 2 — Form interaction polish** — on-blur validation with inline errors, locked modal-footer convention, `?` shortcut cheatsheet.
31. **Q7 / Slice 3 — Feedback polish** — loading-state convention, undo-toast for destructive actions, `<EmptyState>` component swept everywhere.
32. **Q7 / Slice 4 — Visual consistency** — `--gap-grid` token, danger color enforcement, documented font-size scale.
33. **Q7 / Slice 5 — Discoverability polish** — hint copy convention, Cast tab engine selector + voice search, long-name ellipsis.
34. **Q7 / Slice 6 — State visibility polish** — topbar engine pill (TTS + LLM), skeleton placeholders during server boot.
