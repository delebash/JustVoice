# Verdicts — switch-fork.md (adversarial check, 2026-10-13)

Refs: "jv.5" = the pinned tag v0.9.0-jv.5; "HEAD" = local `jv` f7d83ffb (v0.9.1 merged, unpushed). Spec option counts checked at both. Summary: 5 CONFIRMED (F3 F4 F8 F10 F12), 1 CONFIRMED with a corrected sub-claim (F1), 8 PARTLY (F2 F5 F6 F9 F11 F13 F14 F16), 2 REFUTED (F7 F15).

Overlap: F2, F5 and F10 are already open work in TASKS. The 2026-10-13 entry's OPEN 2 says: "the seven hand-wired engines on the same path, what our fork adds in our fork's own specs". They still hold as findings, but they don't need a new TASKS line.

---

## F1 — Runtime options: the approved fork specs were replaced by an app catalog limited to what was measured
**Verdict:** CONFIRMED (one sub-claim corrected) · **Severity:** VISIBLE

**Evidence**
- What the user approved on 2026-10-04 (TASKS:4952-4953): "| A fork endpoint listing options | Write option specs for our 7 families in the fork, in the format Kokoro's spec already uses |". The batches were then listed as "5h exposing every option" (TASKS:4990).
- What was built: `runtime_options.js:7` says "Only options whose effect was measured are offered". `OFFERED` (`:29-56`) holds only two Qwen3 session options.
- The switch to an app catalog appears only in a BUILT line (TASKS:5013-5014) and in audit §13.5. After step 5 the user was shown three things: the release tag, the listening files and the tiers. None of them was this.
- The blanket go ("your recs on any fixes you find") came before this choice existed, so it does not cover it.
- A later approval points the same way as the finding. On 2026-10-11 the user was shown "Generate each model's settings controls from its spec … Keep hand-written code only where a model truly needs it" and answered "your rec go" (TASKS:314ff).
- The fork's `model_specs` were never touched for the seven families. `git log v0.9.0..v0.9.0-jv.5 -- model_specs/` shows only Turbo commits: 3865d245 and a1b68c33.

**Sub-claim corrected:** RESEARCH.md:207-209 is not simply stale.
- It is right that qwen3_tts, chatterbox, voxcpm2 and pocket_tts list no options at jv.5. They list them only at HEAD: 17/15, 16/8, 14/15, 13/20. Upstream added them in 19859a07 (2026-10-06).
- But "Only Kokoro's model spec lists its options" was already wrong at v0.9.0. kitten_tts listed request, session and load options, and qwen3_asr listed 2 request options.
- Unsure: Pocket's 13 request options. The audit read three of them (temperature, noise_clamp, eos_threshold) as reaching only voice-state preparation. Upstream's v0.9.1 spec lists all 13 as request options, and the server does call `prepare()` once per request (`app/server/runtime.cpp:2238`). Only a measurement settles it.

**Still stands:** the approved spec-driven, everything-exposed design was replaced, without asking, by an app-side catalog that offers only what was measured.

**FIX**
1. **Recommended.** For the seven families, take request and session options from `catalog.json`: the fork's `model_specs/<family>.json`, plus `webui/configs/model_params.json` where a spec lists none. Use one generalised settings function, and keep a per-family curated file only for app-owned options and the approved defaults (for example Qwen3's 16-bit decoder weights).
2. **Attack**
   - **Is it audio.cpp's own way?** Yes: `model_specs/*.json` options and `webui/configs/model_params.json`. But jv.5's specs list no options for Qwen3, Chatterbox, Turbo, VoxCPM2 or Pocket, so the pinned app would get only `model_params.json`'s short lists. Getting upstream's specs into a packaged app needs a jv.6 release, and the user said 2026-10-13: "only do a release if you need to". `chatterbox_turbo.json` lists no options even at HEAD, so it needs our own fork spec edit (the 2026-10-04 approved route).
   - **New rules the user hasn't seen.** `generated.settingsOf` (generated.js:77-120) has its own rules. It drops a number that lacks a min or a max, so VoxCPM2 `num_inference_steps`, Qwen3 `top_k` and every `max_tokens` would vanish. It hides `stream*` and `text_chunk*`. It marks everything advanced. It handles request options only. Open questions:
     - how to offer a number with one end;
     - whether to offer the max-token knobs (audit: "positional caps weren't checked");
     - the labels, which are humanized option names;
     - which session options to show.
   - **Data risk.** Saved persona knobs use app keys (`talker_temperature`, `cfg_value`, `inference_timesteps`, `cfg_weight`) that are not the spec names (`temperature`, `guidance_scale`, `num_inference_steps`). Renaming them orphans saved values unless a key map stays.
   - **Blast radius**
     - `server/src/engines/capability_details.js`
     - `engines/audiocpp/runtime_options.js`
     - `engines/audiocpp/slot.js` (the per-family `toSpeechRequest` branches)
     - `engines/audiocpp/generated.js`
     - `server/src/models.js` (KnobSpec)
     - `api/models_api.js`, `api/engines_api.js`
     - `src/components/SpeechEnginesTab.vue`, `src/pages/PersonaEditorPage.vue`
     - tests: `engine_knob_wiring`, `audit_step5`, `emotion_wiring`, `line_model_settings`, `persona_render`, `turbo_cloning`, `audiocpp_switch`
   - **Simpler alternative:** keep `capability_details.js` and add the missing options from `catalog.json`. That keeps two sources, which the 10-13 NOT rules out.
