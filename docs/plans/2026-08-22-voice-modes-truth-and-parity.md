# Voice modes: the verified truth, and the parity/fix program

**Written 2026-08-22, from a session that verified everything below in code —
upstream Qwen3-TTS, Alexandria, and JustVoice, file by file, no summaries
trusted.** This doc exists so the next session executes without re-research.
Every claim carries its receipt. Where a receipt is to a scratchpad clone, the
re-clone commands are in §8.

**How to execute (Opus):** items are specced in §5. Each item states its
decision state. `RULED` means the user's decision already exists (quoted);
`NEEDS WORD` means do not start it until the user names it. Per the global
rules: nothing runs without a go naming it; re-read the item AND this doc's
ground-truth section for that area before each edit; blast-radius greps are
listed per item — run them and paste results into the PR/plan before coding.
Gates before any commit: `cd server && ruff check . && pytest`, `npm run
build:vite`, and for renderer changes the Playwright smoke with
`--data-dir src-tauri/target/debug/data` (see CLAUDE.md — the flag is not
optional; the bare run creates a fresh empty DB that looks healthy).
No DB migrations ever — seeds-only, the user resets (standing rule).
Commit with `git commit -F - -- <paths>` (never a bare commit — another
session may have staged work).

---

## §1 Ground truth — upstream Qwen3-TTS

Repo: `github.com/QwenLM/Qwen3-TTS` (cloned 2026-08-22). The inference wrapper
is `qwen_tts/inference/qwen3_tts_model.py`.

**Three separate checkpoints. Each public method hard-refuses the wrong one**
(raises ValueError naming the model type):

| method | requires `tts_model_type` | signature (essentials) | instruct? |
|---|---|---|---|
| `create_voice_clone_prompt` (:356) | `base` | `(ref_audio, ref_text=None, x_vector_only_mode=False)` → prompt items | — |
| `generate_voice_clone` (:470) | `base` | `(text, language, ref_audio, ref_text, x_vector_only_mode, voice_clone_prompt, non_streaming_mode, **hf_kwargs)` | **NO — the parameter does not exist** |
| `generate_voice_design` (:637) | `voice_design` | `(text, instruct, language, …)` | required — the description IS the instruct |
| `generate_custom_voice` (:732) | `custom_voice` | `(text, speaker, language, instruct=None, …)` | optional; **0.6B force-drops it** (:897 `if self.model.tts_model_size in "0b6": instruct = None`) |

Clone modes (:366-379): `x_vector_only_mode=True` → speaker embedding only
(ECAPA x-vector, ref_text ignored, faster, reusable, lower fidelity);
`False` → ICL mode, `ref_text` REQUIRED (model conditions on ref text + ref
speech codes; better prosody). The reusable prompt object bundles
`ref_code / ref_spk_embedding / flags` per item (:460).

**The LoRA seam:** the core `Qwen3TTSForConditionalGeneration.generate`
(`qwen_tts/core/models/modeling_qwen3_tts.py:2022`) accepts `instruct_ids`
AND `voice_clone_prompt` **together** — instruct embeddings are prepended to
talker inputs regardless of mode (:2076-2081). The public clone wrapper never
exposes instruct, but kwargs pass through, so `instruct_ids` handed to
`generate_voice_clone(**kw)` reaches the core. This is what LoRA-with-instruct
rides on (Alexandria and JV both use it — see §2/§3).

**HF Space demo** (`huggingface.co/spaces/Qwen/Qwen3-TTS`, `app.py`): exactly
three tabs — Voice Design (1.7B only, :243), Voice Clone (Base, xvector-only
toggle, **no instruct input**, :278), TTS CustomVoice (speaker + instruct,
:328). Models preloaded at startup.

**No text-tag vocabulary exists upstream.** Every example instruct is plain
prose (`examples/test_model_12hz_custom_voice.py:42` "用特别愤怒的语气说",
:55 "Very happy."). Zero bracketed tags in code or examples. The README's one
"paralinguistic" mention (line 52) is about the 12Hz **codec preserving**
paralinguistic information during reconstruction — nothing to do with tags.

Language: qwen takes language NAMES ("english"), not BCP-47. 9 preset
speakers on CustomVoice: Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden,
Ono_Anna, Sohee.

---

## §2 Ground truth — Alexandria

Repo: `github.com/Finrandojin/alexandria-audiobook` (cloned 2026-08-22).
Backend `app/tts.py` (1758 lines), API `app/app.py` (2569), UI
`app/static/index.html` (4097), chunks `app/project.py`.

**Model residency:** four lazy slots held side by side — custom / clone /
design / lora (`tts.py:113-116`), loading
`Qwen/Qwen3-TTS-12Hz-1.7B-{CustomVoice,Base,VoiceDesign}` (:487/:516/:545)
and Base+`PeftModel` wrap of the talker for LoRA (:574-627, adapter switch
unloads previous). Clone prompts cached per speaker (:666, invalidated when
ref_audio changes); LoRA prompts cached per adapter path.

