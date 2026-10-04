# A persona makes its own voice; the persona mock moves into the app — 2026-10-04

Two decisions from one conversation, with the text as it was shown and approved. **Read this
before drawing or building the persona pages.** It amends `2026-10-03-persona-redesign.md` §6.1
(the Voice card, the Voices page) and §5.2 (where a voice is made); everything else there stands.

## 1. What the user said (verbatim, typos kept)

1. "the layout of persona is not very nice compared to mock how it speaks the sliders are stack in
   the mock it is much nicer looking desingg, the textboxes are different, why is it when you make
   a mock it never translates to the real app the way it looks?"
2. "you tell me you use the same css same controls for themock as the app but you always mess it
   up"
3. "go with 2, redo the persona mock first"
4. "also you are missign the design portion, for cloning or voice design you have no way to create
   a clone or voice that is supposed to be in persona too correct, or is there a different screen
   for voice design and cloning? did we design this did you look at alexeanderia, you are doing
   half a job"
5. Pointed at Qwen's own demo: https://huggingface.co/spaces/Qwen/Qwen3-TTS
6. "your rec, but i think the whole design should be part of the persona, we can do all design in
   persona except lora training maybe, what do you think, if you in a persona you desing the voice
   you want and test it all in one page, what do you think?"
7. "we also need a language selector for the voices drop down so if i only want to see japanese
   voices i can do that, your rec on all go"

## 2. Mocks are built in the app (option 2)

Why: the HTML mock shared only the tokens with the app (`mock/README.md:39`); every control was
its own CSS in `_head.html`, so a screen built with the real controls could not look like it.

Option 2 as presented and approved: *"Mocks are built in the app itself. A mock screen is a Vue
page with the real kit components and fake data, and no server. That's what the mock rule already
asks for: 'production minus the plumbing'. Whatever the mock shows is exactly what ships, because
it's the same code."* Rejected: option 1, the HTML mock linking the real stylesheets —
hand-written markup can drift back.

The answers ("your rec"):
1. On the persona pages the mock's look beats the size-to-content / 60ch rule: Pace, Pitch, Gain 3
   across, each slider filling its cell; text boxes as wide as the card; left column 1.5× the
   right — as `_s7` draws it.
2. The mock pages are a dev-only route, `#/mock/...` while `npm run dev` runs, never in the
   packaged app.
3. The HTML mock's `_s7` and `_s9` are deleted once the Vue ones exist; its other screens' links to
   them open the app's mock route instead.
4. The rest of the HTML mock — "a" (2026-10-04), as presented: *"(a) Freeze it. No more edits. It
   stays only as the picture of screens not yet redone (Render for Slice 4, Cast, Script, and so on),
   and each one is drawn fresh in the app when its work starts. Anything new is drawn only in the
   app."* Rejected: (b) delete it now; (c) redo all its screens in the app first. So `_s8` (Voices ›
   New voice), superseded by answer A, stays as drawn.

## 3. A persona makes its own voice (the user's design, my answer approved)

The answer as shown: *"I agree. It's a better design than my round trip to Voices."*

**Why it's better** (as shown)
- It's what the mock's radios were reaching for — "the mock has choices like alexandria, clone
  blend design" (10-03). In Alexandria the persona's voice setup is a choice of type with that
  type's settings right under it.
- It closes Alexandria's own gap: its Designer is a separate page, and saving there "does NOT link
  back" (`2026-08-22-voice-modes-truth-and-parity.md`).
- Qwen's demo has the same shape: each way of making a voice is the description or clip, then
  generate and listen, on one tab.
- Cast becomes one trip. ＋ New persona → make the voice → hear it → Save → back with it assigned.
- Hear it and Compare already exist on that page, so they become the preview for making a voice too.

**How the Voice card works** (as shown)
- **Built-in:** pick a voice (as now).
- **Design from words:** a description box, and the persona speaks from those words on every
  render (the dynamic path). "Keep this take as the voice" turns one good take into a fixed voice,
  cloned on a clone model (the frozen path).
- **Clone from audio:** pick an existing clone, or ＋ New clone with drop / record / a capture, the
  transcript, the clip checks, the model, Preview, Keep.
- **Blend:** pick an existing blend, or ＋ New blend with voices, weights, Preview, Keep.
- **LoRA:** shown off until training is rebuilt.
- Only the chosen type's settings show, so the page grows by one panel, not four.

**What has to stay true** (as shown)
- A voice is still its own library item. A clone made in "June" must be usable by "June (softer)"
  without cloning again, and by Generate, which picks voices directly. So the persona page makes
  the voice and the Voices page lists and manages it.
- There's only one way to make each kind. If Voices keeps its Clone/Design/Blend tabs as well,
  there are two versions to drift apart.

**The answers** ("your rec on all go")
- A. The Voices page becomes the library only (find, play, filter, copy to another model, delete);
  its Clone, Design and Blend tabs move into the persona.
- B. A made voice is saved to the library the moment you press Keep, even if you then leave the
  persona unsaved. (A clone is work to redo; an unused one shows in Voices as unused and can be
  deleted.)
- C. Import (`.justvoice.zip`) stays on Voices — it brings in a file, it doesn't design anything.
- D. "Keep this take" for a design offers the same model list as Clone — after verifying in code
  that VoxCPM2 keeps written direction on a clone and Qwen3 Base doesn't (plan 10-03 §5.4).
- E. "No popups, questions in chat" is saved as a standing rule (memory).
- Design carries both 08-22 paths — a description on the persona (dynamic) and "Save as a voice"
  (frozen, cloned) — after checking what the code sends VoiceDesign today.
- The voice list gets a **Language** filter beside Can be directed, Model and Gender ("so if i only
  want to see japanese voices i can do that").
- Model Size stays AI Settings' choice, not the persona's (10-03 §6.2 call 4) — Qwen's demo puts
  it on every tab; we don't.

**Corrected and decided after the research** ("your rec on all go", 2026-10-04, the second time)
- C was wrong as asked: `.justvoice.zip` is the PROJECT export (and nothing imports it — TASKS
  FINDING "voice and project files"). The Voices page's Import tab keeps an audio clip as it is,
  as a voice — a clone without the listen-first step. Decided: **it folds into the persona's
  Clone maker** as "keep the clip as it is", so there is one maker per kind and Voices is the
  library only.
- **The clone maker shows the clip's length and how noisy it is.** Length is read from the file;
  noise needs new server code (none exists — the same FINDING, item 5).
- **A description-only design is saved when you press Keep**, like every other maker (B).
- **A kept voice is fixed**, as clones already are; "＋ New design from this one" starts a copy.
- The engine facts the mock shows come from plan `2026-10-03-persona-redesign.md` §2.3 and §5,
  not a new survey (the user, 2026-10-04: "i know we have fully researched what each ening is
  capable of many times did you forget again?").

## 4. Order

1. Read the 12 Alexandria screenshots, `2026-08-15-voice-workflow-redesign.md` §5 and §9.3, and
   the 08-22 record; check in code: what reaches VoiceDesign for a designed voice with no clip;
   VoxCPM2 and Qwen3 Base direction on a clone; what an Import file holds.
2. Build the persona mock as Vue pages — the index (`_s9`) and the editor (`_s7`, with the voice
   makers inline and the Language filter) — on fake data, real kit components, real enum values.
3. Compare it against the HTML mock side by side, at the same width; list every difference.
4. Delete `_s7`/`_s9` from the HTML mock.
5. **Stop for the user's review.** Then `PersonaEditorView.vue`, `PersonasView.vue` and
   `VoicesView.vue` change to match it (each a slice with its own blast-radius table).