3. **Surviving fix**
   - Use one spec-driven settings function for request and session options, with a curated key map so saved knobs keep working.
   - Write Turbo's options into our fork spec.
   - Ask about: numbers with one end, the max-token knobs, the labels, and jv.6.
   - Correct RESEARCH §1's "Only Kokoro's".

---

## F2 — What our fork adds is not declared in the fork's own specs
**Verdict:** PARTLY · **Severity:** INTERNAL (users feel it through F3, F4 and F10)

**Evidence**
- Kokoro: `kokoro_tts.json` has no `voice_pack` and nothing about inline pronunciations, at jv.5 and HEAD (grep found nothing).
- Chatterbox: `chatterbox.json` languages are still the 19. he, ru, zh and ja appear 0 times.
- Turbo — **wrong in the finding.** At jv.5 `chatterbox_turbo.json` does declare cloning:
  - `capabilities.tts: ["speaker_reference","built_in_voices"]`;
  - the "Clone" tag;
  - a `voice_encoder_weights` tensor source;
  - a description naming `delebash/chatterbox-turbo-GGUF` and `delebash/chatterbox-nano-GGUF` (fork 3865d245).
- Turbo — what really is missing: our packages (Turbo and Nano, q8_0/f16), a declared clone task, and any request options. `session.cpp:22-40` reads temperature, top_p, repetition_penalty, top_k, max_new_tokens and seed.
- The 10-04 approval covered only options. Fork additions in general are in the 10-13 OPEN 2.

**Still stands:** Kokoro's `voice_pack` and inline pronunciations, Chatterbox's he/ru/zh/ja, and Turbo's packages and options are undeclared in the fork specs. Turbo's ability to clone is declared.

**FIX**
1. **Recommended.** Declare in our fork's specs:
   - `kokoro_tts.json`: `voice_pack` as a request option, and the inline markup in the description;
   - `chatterbox.json`: he, ru, zh, ja;
   - `chatterbox_turbo.json`: packages for our Turbo and Nano repos (per-package `download.repo`, the way `chatterbox.json` already points a package at `ResembleAI/chatterbox`), plus its request options.
2. **Attack**
   - **Standard?** Yes, the `model_specs` format.
   - **Cost:** every upstream merge can conflict with these edits (10-13: the fork stays and sends no routine pull requests). The app sees them only after a release plus a `scripts/audiocpp-catalog.js` run.
   - **New rule needed:** Japanese works only with the optional dictionary. How should a spec declare a conditional language? Open question.
   - **Blast radius:** `../audio.cpp/model_specs/{kokoro_tts,chatterbox,chatterbox_turbo}.json`, `scripts/audiocpp-catalog.js`, `server/src/engines/audiocpp/catalog.json`, `release.js` FEATURES and `pinnedHas`, `chatterbox/manifest.js`, `capability_details.js`.
   - **Alternative:** keep the additions in the app's curated files ("what stays ours" in the 10-11 plan). The 10-13 NOT rules that out.
3. **Surviving fix:** the spec edits as listed. Ask how to declare Japanese. Ship them with the next release, not as a separate one.

---

## F3 — Chatterbox Multilingual v3 was planned at the cut and is not offered
**Verdict:** CONFIRMED · **Severity:** VISIBLE

**Evidence**
- Switch plan §3.2:120: "Multilingual v2 · v3 (one file, a session option)". It was written under the go "go your rec do the design and coding go", so it is the implementer's own plan under a blanket go, not a word-for-word approval.
- No later entry drops v3. The 10-01 engine scan's ruling question 6 ("Chatterbox Multilingual v3 — move the pin or stay?") has no answer on record.
- The code:
  - `chatterbox/manifest.js:86-99` has one row, `chatterbox-multilingual-v2-q8`, plus its f16 twin;
  - nothing sets `chatterbox.multilingual_t3`;
  - the runtime reads it at jv.5 (`src/models/chatterbox/session.cpp:320-330`, default "v2");
  - the GGUF packages carry the `t3_multilingual_v3` prefix (`chatterbox.json` tensor sources).