**The dispatcher** (`tts.py:721-739`), routing by the persona's radio
(`voice_data["type"]`):

| type | call | per-line instruct |
|---|---|---|
| `clone` | `generate_clone_voice(text, speaker, …)` | **not even passed in** |
| `lora` / `builtin_lora` | `generate_lora_voice(text, instruct_text, …)` | yes → instruct_ids |
| `design` | `generate_design_voice(text, instruct_text, …)` | yes → appended to description |
| else (`custom`) | `generate_custom_voice(text, instruct_text, …)` | yes → instruct param |

Verified instruct never reaches clone anywhere: single path :1128, batch path
:1314-1431 — zero instruct handling in either.

**Per-mode mechanics:**
- Custom (:1074): CustomVoice ckpt; `instruct = per-line instruct OR
  default_style OR "neutral"`; per-voice seed honored (manual_seed). Batch
  variant (:1176, at :1556) APPENDS character_style: `f"{instruct} {style}"`.
- Clone (:1128): Base ckpt; cached ICL prompt; per-voice seed; NO instruct.
- Design persona type (:796-822): `description = f"{base_desc}, {instruct}"`
  → `generate_voice_design(description, sample_text=text)` — **a fresh,
  UNSEEDED design-model run per line**. Identity re-rolled every line; only
  the description persists. This is the drift mode.
- LoRA (:823-940): Base+PEFT; prompt = `create_voice_clone_prompt(ref_sample.wav,
  ref_text from training_meta.json['ref_sample_text'], x_vector_only_mode=True)`;
  instruct = per-line + character_style, formatted
  `f"<|im_start|>user\n{instruct}<|im_end|>\n"` → tokenized →
  `gen_extra["instruct_ids"]` → `generate_voice_clone(text,
  voice_clone_prompt=prompt, **gen_extra)`. Identity + instruct — the only
  mode with both.

**Voice Designer** (the page): preview `POST /api/voice_design/preview`
(`app.py:1390`) → `generate_voice_design(description, sample_text)` → WAV in
`designed_voices/previews/` (request model :263 has NO seed field — every
preview click is a fresh roll; `tts.py:741` supports a seed param but the API
never sends one). Save (`app.py:1410-1443`) copies the preview WAV to
`designed_voices/<name>_<ts>.wav` and appends to `designed_voices/manifest.json`:
`{id, name, description, sample_text, filename}`. List/delete endpoints
:1444/:1449. The DESCRIPTION is stored for the table's Description column,
the Edit(✎)→re-design loop (index.html:2938-2950 loads description+sample
back into the Designer), and provenance — never for render.

**Designed→clone wiring** (`index.html`): the Voice Clone dropdown groups
saved designed voices (`optgroup "Designed Voices"`, value `design:<id>`,
:1669-1670); selecting one sets `refAudio = designed_voices/<file>` AND
`refText = voice.sample_text` (:3011-3019). From there it is an ordinary
clone. The Voice Design radio's config is ONE description input
(:1704-1706) — no WAV anywhere; its "Re-design Voice" button only opens the
Designer (`openVoiceDesignEditor`), and saving there does NOT link back — the
persona must be flipped to Voice Clone manually to use a saved voice.

**Per-line instruct source:** Editor's Emotion/Style column = `chunk.instruct`
(`project.py:42`), LLM-prefilled at script annotation, hand-editable
(:289-300, edit resets status), flows `engine.generate_voice(text, instruct,
speaker, …)` (:334-342).

**Built-ins:** `builtin_lora/` ships Watson + Sion (LoRA adapters; UI shows
built-in / not downloaded / Download; trained on **61 samples**, 9/10 epochs,
final loss ~4.17/4.10). Auto-download on first render if missing
(`tts.py:846-856` via `hf_utils.download_builtin_adapter`).

**Alexandria's five radios, summarized:** Custom Voice (9 presets + style),
Built-in Voice (shipped LoRA), Voice Clone (ref WAV + transcript; instruct
ignored), LoRA Voice (trained adapter; instruct works), Voice Design (live
per-line design; instruct works; drifts).

---

## §3 Ground truth — JustVoice today

**The qwen3 engine is FAITHFUL to upstream and Alexandria.**
`server/justvoice/engines/qwen3/engine.py`:
- :37 `QWEN_VARIANT_REPOS` — cv/base/vd × 1.7b/0.6b (+ mlx mirrors); default cv-1.7b.
- :67 `PRESET_VOICES` — the 9 speakers; :181 `voices()` returns them only on cv.
- :114 `load()` — **ONE variant resident**; switching = unload+reload.
- :188 `_ensure_adapter` — base-only, PEFT wrap, Alexandria's pattern.
- :219 `_lora_clone_prompt` — x-vector-only from `ref_sample.wav` +
  `training_meta.json.ref_sample_text` (cached).
- `synth()` (:335) routes five ways:
  1. `adapter_path` → base+PEFT, xvec prompt, instruct→`instruct_ids` (:396-413).
  2. vd variant → `generate_voice_design(text, instruct=…)`; refuses a clip;
     refuses empty instruct (:411-428).
  3. clip + cv → refuse loudly ("CustomVoice cannot clone", :430).
  4. clip + base → `generate_voice_clone` ICL with `ref_text`, or
     `x_vector_only_mode` when `req.xvector_only`; **no instruct** (:437-464).
  5. base without clip → refuse; else cv →
     `generate_custom_voice(speaker=req.voice_id, instruct=instruct or "")` (:465-479).
- Instruct source: `delivery.instruct` or `delivery.engine.instruct` (:349);
  seed honored per request (:361). hf sampling knobs mapped :371-386.

**The host-side compose chain** (where "dynamic emotion" lives):
- `Delivery` model: `models.py:1172-1197` (speed, emotion enum, pitch, pauses,
  gain_db, instruct, temperature, seed, engine dict). `models.py:1186`:
  "`persona.voice_instruct` is standing, `Block.direction` is this line"
  (the deleted `style_prompt` obituary).
- `compose_instruct` (`delivery_merge.py:34`): most-specific-last, lone hint
  passes verbatim. Call sites: `render_chapter_api.py:199`
  `compose(merged.instruct or persona.voice_instruct, merged.emotion,
  block.direction)`; `generate_api.py:255/:369`
  `compose(delivery.instruct or persona.voice_instruct, delivery.emotion)`.
- `block.direction`: per-line note; written by the Chapters "+ direction"
  button and by imports — `projects_api.py:792-797` bridges the standard
  row's `delivery.emotion or delivery.style` → direction. Import adapters
  (`server/justvoice/imports/adapters/`): csv_lines (columns
  `scene,character,text,delivery,pause_after_ms`), justwrite, book_prose,
  srt, audacity_labels, podcast_markdown, justvoice_standard.
- `merge_delivery` (`delivery_merge.py:131`): tiers preset > request >
  persona.default_delivery — **but see K: the preset delivery tier is
  decided-dead and still winning** (:155-169 tier3b `delivery_json` merged last).

**Voice storage** (`storage/voices.py`): dir per voice; `manifest.json` +
`ref.wav` ("clone/import only" — header line 5) + `samples/`.
`voice_synth_fields` (`render_core.py:87-118`): cloned/imported →
`audio_prompt_path` (+`ref_text` from transcript); blended → `voice_vector`;
lora → `adapter_path`; **designed → NOTHING** (:99 comment claims the
description "rides delivery.instruct through compose_instruct" — see defect J:
no call site implements that for stored voices).

**The preview/audition door** (`api/voice_preview_api.py`): designed preview
injects `delivery["instruct"] = prompt + line direction` (:296-300) — the ONLY
place design_prompt reaches an engine. `save_preview` (:378-460): holds the
rendered preview in `entry.wav_bytes`, writes the record with `design_prompt`,
**but calls `write_ref_wav` only for `ref_wav_b64`** (clone/import) — the
designed WAV is discarded (defect A).

**Nobody copies design_prompt into personas**: `voice_instruct` is hand-typed
(`PersonasView.vue:500` textarea); grep of `design_prompt|designPrompt` in
`src/` hits only creation (`VoicesView.vue:1019/1529`), display (:116), and
the ✨ lab sender.

**Capabilities/tags:** `engines/qwen3/manifest.py:84` declares
`paralinguistic_tags: True` (union; comment defers per-variant truth to
capability_details). `inline_tags.py` docstring PROMISES qwen tag→instruct
translation; **only `strip` is imported anywhere**
(`render_core.py:35`) — the translation does not exist. Because the flag is
True, `render_core.py:279-284` never strips for qwen3 → bracketed tags go
verbatim into model text (defect C). Chatterbox-Turbo is correct as-is:
`[tag]` IS its native syntax (19 reserved tokens, capability_details :209-260,
with the emotion value_map). Kokoro strips as designed.

**Variant routing:** render uses whatever variant is loaded
(`manager.current_variant_id`, `render_core.py:417` error tells the user to
load another `model_variant`). No per-voice auto-switch → a cast mixing
cv-needing (preset) and base-needing (clone/trained/frozen-designed) voices
cannot render in one pass (defect E).

**Dataset Builder** (`api/dataset_builder_api.py`, `storage/dataset_builder.py`):
projects are filesystem sidecars `<data>/justvoice/training/builder/<id>/`
(project.json + sample_NNNN.wav; row status derived from files on disk).
Generation rides the designed preview door (source="designed", description +
row emotion, per-row seed resolution :128-142). Docstring :14-17 claims "same
seed + same description = one speaker" — **upstream documents no such
guarantee** (defect/gate G). Freeze endpoint → `training_datasets.create_dataset`.
Alder (seed 41) + Wren (seed 42): 33 rows each, engine qwen3, created
2026-08-21 07:10, ZERO clips generated — the only copies live in the data dir.
`training_builtin.py`: `BUILTIN_ADAPTERS = []` (empty until real weights are
published); download mints `VoiceRecord(source="lora")`; ZIP must contain
`ref_sample.wav` + `training_meta.json`.