- The 10-13 goal ("use everything by default") applies.

**Still stands:** the v3 T3 inside the downloaded file can't be chosen.

**FIX**
1. **Recommended.** A model-row choice for `chatterbox.multilingual_t3` (v2/v3), offered the way `runtime_options.js` offers Qwen3's session options.
2. **Attack**
   - **Standard?** Yes: it is a session option. At HEAD `chatterbox.json` declares `multilingual_t3` as an enum with default "v2". At jv.5 it is read in source but not declared.
   - **New, never shown:** the label and wording, whether the default stays v2, and whether v3 changes the language list. The 10-01 scan says Resemble's v3 has 25 languages; audio.cpp's list is unchecked. Open questions.
   - Memory prices are kept per variant, so v3 may need its own measured peak.
   - **Blast radius:** `runtime_options.js` OFFERED, `slot.js` `_entries_for`, `chatterbox/manifest.js`, `api/models_api.js`, `SpeechEnginesTab.vue`, `manager.js` price rows.
   - **Alternative:** a separate variant row (same file, session option set). That matches the plan's wording just as well.
3. **Surviving fix:** the row option, or the row. If F1's spec-driven session options land, this follows from them. Ask the wording, the default and the language question.

---

## F4 — Turbo and Nano are clone-only; the built-in voice is left out
**Verdict:** CONFIRMED · **Severity:** VISIBLE

**Evidence**
- The approved words: "Chatterbox Turbo cloning (and Nano with it)" (switch §5.1, under "you have a go for all gaps").
- "Clone-only" appears only in the implementer's gap-1 plan §1: "brings them back as they were … clone-only". No user answer covers it; the user answered only Q1 (the HF repos) and Q2.
- The 10-02 "Chatterbox Turbo — out: … one English voice and no cloning" was about leaving Turbo out entirely. It does not say to exclude the built-in voice once Turbo can clone.
- Code:
  - `chatterbox/manifest.js:53` sets `preset_voices: 0`;
  - `slot.js:930` refuses a voice with no clip;
  - `slot.js:566-569` warms up on the built-in voice, which proves it works with our GGUFs;
  - the jv.5 spec lists `built_in_voices`.

**Still stands:** a working built-in voice on Turbo and on Nano is hidden.

**FIX**
1. **Recommended.** Give the Turbo and Nano rows one preset each (`preset_voices` 1, a STATIC_VOICES entry), and send it with no `voice_ref`.
2. **Attack**
   - **Standard?** Yes: spec `capabilities.tts` includes `built_in_voices`.
   - **New, never shown:** the spec gives the voice no name, and gender is unknown. Nano shares Turbo's conditioning file (gap-1 §2), so it is the same voice on two models — say so, or list it once? Open questions.
   - **Blast radius:** `chatterbox/manifest.js` (`turboRow`, `STATIC_VOICES`), `slot.js:925-931`, `capability_details.js` (Turbo and Nano rows), `voice_model.js` (`describe`), `VoicesPage.vue`, `PersonaEditorPage.vue`, `server/tests/turbo_cloning.test.js`.
   - **Alternative:** none simpler.
3. **Surviving fix:** as recommended, after the user names the voice and answers how Nano's copy is listed.

---

## F5 — The other hand-wired families' packages and tasks appear nowhere
**Verdict:** PARTLY · **Severity:** VISIBLE

**Evidence**
- `generated.js:31-35` and `:170` skip the hand-wired families. That skip is plan text (catalog plan §3); the user never answered that point.
- **Wrong in the finding:**
  - Chatterbox voice conversion was deferred by the user's 2026-10-11 answer 9: "voice conversion, cleanup, sound effects and music each get their own plan and mock after, conversion first".
  - QwenCleo-ASR exists only at HEAD. At jv.5, `qwen3_asr.json` has no `qwencleo` package, so the pinned runtime has nothing to offer.
  - Qwen3-ASR 0.6B is out by the user's word, as the finding itself says.
- **Confirmed at jv.5, with no approval:**
  - the `orig` GGUF packages `qwen3_tts_1_7b_base_orig` and `voxcpm2_orig`;
  - audio.cpp's own Turbo package;
  - the streaming modes (Pocket, VoxCPM2, ASR). The generated path also hides them: `NOT_SETTINGS`, "renders don't stream".

**Still stands:** the orig precisions, audio.cpp's own Turbo package and the streaming modes are not offered, because the hand-wired skip hides whatever the seven manifests don't list.

**FIX**
1. **Recommended.** Move the seven families onto the generated path (10-13 OPEN 2), with their measured fixes in curated files.
2. **Attack**
   - **Data risk:** stored voices, personas, settings and price rows hold engine ids ("kokoro") and variant ids ("chatterbox-multilingual-v2-q8"). Generated engines use family ids ("kokoro_tts"). Changing ids orphans user data, so the existing ids must stay. That is a rule that needs the user's word.
   - `generatedModels` carries its own unapproved filters: `clones()` (already recorded), `SHOWN_STATUS` (approved 10-11), and `usablePackage`, which is GGUF-only and requires the package to be complete at the pin.
   - Voice conversion must stay out (the user's 10-11 answer 9).
   - Open question: should streaming be offered at all?
   - **Blast radius:**
     - `generated.js`, `curated/index.js` and new curated files;
     - all seven manifests (`asr`, `chatterbox`, `kitten`, `kokoro`, `pocket`, `qwen3`, `voxcpm2`);
     - `capability_details.js`, `slot.js`, `voice_model.js`, `manager.js`;
     - `server/tests/audiocpp_generated.test.js` and the per-engine tests.
   - **Simpler alternative:** add the orig rows and audio.cpp's Turbo package to the existing manifests (the `sixteenBit` pattern). It is smaller, but still hand-wired, which the 10-13 NOT rules out.
3. **Surviving fix:** the 10-13 adoption plan, with id preservation as a stated requirement, voice conversion left out, and streaming as a question.

---

## F6 — Pocket TTS leaves out 6 of its 26 presets on licence grounds
**Verdict:** PARTLY · **Severity:** VISIBLE

**Evidence**
- The 20 presets were the user's explicit word on 2026-10-02 (TASKS:4138-4140): "add Pocket TTS as an engine: CPU-capable cloning plus its 20 commercially usable presets", answered "your rec on 1 and 2, go on 3 and go on build". So it is not an implementer narrowing.
- The 2026-10-11 ruling (TASKS:806-807): "lets not limit ourselves anymore we just make sure the user is informed". Its NOT names the roster rules as reasons to leave out *a model*. Its OPEN says "a plan for the label … GO: needed for the plan".
- So the later ruling's spirit covers the presets, but its text names models, and its plan has no go yet. Neither ruling clearly governs. The user decides whether 10-11 reaches preset recordings.
- The code is as described: `pocket/manifest.js:20-28` and `:74-95`.

**Still stands:** six presets are hidden. Whether the 10-11 label-not-limit ruling covers them needs the user's word.

**FIX**
1. **Recommended.** Ask. If yes, offer all 26, each labelled with its recording's licence.
2. **Attack**
   - **Standard?** Only partly. `docs/model_licenses.md` (audio.cpp) labels models, not presets. The per-preset source is Kyutai's `tts-voices` README, which must be checked on the web (CLAUDE.md).
   - **New, never shown:** where a preset's label shows, its words, and whether a "No" preset has its own accept step or rides Pocket's terms gate. Open questions.
   - **Unverified:** giovanni, lola, juergen and rafael sit under `english/embeddings/` in `catalog.json`, but their names suggest the four non-English languages. That matters for F7.
   - **Blast radius:** `pocket/manifest.js` (`PRESETS`, `STATIC_VOICES`), `/v1/voices` (`VoicesPage.vue`, `PersonaEditorPage.vue`), `src/services/engineFacts.js`, `docs/engines.md:214-220`, `server/tests/japanese_dictionary.test.js` and `audit_step5.test.js` (both count STATIC_VOICES).
   - **Alternative:** none.
3. **Surviving fix:** ask first. Then 26 presets with labels from the checked README.

---

## F7 — Pocket presets are tagged English only, so a language filter hides them
**Verdict:** REFUTED (one point left unverified) · **Severity:** —

**Evidence**
- The filter is meant to work on the voice's own language, not on what it speaks. The user decided it on 2026-10-05 (TASKS:2855-2858): "Rename the filter from Language to Voice's language, so it can't be mistaken for Speaks". On 2026-10-06 Voices' column "Speaks" became "Voice's language" (TASKS:2087).
- The Voices row shows the other languages as "+N" with "On … this voice can also speak" (`VoicesPage.vue:776-781`).
- So the Voices filter (`:225`) and the persona page's filter (`PersonaEditorPage.vue:359-362`) do what was approved.
- Qwen3 CustomVoice's native languages are Qwen's own data.

**Unverified:** Pocket presets get `language: "en"` as "the language of the default model" (`pocket/manifest.js:100-102`), an assumption rather than each recording's own language. Checking Kyutai's `tts-voices` README per preset would settle it.

**Still stands:** none as a finding.

---

## F8 — Kitten's seed: the approved re-check is not on record, and the seed is still hidden
**Verdict:** CONFIRMED · **Severity:** VISIBLE

**Evidence**
- Approved: "5a requests: seeds, defaults, clamps, language names, Kitten's seed" (TASKS:4984-4985).
- §13.5's 5a record covers Kitten only for random no-seed. There is no re-measure in the audit, RESEARCH, TASKS or `git log --all`.
- `capability_details.js:128-141` is unchanged ("no seed control is offered").
- The code suggests the seed should repeat:
  - Kitten reads `seed` in `prepare()` and rebuilds its decoder (`src/community_models/kitten_tts/session.cpp:225-232`);
  - the server calls `prepare()` for each request (`app/server/runtime.cpp:2238`);
  - the decoder seeds its random generator from that seed on every decode (`decoder.cpp:1029`).
- Kitten's jv.5 spec lists `seed`.

**Still stands:** the approved 5a item "Kitten's seed" was never done. A spec option stays hidden on a 10-02 measurement that the code reading contradicts.

**FIX**
1. **Recommended.** Through the app under `npm run dev` (fork checkout), render the same Kitten line twice with the same seed and compare bytes. If they match, add `seedKnob()` to the Kitten row and drop the "doesn't repeat" notes.
2. **Attack**
   - **Standard?** Yes: the spec's `seed` (min 0).
   - **New:** nothing, if the existing Seed knob is reused, but that knob's 2,000,000,000 max is F9's question.
   - **Blast radius:** `capability_details.js` (kitten row and notes), `docs/engines.md:24,532,540-542,673`, `server/tests/engine_knob_wiring.test.js`.
   - **Alternative:** none.
3. **Surviving fix:** as recommended. If the bytes differ, record the cause in RESEARCH §1.

---

## F9 — The hand-wired knob table is narrower than audio.cpp's own controls
**Verdict:** PARTLY · **Severity:** VISIBLE

**Evidence**
- **Narrower than audio.cpp, confirmed.** Against jv.5 `webui/configs/model_params.json`:

  | Knob | App | audio.cpp |
  |---|---|---|
  | Chatterbox exaggeration (`capability_details.js:96-97`) | 0.25–2.0 | 0–2 |
  | VoxCPM2 CFG (`:348`) | 1.0–5.0 | 0–5 |
  | VoxCPM2 steps (`:349`) | 4–30 | ≥1, no max |
  | Qwen3 top k (`:66`) | 1–100 | ≥0, no max |

- **Wrong in the finding:**
  - Repetition penalty: the app's max 4.0 is **wider** than audio.cpp's own UI, which is 1.0–2.0 for qwen3_tts and chatterbox.
  - Kokoro speed: the app's max 3.0 is **wider** than audio.cpp's UI max 2.0.
  - Seed: 4,294,967,295 is only in HEAD's Chatterbox spec. At jv.5, Kokoro and Kitten seed have min 0 and no max.
  - The 0.05 temperature/top-p floor fixes a refusal and a divide: Qwen3 refuses temperature 0 and Chatterbox divides by it (audit D4, D9). It falls under the approved 5a "clamps"; only the value 0.05 was never shown.
- Most ranges come from before the switch (capability_details.py since 2026-06) and were carried over under "the same, mapped onto audio.cpp's options" (switch §1). None was shown to the user.

**Still stands:** exaggeration's 0.25, VoxCPM2's CFG floor of 1.0 and steps 4–30, Qwen3's top-k 1–100 and the 2,000,000,000 seed max are narrower than audio.cpp's own controls, and none of them was shown. The 0.05 value was never shown either.

**FIX**
1. **Recommended.** Take ranges and defaults from the spec, else `model_params.json` (part of F1's fix). Keep a floor only where the runtime refuses or divides, each recorded with its cite.
2. **Attack**
   - **Standard?** Yes, `model_params.json` and the specs.
   - **Problem:** `model_params.json` gives many numbers no max (top_k, steps). A slider needs two ends, so choosing one is a new number.
   - **Narrowing to audio.cpp's UI would take range away from users today** (repetition 4.0 → 2.0, speed 3.0 → 2.0). Open questions:
     - the max for open-ended numbers;
     - whether to narrow repetition and speed;
     - the floor value (0.05, or the smallest positive step).
   - **Saved values:** persona values outside a new range need a rule (clamp or keep).
   - **Blast radius:** `capability_details.js`, `slot.js` (`MIN_SAMPLING` and its clamps near :75 and :841-860), `PersonaEditorPage.vue`, `server/tests/engine_knob_wiring.test.js`, `audit_step5.test.js`.
   - **Alternative:** none simpler. It folds into F1.
3. **Surviving fix:** fold into F1, and put the three open questions to the user.

---

## F10 — What the spec and GGUF carry is copied by hand into the hand-wired engines
**Verdict:** CONFIRMED · **Severity:** INTERNAL

**Evidence**
- Kokoro voices: `kokoro/voices.js:11-66` lists 54 [id, name, language, gender] rows, all of which follow from jv.5's `ui.builtin_voices` (54 ids, k2-fsa naming). `blending.js:154-157` already reads the GGUF's `voices.json`.
- Kitten: 8 names, the same as the spec's `builtin_voices`. Gender is not in the spec, so it is legitimately ours.
- `FAMILY_BUDGET` (`slot.js:758`):
  - Kokoro 240 and Kitten 400 are jv.5 spec defaults;
  - Chatterbox 128 is a spec default only at HEAD;
  - Turbo 128 is in no spec, only the source constexpr (`chatterbox_turbo/session.cpp:20`).
- `CALIBRATION_AUDIO_S` 30 (`slot.js:760`) copies audio.cpp's chunk length.
- Language lists are hand-written in the Chatterbox, VoxCPM2, ASR and Qwen3 manifests.
- Against the 10-13 NOT, "a hand-wired engine where audio.cpp's spec, plus our additions made in the standard way, can say it". Already in 10-13 OPEN 2.

**Still stands:** as the finding says. Turbo's budget and Chatterbox's he/ru/zh/ja can't come from the pinned spec until F2 is fixed.

**FIX**
1. **Recommended.** Build the voice and language lists and the budgets from `catalog.json` (and the GGUF where it carries them). The curated files keep only what audio.cpp lacks: Kitten's genders and display names.
2. **Attack**
   - **Standard?** Yes, the specs' `ui.builtin_voices`, `languages` and `text_chunk_size` defaults.
   - Splitting a Kokoro id into language and gender is our code following Kokoro's naming, not a spec field.
   - VoxCPM2's spec lists "zh dialects" as a language entry. That is a description, not a language code, so whether and how to show it is an open question.
   - **Data risk:** stored voice ids carry our prefixes ("kitten_bella", "pocket_alba", against the spec's "Bella", "alba"). The id rule must stay.
   - **Blast radius:**
     - `kokoro/voices.js` (read by `kokoro/manifest.js` and `slot.js` VOICES);
     - `kitten/manifest.js`, `chatterbox/manifest.js`, `voxcpm2/manifest.js`, `asr/manifest.js`, the qwen3 manifest's language list;
     - `slot.js` (`FAMILY_BUDGET`, `CALIBRATION_AUDIO_S`);
     - `scripts/audiocpp-catalog.js`;
     - tests for each.
   - **Alternative:** none. It belongs in the 10-13 adoption plan.
3. **Surviving fix:** inside the 10-13 plan, after F2's spec edits. Keep the stored-id rule, and ask about "zh dialects".

---

## F11 — Kokoro sends US English for any language it doesn't know
**Verdict:** PARTLY · **Severity:** VISIBLE (API callers only)

**Evidence**
- The code is as described: `slot.js:815` falls back to "en-us".
- The fork refuses a voice/language mismatch at jv.5 (`kokoro_tts/frontend.cpp`, `resolve_language_code`).
- No approval of the fallback was found. Switch §3.4 gives only the mapping.
- **Narrower than the finding says.** The app's own screens never send a foreign language to a Kokoro voice:
  - the persona render path uses `personaLanguage` (`persona_render.js:219-226`), and a Kokoro voice speaks only its own language (`voice_model.js:271-274`);
  - auditions use the voice's own language (`voice_preview_api.js:489-498`).
- Reachable only through `/v1/render_chapter` direct lines (`ChapterLine.language`, `models.js:1334`) and the generate API (`generate_api.js:374`), meaning JustWrite, MCP and API callers.
- A known language on the wrong voice (for example "es" on an English voice) is refused by audio.cpp itself.

**Still stands:** an API line in a language Kokoro doesn't map is sent as "en-us". It reads with English phonemes on an English voice, and fails with audio.cpp's mismatch error on any other voice.

**FIX**
1. **Recommended.** When the line's language isn't in `KOKORO_LANGUAGE`, send no `language`. The spec says it then "defaults to the selected voice prefix".
2. **Attack**
   - **Standard?** Yes, that is audio.cpp's documented default (`kokoro_tts.json` request `language`).
   - A German line on an English voice would still be read in English, silently, now by audio.cpp's default instead of ours. Whether to refuse by name instead is the user's call, and the refusal wording would be new.
   - The blend path (`slot.js:827`) uses `req.language` to pick a preset and needs the voice's own language when `language` is omitted.
   - **Blast radius:** `slot.js` `toSpeechRequest` (Kokoro and blend branches), `server/tests/audiocpp_switch.test.js`, `kokoro_blends.test.js`, `variant_wiring.test.js`.
   - **Alternative:** refuse in `render_core` / `generate_api` when the line's language isn't one the voice speaks (`voiceModel.speaksLanguage`). That is broader and needs new wording.
3. **Surviving fix:** omit `language` on a miss, plus ask whether a mismatched API line should be refused by name.

---

## F12 — One unknown IPA symbol stops the whole Kokoro line
**Verdict:** CONFIRMED · **Severity:** VISIBLE

**Evidence**
- The approved words: "Single-word IPA from lexicons — fork: a text+IPA splice" (switch §5.3, under "you have a go for all gaps").
- The refusal comes from the implementer's gap-3 plan §3.1, written after that go. No user answer covers it.
- The fork's `require_kokoro_symbols` (42db68d9) refuses the line, as shown in gap-3 §5: "uses ʍ, which is not one of Kokoro's phoneme symbols".
- Nothing checks an entry's symbols when it is saved (grep found no Kokoro symbol check in `server/src`).
- `docs/lexicons.md` §"IPA entries reach the audio" doesn't mention the refusal.

**Still stands:** as the finding says. The refusal is unasked and undocumented for users.

**FIX**
1. **Recommended.** Ask the user to choose:
   - (a) refuse, as now;
   - (b) speak that one word through the G2P (or the entry's respelling) with a warning;
   - (c) warn when the entry is saved, by checking against the vocabulary in Kokoro's GGUF.
2. **Attack**
   - **Standard?** What upstream Kokoro (hexgrad) does with a symbol outside its vocabulary needs a web check before anything is called "standard". The fork comment says it chose to name the symbol rather than drop it silently.
   - (c) needs new code reading the GGUF's vocabulary file (`gguf_files.js` can read embedded files).
   - **New:** any warning text. Open question.
   - **Blast radius:**
     - `../audio.cpp/src/models/kokoro_tts/frontend.cpp` (`require_kokoro_symbols`);
     - `server/src/engines/kokoro/ipa.js`;
     - the lexicon API and `src/pages/LexiconsPage.vue`;
     - `docs/lexicons.md`;
     - `server/tests/kokoro_ipa.test.js`.
3. **Surviving fix:** the three-way question, with upstream's behaviour checked on the web first. Whichever is chosen, document it in `lexicons.md`.

---

## F13 — The Turbo/Nano converter was deleted, not moved as approved
**Verdict:** PARTLY · **Severity:** INTERNAL

**Evidence**
- Approved 2026-10-08 (TASKS:3559): "anything we added to the fork that runs Python moves to C++ or JS".
- Fork a1b68c33 deleted it instead. No decision records the deletion.
- **Overstated in the finding:** "can no longer be re-made". The file is in git history (`git show a1b68c33^:tools/community_models/chatterbox_turbo/convert_chatterbox_turbo.py`, added in 3865d245), so it can be restored without a port.
- Since 2026-10-11, tools may be Python with the user's say.
- Also found: `chatterbox/manifest.js:33-34` still names the deleted path as if it existed.

**Still stands:** it was deleted instead of moved, without a word. It is restorable from git, not lost.

**FIX**
1. **Recommended.** Restore it from git as a fork tool (Python is allowed for tools since 2026-10-11), with the user's word ("bring that choice to me"), and fix the stale comment.
2. **Attack**
   - **Standard?** Yes: audio.cpp's own converters are Python under `tools/` (for example `repack_chatterbox_turbo_gguf.py`), and the runtime installer already leaves `.py` out of the app.
   - **New:** nothing.
   - **Blast radius:** `../audio.cpp/tools/community_models/chatterbox_turbo/`, `docs/community_models/chatterbox_turbo.md`, `model_specs/chatterbox_turbo.json` (description), `server/src/engines/chatterbox/manifest.js:33-34`.
   - **Alternative:** a C++/JS port. More work, and no longer required.
3. **Surviving fix:** restore with the user's word, and fix the comment.

---

## F14 — Hardcoded values the family rule says belong in settings; some numbers were never shown
**Verdict:** PARTLY · **Severity:** INTERNAL

**Evidence**
- **The fork's join constexpr (`kokoro_tts/session.cpp:44-46`) has no effect on the app.** TASKS (2026-10-07) says "The app never uses the audio.cpp one": the host splits Kokoro at 240, which is audio.cpp's own budget. My inference: the only exception would be a line whose inline IPA markup pushes it past 240.
- `SILENCE_FILL_LSB` 2 was shown. The approved guard says "fills any stretch … with that inaudible noise", and the probe text before it named ±2 LSB.
- `CALIBRATION_AUDIO_S` is audio.cpp's own value, so it belongs under F10.
- **Confirmed and never shown:**
  - `VOICE_PACKS_KEPT` and `REFERENCES_KEPT` (200), `slot.js:128`;
  - `SILENCE_RUN_S` 0.01: it fills only runs of 10 ms or more, against the approved "any stretch";
  - `MIN_SAMPLING` 0.05;
  - the 3× transcription multiplier (`slot.js:662-693`).
- **Approved but hardcoded:** the join's 260 ms, −60 dBFS and 10 ms (`audio/chunked.js:36-40`). The family rule ("thresholds, limits … live in the database") applies to approved numbers too.

**Still stands:** the server join constants, the cache-retention counts, the silence-run minimum, the sampling floor and the 3× timeout are constants. 200, 10 ms, 0.05 and 3× were never shown, and 10 ms narrows the approved "any stretch".

**FIX**
1. **Recommended.** Seed these as settings through SettingsStore, the way 5f did for `gpu_threads` and the timeouts. Leave the fork constexpr as it is: it doesn't reach the app.
2. **Attack**
   - **Standard?** Yes: the family rule plus the SettingsStore pattern already used.
   - **New:** each setting's label, section and range. Open questions:
     - whether the silence-run minimum should be 0 ("any stretch") or a measured minimum;
     - whether a user would ever change the cache counts (the family rule's own test).
   - **Blast radius:**
     - `audio/chunked.js`, `audio/dsp_client.js` (sends the join parameters);
     - `slot.js` (`cfg`, `MIN_SAMPLING`, `_transcribeTimeout`);
     - the settings defaults and schema (`server/src/database/models_schema.js` and the seeded defaults), `src/pages/SettingsPage.vue`;
     - `docs/settings-reference.md`;
     - `server/tests/chunked.test.js`, `audit_step5.test.js`, `qwen3_reference_silence.test.js`.
   - **Alternative:** keep them as constants and show the user the list with each value. A smaller change, if the user rules they aren't user-tunable.
3. **Surviving fix:** show the list (value, where it is, whether it was shown). Ask setting-or-constant per item, and ask the 10 ms question outright.

---

## F15 — Linux NVIDIA machines get Vulkan; the release's Linux CUDA build is skipped
**Verdict:** REFUTED · **Severity:** INTERNAL

**Evidence**
- The approved line: "Linux and macOS archives the same way" (switch §3.1). That means acquiring whatever archives exist; it doesn't promise a Linux CUDA one.
- The only Linux CUDA job is upstream's `linux-cuda-colab` (release.yml:246-312 at jv.5; the fork's only change to that workflow is 342d2737, `audiocpp_dsp`). It:
  - builds only `audiocpp_server` — no `audiocpp_dsp`, which the server has needed since 2026-10-07, and no jieba or libmecab;
  - stages upstream's Python `tools/`;
  - is `continue-on-error`.
- So there was no usable archive to pick. The comment at `release.js:108-110` is accurate.

**Still stands:** none as a finding. Whether to add a full Linux CUDA bundle to our release is new scope, an idea for IDEAS.md.

---

## F16 — The switch's R1–R15 were decided after a go given before they existed
**Verdict:** PARTLY · **Severity:** INTERNAL

**Evidence**
- R3 (8-bit default) was later approved outright. 2026-10-02, gap 9 Q2: "keep 8-bit unless the test shows a real gap on an engine; any change comes back to you with its numbers", answered "your rec on all 3 go" (TASKS:4046-4050).
- R10 was replaced by the user's 10-04 word.
- R13 hides nothing. Cloud providers show on the tab's Online half (`SpeechEnginesTab.vue:793-800`) and self-hosted servers on the Local half (`:802`). R13 only removed a 404ing Install and a dead Device select from those rows.
- R1 and R2 were superseded by Q1 ("yes but not now") and the 10-13 fork ruling.
- R5 was superseded by the user-approved per-model Auto/GPU/CPU (10-02).
- R11 has no later approval anywhere. It removed the `url` override (`engine_sources_api.js` keeps only the repo swap).

**Still stands:** R11 (the URL override removed) was never put to the user.

**FIX**
1. **Recommended.** Put R11 to the user as a question: keep only the repo swap, or bring back a direct-URL source for a GGUF file?
2. **Attack:** no code until answered. A direct URL would bypass the pinned revision and the LFS sha check (5e), which is a trade-off to state. Blast radius if restored: `server/src/api/engine_sources_api.js`, `speech_cache.js` (`fetchHfVariant`), the sources UI.
3. **Surviving fix:** the question, with that trade-off.

---

## Seen in passing (not in the review)
- `capability_details.js:183-200`: the `chatterbox-multilingual` row carries VoiceDesign's notes ("Describe the voice in plain English … 1.7B only; there is no 0.6B VoiceDesign checkpoint."). If they reach a screen, users see the wrong text. Not traced.
- audio.cpp's own UI says Chatterbox's exaggeration and guidance take effect only after a model reload (`model_params.json`, "改动后需重新『加载模型』才生效"). The switch recorded them as "verified 2026-10-01 — no model reload". Worth a check.