**Preset rulings** (K's basis):
- `docs/plans/2026-08-15-voice-workflow-redesign.md:411-424` — §3 decision 6:
  "**Render presets are DELETED, not renamed**" (delivery-override bundle;
  "Quiet Reflection" = "direction pretending to be knobs"; replaced by scene
  direction text + effects chains; rejected alternative recorded). Never
  overturned (decision 4 carries an explicit OVERTURNED mark; 6 does not).
- `docs/dev/TASKS.md:612-618` — ruling 16: item 2 re-scoped "render preset"
  to **format + master target + effects chain**, demoted to a library page
  under Render; surface half superseded into the workbench plan.
- Code still carries the dead half: `RenderPreset.delivery_json`
  (`database/models.py:524-544`, docstring still describes the condemned
  object), `merge_delivery` tier3b winning (:155-169), 4 seeded delivery
  built-ins (DB rows), `StudioView.vue:908` sends per-scene `preset_id`,
  `preset_suggest_api.py` suggests them.

---

## §4 The defect/gap ledger

| id | finding | evidence |
|---|---|---|
| A | Designer save discards the designed preview WAV — no freeze bridge, designed voices can never become stable clone sources | `voice_preview_api.py:378-460` (wav_bytes in hand; `write_ref_wav` only for ref_wav_b64) |
| J | Stored designed voices are INERT at render — `design_prompt` read by no render/generate call site; only audition injects it; on vd with empty persona field the engine errors "this voice has none" | compose sites `render_chapter_api:199`, `generate_api:255/369`; consumer grep; `render_core.py:99` states unimplemented intent |
| C | qwen3 `paralinguistic_tags: True` is false — no upstream tag vocabulary, promised tag→instruct translation never built, tags pass verbatim into model text | `manifest.py:84`, `inline_tags.py` docstring vs single `strip` import, upstream §1 |
| D | Silent instruct drop for cloned voices — engine correctly drops it (matches upstream+Alexandria) but no UI/docs statement | engine :437-464; Alexandria documents it in README |
| E | One variant resident, no per-voice routing — mixed casts fail per line with a generic message | `render_core.py:417`, manager `current_variant_id` |
| G | "Same seed = same speaker across texts" is an unverified claim gating the whole Alder/Wren premise | `dataset_builder_api.py:14-17`; upstream silent |
| F | Custom Voice UI path unverified (engine side proven; cast-picks-preset + direction-reaches-instruct not walked) | — |
| K | §3.6 preset deletion half-executed — delivery tier still exists and WINS the merge | receipts in §3 |
| I | Kit: MTP terminal message asserts VRAM/corruption/co-load causes on a solo-child crash whose real error it truncates away | see §7.1 |

---

## §5 The build items

**Target ruled by the user 2026-08-22: "i want same as alexandria" — BOTH
designed paths coexist: frozen (Designer→save→clone) AND dynamic (per-line
design). Nothing retires.**

### A — Designer freeze bridge  *(RULED: "same as alexandria"; execution needs go)*
- In `save_preview` (`voice_preview_api.py`), for `entry.source == "designed"`:
  `state.voices.write_ref_wav(created.id, entry.wav_bytes)` and set
  `transcript = payload.get("preview_text")` (the sample text the clip speaks —
  Alexandria stores exactly this pair; the transcript is what makes it an ICL
  clone source).
- Keep `design_prompt` on the record (Alexandria stores description too — for
  display, the re-design loop, provenance; `voice_bundle.py:110` already
  requires it for export).
- **Clip-wins rule:** a designed voice WITH ref.wav renders as a clone (on
  base); WITHOUT, dynamic (J). Check `resolve_audio_prompt_for_stored`
  (`render_core.py:109`) — if it already returns ref.wav for any source,
  clip-wins may be nearly free; verify, don't assume.
- Update `storage/voices.py` header comment ("clone/import only" becomes
  "clone/import/frozen-designed").
- Acceptance: save a designed preview → `voices/<id>/ref.wav` exists; render
  on base clones it; audition unchanged; unit tests for save + synth fields.
- Blast-radius greps: `write_ref_wav|resolve_audio_prompt_for_stored|
  voice_synth_fields` across server + tests; `source.*designed` in src/.

### J — Wire design_prompt into render/generate  *(RULED shape; needs go)*
- One seam: extend `voice_synth_fields` to return the description as an
  instruct contribution when `source=="designed"` and NO ref.wav (clip wins).
- Compose order at both call sites: **description first** (identity), then
  persona `voice_instruct`, then emotion, then line direction — most specific
  last, matching Alexandria's `f"{base_desc}, {instruct}"`.
- Both doors: `render_chapter_api.py:199` and `generate_api.py:255/:369`.
- Acceptance: chapter render of a clip-less designed voice on vd works with an
  empty persona field; the engine receives the composed description; existing
  audition behavior unchanged (it already injects — ensure no double-compose
  through the preview door).
- Blast-radius greps: `compose_instruct(` all callers; `design_prompt`
  consumers; vd-variant tests.

### C — qwen3 tags honesty  *(defect fix; NEEDS WORD)*
- Set `paralinguistic_tags: False` in `engines/qwen3/manifest.py` CAPABILITIES;
  empty/withdraw qwen inline_tags claims in `capability_details.py` qwen rows;
  fix the `inline_tags.py` docstring (drop the promised qwen translation).
- Result: `render_core` strips tags for qwen3 like Kokoro.
- Later, optional: a real tag→instruct-prose translation for cv/vd only —
  separate item, not this one.
- Acceptance: unit test — qwen3 render input contains no `[tag]`; chatterbox
  passthrough unchanged.
- Blast: `paralinguistic|_tags_supported|strip_tags` across server + UI badges
  reading the capability.

### D — Say clones ignore direction  *(NEEDS WORD)*
- `docs/voices.md`: one honest paragraph on which sources take per-line
  direction per engine (qwen: preset/designed/trained yes, cloned no;
  chatterbox: tags ride text, cloned included).
- One UI hint at the direction-editing surface when the speaking voice is a
  qwen clone. Smallest honest surface; design-law precedent check first.
- Blast: none behavioral.

### E — Cast/variant preflight  *(NEEDS WORD)*
- Before render: group the cast's voices by required variant family
  (preset→cv, clip/adapter→base, clip-less designed→vd), compare
  `manager.current_variant_id("qwen3")`; refuse with a message listing
  voice → needed variant. Site: render entry in `render_chapter_api` (and
  generate single-line door).
- Auto-swap between groups = a later opt-in item, NOT this one (8 GB box).
- Acceptance: mixed cast refuses BEFORE synthesis with the actionable list;
  single-family casts unaffected.
- Blast: `current_variant_id|resolved_default_variant` callers.

### F — Verify + surface Custom Voice  *(investigation; NEEDS WORD)*
- Walk: cv variant loaded → cast row picks one of the 9 presets → block
  direction reaches `generate_custom_voice`'s instruct. Fix what's missing;
  report what worked. Engine side already proven.

### G — Seed-stability ear test  *(GATE before Alder/Wren; NEEDS WORD)*
- vd loaded; one description; fixed seed; 3 DIFFERENT texts; listen: same
  speaker? Record verdict in this doc. If NO: builder switches to
  design-one-reference→clone-the-rows (identity guaranteed, per-row emotion
  lost) or accepts variation; docstring `dataset_builder_api.py:14-17`
  softened either way (item I includes it).
- Note: Alexandria's built-ins used **61 samples**; Alder/Wren scripts have 33
  rows — decide whether to extend when training is scheduled.

### H — Train + publish Alder/Wren → BUILTIN_ADAPTERS  *(already tracked in TASKS; blocked on G)*

### I — Housekeeping  *(NEEDS WORD; kit item lives in kit TASKS)*
- Kit `llm_runner/runner/lifecycle.py:3282` region: the solo-draft-crash
  terminal message must NAME the engine's actual error line (extract e.g.
  `error loading model: …` from the tail) instead of asserting VRAM/corruption
  guesses; see §7.1 for the measured case.
- `server/justvoice/app.py:226` stale comment (data under `<data_dir>/ai-cache`
  — this box shares JW's).
- `dataset_builder_api.py` docstring per G's verdict.

### K — Execute §3.6: excise the preset delivery tier  *(RULED 2026-08-15 §3.6 + item 16; execution needs go)*
- Remove `delivery_json` from the merge: `merge_delivery` loses tier3b and the
  `preset_id` delivery lookup; preset keeps only item-2 concerns (format +
  master target + effects chain).
- Retire the 4 seeded delivery built-ins (seeds-only change; user resets).
- Align `RenderPreset` model + docstring to the item-2 shape; §598 of the
  redesign notes `voice_id`/`lexicons_json` were already dead fields.
- Rework `preset_suggest_api` + `StudioView.vue:908` per ruling 16's demotion;
  land "Quiet Reflection"-style names as scene-direction snippets per the
  ruling text.
- **The tier currently WINS the merge — every `preset_id` sender is a
  behavior change.** Blast-radius table mandatory: grep `preset_id|
  RenderPreset|render_presets|delivery_json` across server, src, tests, docs;
  paste per-row.
- Gates: full server pytest + smoke; docs/voices.md + whats-new if any
  user-visible surface moves.

**Sequencing rec:** C+D+I one afternoon · A+J together (the parity feature) ·
E rides the same PR as A/J · F and G before any Alder/Wren run · K standalone
(biggest blast radius) · H last.

---

## §6 What is NOT broken (do not "fix")

- The qwen3 engine's five-way routing — faithful; leave it.
- Clone dropping instruct — upstream + Alexandria behavior; D only documents it.
- Designed per-line dynamic mode — Alexandria has it too ("Voice Design"
  radio); the user explicitly wants BOTH paths ("i am not locking drift at
  design time i want same as alexandria").
- `persona.voice_instruct` / `block.direction` split — deliberate
  (`models.py:1180-1186`).
- Effect presets (`effect_presets_api`) — a different, live feature; K does
  not touch it. LLM `engine_presets` (p_extract…) — kit domain, untouched.

---

## §7 Session record — the other half (do not re-research)

### 7.1 The MTP draft crash (morning)
`gemma-4-26b-a4b-qat` failed its speculative-decoding draft load. Real error
(`<JV data>/ai-runtime/logs/router-20260822-095022.log`):
`llama_model_load: error loading model: invalid vector subscript` at DRAFT
load — an MSVC out-of-range, not OOM. Flags IDENTICAL to six successful runs
(08-16 12:06 → 08-21 00:59): `--n-cpu-moe 21 --n-gpu-layers 30 --ctx-size
32768 --cache-type-k/v q8_0 --flash-attn on --spec-draft-n-max 2 --spec-type
draft-mtp`, engine b10437/cuda12, solo child (no co-load race). Intermittent
since 08-16 23:59 (36/46 router logs). The 08-22 dedup is NOT involved: the
failing draft is JW's physical copy (link count 1, untouched). Kit chain:
`process.py:645` `_looks_like_draft_failure` matches the string as the co-load
race → both escalation stages run pointlessly → terminal message at
`lifecycle.py:3282` asserts causes the log contradicts (fix = item I).
The draft file sha256 was NOT verified against its blob name — decisive
30-second check if it recurs (a blob's filename IS its content hash).

### 7.2 Shared LLM cache — how it actually works (all verified)
- `llm_runner/llm/install.py:399` `resolve_cache_roots`: explicit arg > stored
  choice > `<data>/ai-cache`; `shared = root != own`; when shared,
  `runtime_root = <data>/ai-runtime` (each app's OWN generated `models.ini` +
  spawn logs — sharing those would cross-clobber; `lifecycle.py:462-471`).
- JV's stored choice: `runner_setting.cache_root =
  E:\Dev\Web\justwrite-app\src-tauri\target\debug\data\ai-cache` (built_in=0).
- Update check (`lifecycle.py:1065-1089`): `current` = build ON DISK
  (`_installed_build`), pin only as nothing-installed fallback (QC-25
  recorded a DB reset nearly offering a DOWNGRADE) — so JV reports b10437
  from the shared folder exactly like JW; wiping JV's DB cannot break this.
- Latest tag via GitHub releases API (`_fetch_latest_llamacpp_tag`).
- JV's OWN `<data>/ai-cache` is DEAD since the switch: hf 23 GB (newest file
  08-14 20:41, both gemma models also in JW's), llamacpp 1.1 GB (newest
  08-15 07:08). `ai-runtime` is LIVE (today's logs).
- Speech engines never touch ai-cache; their state = `engines/<id>/.venv`,
  `engines/<id>/models`, `<data>/speech-cache`.

### 7.3 The parked fresh-install speech clean — approved scope
User answers already given: **(1)** delete `engines/.uv-python` (cold-install
path), **(2)** clear the 10 speech rows in `model_measurements`
(`kind IN ('tts','stt')` — moot if DB wiped), **(3)** remove orphan
`engines/pocket_tts/` (3 cpython-312 .pyc, source gone in cd13dfa),
**(4)** assistant stops the server (PID 9464 `justvoice-server --port 8741` +
2 llama-server children — VERIFY parentage before killing; kill by PID/port,
never image name), **(5)** delete JV's orphan `<data>/ai-cache` (24 GB).
Delete set: `engines/{chatterbox,kokoro,luxtts,qwen3,whisper}/{.venv,models}`
(~36 GB du), `<data>/speech-cache` (3.7 GB).
**Still open — the clean does not run until answered:** wipe `justvoice.db`
y/n (fresh DB loses the `cache_root` row → re-choose shared in QuickSetup =
part of the test; 3 user-added gemma catalog rows re-add via UI) · back up
Alder+Wren y/n (two project.json files, the ONLY copies; recommend copying to
scratchpad first).
**Never touched:** JW's ai-cache (197 GB), `<data>/ai-runtime`, git-tracked
source. After a shared-choice fresh run, `<data>/ai-cache` should NOT exist —
a clean pass/fail check.

### 7.4 Alder + Wren (so nobody re-asks)
Dataset-builder projects = the staged raw material for JV's Watson/Sion
equivalents (shipped built-in LoRA narrator voices). Alder: male fifties warm
baritone, seed 41. Wren: female thirties clear mezzo, seed 42. 33 rows each,
30 emotions, identical scripts, all pending, no audio. Filesystem-only:
`<data>/justvoice/training/builder/dsb-915458bc1889 (Alder) /
dsb-3128dc8572f7 (Wren)`. Worth ~an hour of writing; zero compute invested.

---

## §8 Re-verification commands

```bash
# clones (scratchpad or anywhere disposable)
git clone --depth 1 https://github.com/Finrandojin/alexandria-audiobook
git clone --depth 1 https://github.com/QwenLM/Qwen3-TTS qwen3-tts-repo
git clone --depth 1 https://huggingface.co/spaces/Qwen/Qwen3-TTS qwen3-tts-space

# the load-bearing greps
grep -n "def generate_voice_clone" -A 12 qwen3-tts-repo/qwen_tts/inference/qwen3_tts_model.py   # no instruct param
grep -n "voice_type == \"clone\"" -B2 -A8 alexandria-audiobook/app/tts.py                        # instruct not passed
grep -n "designed_voices" alexandria-audiobook/app/static/index.html | head                      # designed→clone wiring
grep -rn "design_prompt" server/justvoice --include=*.py | grep -v test                          # J: no render consumer
grep -rn "from .inline_tags" server/justvoice --include=*.py                                     # C: only strip imported
grep -n "delivery_json" server/justvoice/delivery_merge.py server/justvoice/database/models.py   # K: the live corpse
```

---

## §9 Execution record — A · J · E · C · D · I · F (2026-08-22)

Go given as *"your rec update docs and go for coding"*, taken as the
recommended go: **A+J+E as one change with F's walk folded in**, then
**C+D+I**, plus docs. **K was NOT started** (the rec placed it last and
standalone; its blast radius is the largest in the ledger). **G was not run** —
it is an ear test and needs the user, not the assistant.

### 9.1 Ground truth re-read before coding — corrections to §5's assumptions

Two of item A's own open questions are now answered from source, not guessed:

- **`preview_text` IS on the payload.** `VoicePreviewRequest.preview_text`
  (`voice_preview_api.py:61`, default "The quick brown fox…", max 2000) and
  `entry.payload = body.model_dump()`, so `payload.get("preview_text")` was
  available all along. A's spec was right.
- **Clip-wins was NOT nearly free.** §5 hoped
  `resolve_audio_prompt_for_stored` might already return ref.wav for any
  source. It does not — it gated hard on
  `if stored.source not in ("cloned", "imported")`. Adding `"designed"` to
  that tuple is what makes the freeze render.

### 9.2 One deviation from J's stated mechanism, surfaced

J says "extend `voice_synth_fields` to return the description as an instruct
contribution". Taken literally that cannot work, and the item's own next
sentence ("compose order at both call sites") is why:

- `voice_synth_fields` is called at `render_core.py:444` **after** the API
  layer has already composed the instruct, and again in `generate_api:158`.
- Its returns are **top-level synth keys**; qwen reads `delivery["instruct"]`.
  A key added there would never reach the model.
- Its docstring and `voice_preview_api.py:578` both pin it to "synth INPUTS
  only" — the audition door's language resolution depends on that separation.

So the rule lives in a **sibling function in the same module** —
`voice_design_instruct` / `voice_design_instruct_for_id` beside
`voice_synth_fields` — called from the three compose sites in exactly the
order J specifies. One place still knows clip-wins. Intent and order are
honoured; the mechanism differs.

### 9.3 What shipped

| item | change | file:line |
|---|---|---|
| A | `resolve_audio_prompt_for_stored` accepts `designed` | `render_core.py:75` |
| A | `save_preview` writes the preview WAV as ref.wav; `transcript` ← `preview_text` | `voice_preview_api.py` (record build + the `elif entry.source == "designed"` branch) |
| A | ref.wav header no longer says "clone/import only" | `storage/voices.py:4` |
| J | `voice_design_instruct` + `_for_id` — clip-wins in one place | `render_core.py:95`/`:121` |
| J | description composed FIRST at all three doors | `render_chapter_api:215`, `generate_api:264`, `generate_api:386` |
| E | `qwen_family_for_voice` + `qwen_family_conflicts` | `render_core.py` (after `voice_design_instruct_for_id`) |
| E | preflight refusal naming voice → checkpoint | `render_chapter_api` (before `warm_lines`) |
| C | `paralinguistic_tags: False` + the evidence | `qwen3/manifest.py:84`, `qwen3/engine.py:89` |
| C | `inline_tags.py` docstring drops the promise it never kept | `inline_tags.py:1` |
| D | persona hint stops claiming a qwen clone takes direction | `PersonasView.vue:114` |
| I | `app.py` ai-cache comment now describes `resolve_cache_roots` | `app.py:226` |
| I | dataset-builder docstring marks the seed premise UNVERIFIED, points at G | `dataset_builder_api.py:14` |

Failure-mode note on A: a failed freeze **logs and continues** rather than
deleting the voice, unlike the clone branch above it. A designed voice with no
clip still works dynamically; losing the freeze is not worth losing the save.

### 9.4 F — the Custom Voice walk (investigation, nothing to fix)

Walked end to end, by reading, and it is **already wired**:

1. `qwen3/manifest.py:273 STATIC_VOICES` — the 9 speakers, published without
   loading the engine.
2. `voices_api.py:56` — `/v1/voices` emits them as `source="preset"`.
3. `src/stores/voices.js` — the store `PersonasView` reads; reloads on
   `jv:health-refresh`.
4. `render_chapter_api:156` — `voice_id = persona.voice_id`.
5. `:215` compose → `merged["instruct"]` carries `block.direction`.
6. `:234` → `render_line(voice=voice_id, delivery=merged, …)`.
7. `render_core:444` → `mgr.synth(… "delivery": delivery …)`.
8. `qwen3/engine.py:349` `instruct = delivery.get("instruct")` → `:479`
   `generate_custom_voice(speaker=req.voice_id, instruct=instruct or "")`.

Per the standing rule, F's **fixes** were never part of this go — none were
needed, so nothing was changed. F is closed.

### 9.5 Gates

- `ruff check .` — clean.
- `pytest` — **741 passed, 0 failed** on a clean re-run. The first full run had
  one failure, `test_prefetch_cancel_via_http_endpoint`; it passed alone (1/1),
  passed with its whole file (17/17), greps zero references to anything this
  change touched, and did not recur. Timing-sensitive under full-suite load.
- `npm run build:vite` — built.
- Playwright smoke, `--data-dir src-tauri/target/debug/data` — **15/15 views,
  zero JS errors**. As CLAUDE.md warns, this proves the views load; it clicks
  no tabs and renders no audio, so A/J/E's behaviour is covered by the unit
  tests, not by it.
- New: `server/tests/test_designed_voice_parity.py`, 15 tests over A, J, E, C.

### 9.6 Not verified by any gate

- **No audio was rendered.** A designed voice was never actually frozen and
  re-spoken on a real engine. The freeze, the clone-from-frozen-clip, and the
  clip-less dynamic path are proven by unit test and by reading the engine's
  routing — not by ear.
- **The preflight was never triggered in the app**, only in tests with a fake
  manager. Its preset→`cv` branch depends on `_resolve_engine_for_voice`
  finding qwen3 through `manifest.static_voices`; if that ever missed, the
  preflight would under-report (a false negative — it would let a render
  through, never block a good one).
- **D's UI hint was not seen rendered.** It is a string change in an existing
  computed; the smoke loads the view but does not open a persona.

### 9.7 Open — needs the user's word

- **G** (seed-stability ear test) — untouched, still gates H. Its verdict is
  already wired into `dataset_builder_api`'s docstring as a question.
- **K** — untouched, still the largest blast radius in the ledger.
- **A gap D does not name.** A creates a THIRD case the persona hint cannot
  see: a designed voice **with** a frozen clip renders as a clone and so
  drops direction, but the frontend cannot tell a frozen designed voice from
  a clip-less one — `VoiceRecord` exposes `source` and `design_prompt`, and
  nothing that says whether ref.wav exists. D's spec only names "a qwen
  clone", so only `cloned`/`imported` were handled; the frozen-designed case
  still shows `✓ takes direction`, which after A is wrong. Closing it needs a
  decision: expose a computed `has_ref_clip` on the voices API, or leave the
  UI silent and let `docs/voices.md` carry it (which it now does). **Not
  filled in by assumption.**

### 9.8 Committed (2026-09-19)

The build sat uncommitted for four weeks. It went in on *"commit nad push"* as
three commits, pushed to `origin/main` (`6a2d30d..108caac`):

| commit | holds |
|---|---|
| `6c7cf57` | the persona sweep — `SpeakerCorrection.character_id` → `persona_id`, the mock + redesign-doc audit |
| `adfa3ea` | `scripts/smoke.js` dismisses the boot splash; NAV-FAIL keeps the interception line |
| `108caac` | this program — A · J · E · C · D · I, this doc, `test_designed_voice_parity.py`, the docs |

`TASKS.md` and `code-map.md` carried hunks for more than one of them and were
split by hunk, so each record landed with its change.

Every gate re-run fresh on the tree before the first commit, not quoted from
§9.5: `ruff check .` clean · `pytest` **741 passed, 0 failed** (329 s) ·
`npm run test:unit` 67/67 · biome on the three changed renderer files clean ·
`npm run build:vite` built · Playwright smoke with
`--data-dir src-tauri/target/debug/data` **15/15 views, zero JS errors**, the
new SPLASH line reporting the splash dismissed. The gate server was killed by
port 8741, with the `llama-server` warm-on-boot had spawned under it.

§9.6 is unchanged by any of this — still nothing rendered by ear.
