# Verdicts: engine-list.md (15 findings)

Method: I read every cited line. Counts come from read-only `node -e` runs that import `generated.js`. For HEAD (v0.9.0-jv.5) I swapped `CATALOG.families` in memory for `git show HEAD:catalog.json`. I ported audio.cpp's `installChoices` (webui/native/src/lib/catalog.ts at v0.9.0-jv.5 and at jv f7d83ffb) into a one-liner and compared its output per family. For approvals I searched TASKS, the plan, and `git log --all` since 2026-10-10. No repo file was touched.

Summary: 7 CONFIRMED (1, 4, 5, 7, 10, 12, 15; 7 is low priority), 7 PARTLY (2, 3, 6, 8, 9, 11, 14), 1 REFUTED (13). No finding is DATA severity.

---

## 1. Speech recognition families are never offered
**Verdict:** CONFIRMED. **Severity:** VISIBLE
**Evidence:**
- Three lines keep them out: `generated.js:173` (the family's tasks must include tts or clone), `:38` (`SPEECH_ENTRY_TASKS = {tts, clon}`) and `:338` (`KIND: "tts"`). `:170` `!clones(fam)` excludes them too.
- `variant_wiring.test.js:146-147` asserts that every generated engine is "tts".
- Plan §3: "Speech recognition families become `stt` engines the same way (transcription choices for dictation and read-back)."
- No deferral exists in TASKS, the plan or git log.
- Recount matches: 20 families have a downloadable `asr` entry at HEAD and 26 at v0.9.1, after leaving out the wip fun_asr_nano and the hand-wired qwen3_asr.
- The recorded clone-only FINDING doesn't cover this. Removing `!clones` still leaves `:173`, `:38` and `:338`.

**Surviving claim:** the approved plan's `stt` engines were never built. Only the hand-wired Qwen3-ASR 1.7B is offered.

**FIX**
1. Generate `stt` engines from `asr` catalog entries through the same generated path, with KIND set by the entry's task. Add a generic transcription request that sends the language in the form each spec lists, as `generatedSpeechRequest` does for speech.
2. Attack:
   - **Standard.** It uses audio.cpp's models_catalog.json entries (task `asr`), the spec's `options.request` and the existing generated path.
   - **New code.** A generic `_transcribe` mapping. Today `slot.js:620-635` sends Qwen3-ASR's language names (`ASR_LANGUAGE`).
   - **Breaks: word timings.** `slot.js` `_align` returns 501 for any recognizer without Qwen3's aligner companion. Both `align_api.js:35` (chapter captions) and `manager.js:2114` use whatever stt model is loaded.
   - **Possible break: diarizing recognizers** (MOSS Transcribe-Diarize, VibeVoice-ASR) may return speaker-tagged text where captures and read-back expect plain text. Unverified.
   - **Open questions:**
     - Is Qwen3-ASR still the default?
     - What do captions do on a recognizer that has no aligner?
     - Are the streaming entries (vibevoice_asr_streaming, voxtral_realtime) listed?
     - Does the "What for?" text change?
   - **Blast radius:**
     - server/src/engines/audiocpp/generated.js
     - server/src/engines/capability_details.js (the generated rows)
     - server/src/engines/audiocpp/slot.js (`_transcribe`, `_align`)
     - server/src/engines/manager.js:2089, :2114
     - server/src/api/captures_api.js:245
     - server/src/mcp/tools.js:144
     - server/src/api/align_api.js:35
     - src/components/SpeechEnginesTab.vue (the STT filter)
     - server/tests/variant_wiring.test.js:142-148
   - **Simpler alternative:** none. Listing the families without a request mapping would offer models that fail.
3. Surviving fix: item 1, after the user answers the default-recognizer and no-aligner questions.

---

## 2. Number settings without a range are dropped
**Verdict:** PARTLY. **Severity:** VISIBLE
**Evidence:**
- `generated.js:104` drops a number unless it has both a min and a max. `:101-116` drops every other type.
- Recount at v0.9.1 matches: 108 options dropped across 24 families. That is 104 numbers plus 4 path-typed options:
  - dots.tts `source_audio`
  - DramaBox `target_voice`
  - GLM `flow_noise_path`
  - GLM `hift_source_random_path`
- The per-family examples are correct: IndexTTS 2, OmniVoice, CosyVoice3 (Seed only), Higgs (Seed only), GLM (top_p only).
- No approval: plan §1 says "numbers as sliders", and §5's exclusion list doesn't include numbers without a range.
- This makes the finding stronger: 33 of the 104 appear in audio.cpp's own `webui/configs/model_params.json` as type "number", usually with a default (MOSS-TTSD temperature 1.5 and top_k 50; Audio8 max_tokens 1024). audio.cpp's web UI renders them as `<input type="number">`, so JustVoice shows less than audio.cpp's own UI.
- The weak part is the 4 path options. They are file paths on the server. `source_audio` and `target_voice` are clips the app would supply, and the GLM pair are parity noise files. Plan §5 excludes "voice, clip".

**Surviving claim:** 104 typed number options are dropped because they lack a range at both ends, and 33 of them are in audio.cpp's own UI.

**FIX**
1. Show a number with no full range as a number field (the kit's `UiNumber`), applying min or max where one is given.
2. Attack:
   - **Standard.** audio.cpp's model_params.json "number" type (159 params, 134 of them without a full range) and its web UI's number input. `UiNumber` is already in `DeliveryKnobs.vue` for the pauses. No new rule is needed.
   - **Open questions:**
     - What default does a field show when neither the spec nor model_params gives one? (See 12.)
     - Up to 10 more knobs per family arrive (Irodori). `KnobSpec.advanced` promises "hide behind a Show-advanced toggle" (models.js:1100), but no screen reads `advanced`. Is that fold built now?
   - **Blast radius:**
     - server/src/engines/audiocpp/generated.js `settingsOf`
     - server/src/models.js `KnobSpec` (min/max default to 0, so "no range" needs a way to be said)
     - src/components/DeliveryKnobs.vue
     - src/pages/PersonaEditorPage.vue (its own Sampling grid, about :1150-1170, renders UiSlider)
     - src/components/StudioRenderChapter.vue:515
     - server/src/line_takes.js `lineModels`
   - **Simpler alternative:** show only the 33 that audio.cpp's own UI shows. That is narrower than "everything" and needs the user's word.
3. Surviving fix: item 1 for all 104. Path options stay out because they are app-owned files.

---

## 3. Instruction options are hidden; ZipVoice's `lang` is never set
**Verdict:** PARTLY. **Severity:** VISIBLE
**Evidence:**
- `generated.js:56-59` `APP_OWNED_OPTIONS` hides these, `settingsOf` `:93` drops them, and `slot.js:1004` skips them in the request.
- The plan does not approve a global hide list. §5 excludes only "text, voice, clip, language, seed, the direction option, streaming and chunking", and §5's approved mechanism is per family: "our file can hide or rename one".
- Effect, family by family:
  - **Real loss on 3 families:** MOSS-TTSD `instruct` ("Free-text direction for the delivery"), MOSS-TTS v1.5 `instruct`, and OmniVoice `instruction`. audio.cpp's own web UI shows each of them as a text field (model_params.json `instruct`).
  - **No usable loss on the offered entries:**
    - FireRedTTS3: on a clone its code overwrites `instruction` with the transcript (RESEARCH §10.8).
    - FireRedAudio: `instruction` is "Voice design instruction".
    - dots.tts: `instruction` is for the Edit template.
    - Irodori: `instruction` works only on its caption checkpoints, which are the vdes entries of finding 5.
  - **ZipVoice `lang`:** never set, but the effect is small. audio.cpp's doc says `lang` is the "espeak voice for English segments" (docs/community_models/zipvoice.md:102). Chinese goes through the fixed Emilia frontend (`:97`), so the default en-us is upstream's own default. The reviewer's "map `lang` like `language`" would be wrong: it would pass "zh" as the espeak voice for English segments.
  - **Kitten TTS 2 `voice_id`:** belongs with the recorded preset-voice finding, as the reviewer says.

**Surviving claim:** the instruction options of MOSS-TTSD, MOSS-TTS v1.5 and OmniVoice can't be set anywhere, though audio.cpp's own UI offers each one. ZipVoice's `lang` is hidden too, which matters only for the accent of English segments.

**FIX**
1. Reviewer's fix: hide only the DIRECTION's option and show the rest.
2. Attack:
   - **"Show the rest" is unsafe.** It exposes `template_name`, whose values include asr, understand, edit and voice_design (FireRedAudio, FireRedTTS3, dots). Picking one would turn a speech line into transcription or an edit. It also exposes FireRed and dots `instruction`, which do nothing on the offered clone entries.
   - **Standard alternative:** show what audio.cpp's model_params.json shows: `instruct` as text for MOSS-TTSD, MOSS v1.5 and OmniVoice, and `lang` as text (default en-us) for ZipVoice.
   - **Better for the three `instruct` options:** a DIRECTION entry (kind "words") in each curated file, so a line's direction reaches the model. This is the plan's own §4 mechanism, but it is untested, so it goes to the user.
   - **Blast radius:**
     - server/src/engines/audiocpp/generated.js (`APP_OWNED_OPTIONS`, `settingsOf`)
     - server/src/engines/audiocpp/slot.js:1004
     - server/src/engines/audiocpp/curated/{moss_ttsd,moss_tts_v15,omnivoice,zipvoice}.js
     - server/src/engines/capability_details.js (`supports_instruct_freeform` follows DIRECTION)
     - server/tests/audiocpp_generated.test.js
3. Surviving fix:
   - The hide list covers only what the app sets for that family: its DIRECTION's and PLAIN's options, the language option it maps, and the clip and its words. `template_name` stays hidden.
   - The `instruct` and `lang` options that model_params.json shows become text settings.
   - Open question for the user: DIRECTION entries for MOSS-TTSD, MOSS v1.5 and OmniVoice, which are untested.

---

## 4. Generated models get no load-time (session) options
**Verdict:** CONFIRMED. **Severity:** VISIBLE (modest)
**Evidence:**
- `runtime_options.js:29` `OFFERED` holds qwen3_tts only. Nothing in server/src or scripts reads the spec's `options.session` (grep).
- Plan §5: "Session options (read at load) go on the model's row, as Qwen3's do today."
- Recount at v0.9.1: 166 spec session options across all 24 families (IndexTTS 13, VoxCPM1 15, MioTTS 15).
- Against the effect: audio.cpp's own web UI shows none of these families' session options. Its model_params.json marks `scope: "session"` only for auk, confucius4_r2t2 (ASR), liveavatar and yue2, 17 params in all. So this is an approved item that was never built, not something audio.cpp's own UI offers.

**Surviving claim:** the plan's session options on each model's row were never built for generated models.

**FIX**
1. Reviewer's fix: build `OFFERED` rows from each spec's `options.session`.
2. Attack:
   - **All 166 as they are would be unsafe.** They include file paths (`miotts.codec_model_path`, `best_of_n_asr_model_path`, ZipVoice's eSpeak paths, `vocos_path`) and about 70 graph-arena and weight-context sizes in MB. A wrong path breaks the load.
   - **Preset enums have no values.** Options typed by `preset` (`weight_type_full`, `weight_type_conv`) carry no values in catalog.json. The values are in audio.cpp's docs/maintainers/model_specs.md preset table, so the catalog script would have to carry them.
   - **The memory price would go stale.** Changing `weight_type` changes memory, but the measured price is keyed by model and runtime build, not by session options (manager.js has no runtime-options key). This is already true for Qwen3's Decoder weights.
   - **Precedent rule.** `runtime_options.js:7` says "Only options whose effect was measured are offered". I found no approval of that rule against the audit's batch "5h exposing every option" (TASKS, around :4990). Open question.
   - **Blast radius:**
     - server/src/engines/audiocpp/runtime_options.js
     - server/src/api/models_api.js:82, :121-151
     - server/src/engines/audiocpp/slot.js:275
     - scripts/audiocpp-catalog.js
     - server/src/engines/manager.js (the price keys)
     - src/components/SpeechEnginesTab.vue (the row's options)
   - **Standard alternative:** audio.cpp's own UI rule (model_params.json `scope: "session"`), which offers none for these families today.
3. Surviving fix: a plan item for the user, not a build. Offer each family's typed session options, with the preset values carried into catalog.json and path options excluded. Open questions: whether arena-size options and unmeasured options are shown, and whether the memory price is keyed on the weight options.

---

## 5. Voice-design entries are dropped even in families that appear
**Verdict:** CONFIRMED. **Severity:** VISIBLE
**Evidence:**
- `generated.js:38` `SPEECH_ENTRY_TASKS = {tts, clon}` and `:176` skips every other task.
- The header at `:14-15` ("Built-in voices and voice design need a family file … and come later") has no user word behind it. I searched TASKS, the plan and git log.
- Plan §3: "A model (variant) per catalog entry — its package × task (Breeze: design and clone)" and "`design: voice_design` → makes one from words".
- Recount matches. The dropped vdes entries:
  - Breeze TTS 2 (`breeze-tts`)
  - FireRedTTS3 (`fireredtts3-instruct-vdesign`)
  - FireRedAudio (`firered-audio-vdesign`)
  - Irodori (`irodori-tts-v3-vdesign`, `irodori-tts-vdesign`). The 600M VoiceDesign package (1.2 GB Q8, 1.4 GB F16) is never offered at all.
- Overlap with the recorded clone-only FINDING: it names `voice_design: false` hard-coded, but not this entry filter. They should be fixed together.

**Surviving claim:** as the finding states.

**FIX**
1. Offer each `vdes` entry as a design row (`supports_voice_design`). How a description reaches each family goes in its curated file as data.
2. Attack:
   - **Standard.** audio.cpp's catalog task `vdes` (its own label: "Voice design"). The curated file is the plan's approved place for what a spec can't say.
   - **New per-family request data:**
     - FireRedTTS3 and FireRedAudio: `template_name: voice_design` + `instruction`
     - Breeze: `instruction` without a clip
     - Irodori: `instruction` on its caption checkpoint
   - **Blocker:** `slot.js:995-997` refuses any voice with no clip. That is the recorded finding.
   - **Open question:** how a generated designed voice is kept, as a frozen clip or as its description (the 2026-08-22 "both designed paths" ruling).
   - **Blast radius:**
     - server/src/engines/audiocpp/generated.js
     - server/src/engines/capability_details.js
     - server/src/engines/audiocpp/slot.js
     - server/src/engines/audiocpp/curated/{breeze_tts,fireredtts3,firered_audio,irodori_tts}.js
     - src/components/PersonaDesignMaker.vue
     - server/src/api/voices_api.js (`/v1/voices/design`)
     - server/src/voice_model.js
3. Surviving fix: build it in the adoption plan together with the clone-only finding. How a designed voice is kept goes to the user as a question.

---

## 6. Fewer packages than audio.cpp's web UI offers; the missing 16-bit row
**Verdict:** PARTLY. **Severity:** VISIBLE
**Evidence:**
- `scripts/audiocpp-catalog.js:80-116` ports only `relatedPackages` and `preferredPackage`, though its comment says "audio.cpp's own web UI rule, ported as it is".
- My port of `installChoices`, compared per family:
  - **Offered by audio.cpp's UI, missing from ours:**
    - MOSS-TTSD Q4_K (9.5 GB) and BF16 (18.9 GB): moss_ttsd is on its special-stem list.
    - CosyVoice3 F32 (6.5 GB) and Irodori v4.1 Anime Q8 (1.0 GB): both are expose-all families.
    - Breeze TTS 2 Q4_0 (3.5 GB), at v0.9.1 only.
  - **Wrong in the finding:**
    - audio.cpp's UI does **not** offer MOSS-TTS v1.5 Q4_K or BF16. Its rule yields Q8 only, because moss_tts_v15 is on neither list.
    - It does not offer ZipVoice Q8_0 either. Its rule yields only the original-precision package.
    - `generated.js:182-189`'s stem filter drops nothing at either catalog (computed).
  - **We already offer rows audio.cpp's UI doesn't:** IndexTTS 2 and 2.5 original precision, MioTTS original precision, and OmniVoice bf16 beside f16. Its rule picks Q8 plus one 16-bit.
- The plan's "the spec's 16-bit package as a '16-bit' row where one exists" is not met for MOSS-TTS v1.5 BF16 and MOSS-TTSD BF16.

**Surviving claim:** the script drops 5 packages that audio.cpp's own UI offers (MOSS-TTSD Q4_K and BF16, CosyVoice3 F32, Irodori Anime Q8, and Breeze Q4_0 at v0.9.1). The plan's 16-bit row is missing for MOSS-TTS v1.5 and MOSS-TTSD.

**FIX**
1. Reviewer's fix: port `installChoices` and add every GGUF package in an entry's folder.
2. Attack:
   - **Porting as-is narrows.** It removes rows we offer today (IndexTTS 2 and 2.5 orig, MioTTS orig, OmniVoice bf16), which goes against "adopt everything".
   - **Name collision.** Irodori Anime Q8 would collide with v4 Small Q8: the variant id is model plus precision tail (`generated.js:263`), so both become "-q8". audio.cpp names it with its own `packageLabel` ("Anime Q8", catalog.ts), which is the standard to adopt.
   - **Not backed by audio.cpp's UI.** MOSS-TTS v1.5 Q4_K and ZipVoice Q8_0 come from neither audio.cpp's UI nor the plan (v1.5 BF16 is backed by the plan). Open question.
   - **Blast radius:**
     - scripts/audiocpp-catalog.js
     - server/src/engines/audiocpp/catalog.json (regenerated)
     - server/src/engines/audiocpp/generated.js (`generatedModels` :175-198, `variantRow` naming :256-264, `PRECISION_TAIL` and `PRECISION_WORDS`)
     - src/components/SpeechEnginesTab.vue
   - **Simpler alternative:** every complete GGUF package in the entry's target folder. This is a rule of ours.
3. Surviving fix:
   - Port `installChoices`' extra cases (the expose-all families, the special-stem list, and `packageLabel` for names) as additions to today's rows. No row is removed.
   - Add MOSS-TTS v1.5 BF16 and MOSS-TTSD BF16 as the plan's 16-bit rows.
   - Ask the user about MOSS-TTS v1.5 Q4_K and ZipVoice Q8_0.

---

## 7. F5-TTS (Habibi, Arabic dialects) never appears
**Verdict:** CONFIRMED (low priority). **Severity:** VISIBLE
**Evidence:**
- f5_tts is community status, clones, speaks en and ar, and has 9 complete GGUF packages including the vocos vocoder.
- It has no entry in audio.cpp's webui/configs/models_catalog.json at either ref, so `generated.js:175` finds nothing to offer.
- No user word covers this. "A model per catalog entry" is the implementer's design, and the plan never names this case.
- Against the effect: audio.cpp's own web UI doesn't list F5 either. Also, F5 needs session options (`vocos_path`, `dialect`).
- The same class, not in the finding: VoiceTut-TTS (omnivoice family), dots.tts Edit, and QwenCleo ASR (v0.9.1) also have no catalog entry.

**Surviving claim:** spec packages with no catalog entry never appear: F5-TTS, VoiceTut-TTS, dots.tts Edit and QwenCleo.

**FIX**
1. Reviewer's fix: make a model from a family's default package when it has no entry.
2. Attack:
   - **This is a rule of ours** beyond audio.cpp's catalog.
   - **F5's default package won't load alone.** It needs `f5_tts.vocos_path` pointing at the vocoder package (as MioTTS's codec does through SESSION_FILES) and a `dialect`.
   - **Standard alternative.** Under the user's 2026-10-13 ruling ("what our fork adds in our fork's own specs"), add catalog entries to our fork's models_catalog.json, so the generated path takes F5 unchanged. The vocoder goes through curated SESSION_FILES.
   - **Blast radius:**
     - ../audio.cpp/webui/configs/models_catalog.json
     - scripts/audiocpp-catalog.js (re-run)
     - catalog.json
     - a new curated/f5_tts.js (licence: CC-BY-NC)
     - docs/engines.md
3. Surviving fix: catalog entries in our fork, with the vocoder as SESSION_FILES. Open question: one entry per dialect, or one entry with a dialect setting?

---

## 8. "Can't be directed yet" never reaches the screen; two models labelled "written direction"
**Verdict:** PARTLY. **Severity:** VISIBLE
**Evidence:**
- **The code does what the finding says:**
  - `capability_details.js:416` writes the "can't be directed yet" note, and nothing in src/ reads capability `notes`.
  - `voice_model.js:149-155` makes those models "sliders only".
  - `:410` sets `supports_instruct_freeform` for any DIRECTION. So CosyVoice3 (kind "phrases") and Higgs (kind "prefix", no words) show "✓ written direction", while `applyDirection` drops their words.
  - `persona_render.js:88` offers all nine emotions.
- **Refuted part:** the approved mock (cdb332f, speechEnginesMock.js) showed OmniVoice and MOSS-TTSD as "sliders" and CosyVoice3 and Higgs as "words". The user approved it: "1. Is the mock OK? If so, go to build the real tab." → "your rec on all go" (TASKS "Speech engines: the real tab…").
- **Recount:** CosyVoice3 acts on 5 emotions and Higgs on 7. Fish maps all 8 emotions other than neutral, and takes words too, so the finding's "Fish 8" is not a gap.

**Surviving claim:**
- CosyVoice3 and Higgs silently drop a line's written direction and some emotions: CosyVoice3 drops fearful, sarcastic and contemptuous, and Higgs drops sarcastic. Yet the persona page offers all nine emotions and the Style Instructions field.
- docs/engines.md:311 claims a "Can't be directed yet" marker that the screen doesn't show.
- The approved mock showed the "written direction" label, but not that the words are dropped.

**FIX**
1. Proposed fix:
   - Emotion choices for a generated model become the emotions its DIRECTION maps, or all nine when it takes words.
   - "words" applies only when the DIRECTION carries words.
   - The doc line is corrected to match the approved screen.
2. Attack:
   - **Standard.** It uses the app's existing words/tags/sliders values and the DIRECTION keys, which are data we already have.
   - **Rejected alternative.** InlineTagSet `value_map` would compile a tag into the text (`render_core _applyEmotionTag`), which is wrong for CosyVoice3's option-carried phrase.
   - **New label.** An emotion-only family needs a chip word, such as "✓ 5 emotions". That is an open question, and it changes the approved mock's "✓ written direction", so it needs the user's word.
   - **Blast radius:**
     - server/src/engines/capability_details.js
     - server/src/persona_render.js:83-90
     - server/src/voice_model.js:149-155
     - src/services/personaFacts.js
     - src/pages/PersonaEditorPage.vue
     - src/pages/VoicesPage.vue, PersonasPage.vue (the direction filters)
     - src/components/SpeechEnginesTab.vue:553
     - src/services/mock/speechEnginesMock.js
     - docs/engines.md:311
3. Surviving fix: emotion choices come from the DIRECTION's keys (no new wording), and the doc line becomes "sliders only". The chip word for emotion-only families goes to the user.

---

## 9. Round 3's direction mapping was replaced, not carried over
**Verdict:** PARTLY. **Severity:** VISIBLE
**Evidence:**
- **Round 3 sent the words** (test branch 1b5bff4, slot.js): CosyVoice3 as `template_name: instruct` + `instruction`, and IndexTTS as `use_emotion_text` + `emotion_text`.
- **Now:**
  - `curated/cosyvoice3.js:10-23` sends one of 5 documented sentences.
  - `curated/index_tts2.js:10-25` sends an emotion vector at alpha 0.65 for 5 emotions, and words only when the emotion has no vector.
- **The plan names the old mapping.** Plan §4 gives "`instruction` + `template_name: instruct` for CosyVoice3; `emotion_text` + `use_emotion_text` for IndexTTS", and says "Round 3's … branches … become data in their files".
- **Partial cover:** §4 also says "The wording each takes is being checked against the authors' own docs … its findings land in these files". CosyVoice3's change is wording on the same option, so it is roughly covered. IndexTTS's switch to a vector changes the mechanism, not the wording, so it is not covered.
- **TASKS is out of date.** "Check our direction…" says BUILT "nothing yet", and round 3's OPEN still says "carrying the branch's direction mapping".
- **The hover is out of date.** IndexTTS's TESTED hover reads "Acted 12 of 21 … with directions in words". The file's own comment says the vector mapping "is not yet tested".
- Breeze's guidance 4 and Higgs's tags are the authors' documented values (README, PROMPTING.md), not invented ones, but the user never saw them.

**Surviving claim:** IndexTTS 2's tested words mapping (12 of 21) was replaced by an untested vector mapping without the user's word, and its hover still describes the old mapping. CosyVoice3 now drops all free direction in favour of 5 documented sentences.

**FIX**
1. Ask the user to choose:
   - (A) round 3's tested words mapping, which is the plan's named example;
   - (B) the authors' documented mapping, marked untested;
   - (C) both.
2. Attack:
   - (A) uses the plan's own words.
   - (B)'s numbers are untested here, and each is an open question: alpha 0.65, vector weights 0.7–0.8, Breeze guidance 4.
   - (C) is a rule of ours.
   - Whatever the choice, the hover must not claim a result for a mapping that isn't sent.
   - **Blast radius:**
     - curated/{index_tts2,cosyvoice3}.js
     - generated.js `applyDirection`
     - slot.js `generatedSpeechRequest`
     - server/tests/audiocpp_generated.test.js
     - docs/engines.md (about :416)
     - TASKS (round 3 and "Check our direction…")
3. Surviving fix: record a FINDING with A, B and C for the user. Until then, IndexTTS's TESTED note says which mapping scored 12 of 21 and that the current one is untested.

---

## 10. The language wording is half done
**Verdict:** CONFIRMED. **Severity:** VISIBLE
**Evidence:**
- **dots.tts:** `generated.js:43` strips "multilingual" and `:208` matches only "N+ languages". `speaks()` returns 0 languages and no note for dots.tts, so `langText` returns "" and no chip shows.
- **Audio8 TTS:** shows 12, because it counts "auto" as a language.
- **Approved words:** "show audio.cpp's own wording … whenever its list is a description rather than language codes". The WHY was "a wrong language count".
- **Not in the finding:** FireRedTTS3 shows "45 languages", which is 24 language names plus 21 Chinese dialect tags (ZH_*).

**Surviving claim:** as the finding states.

**FIX**
1. Show "multilingual" as audio.cpp words it, and drop "auto" from the language list.
2. Attack:
   - **Standard.** This is the approved rule itself.
   - **Side benefit.** "auto" also appears as a language choice in the clone maker (`PersonaCloneMaker.vue` `languageOptions`) and in the language filters, and the fix removes it there too. Audio8 sends no language option, so its request doesn't change.
   - **Open questions:** the chip's casing for "multilingual", and whether FireRedTTS3's dialect tags count as languages.
   - **Blast radius:**
     - generated.js (`NOT_LANGUAGES`, `speaks`, `variantRow`)
     - src/components/SpeechEnginesTab.vue (`langText`, `langTitle`)
     - src/components/PersonaCloneMaker.vue
     - server/src/voice_model.js `modelSpeaks`
     - server/tests/audiocpp_generated.test.js
3. Surviving fix: item 1. The dialect count is asked separately.

---

## 11. The clone maker hides the clip's-words field
**Verdict:** PARTLY. **Severity:** VISIBLE (committed catalog only)
**Evidence:**
- The field and the request use different tests:
  - `capability_details.js:409`: `supports_clone_prompt_text: opts.has("reference_text")`
  - `slot.js:1016`: sends the words when `!listed || has("reference_text")`
  - `PersonaCloneMaker.vue:336` hides "What's said in the recording" when the flag is false.
- **Approved words:** "Send the clip's words to models whose spec lists no options".
- **At HEAD the claim holds.** Six families are affected: OmniVoice, Higgs, MioTTS, MOSS-TTS Local, MOSS-TTS Nano and IndexTTS 2.
- **At v0.9.1 there is no mismatch.** Every generated family lists its options, so the field and the request agree. The reviewer's v0.9.1 list (MioTTS, MOSS-TTS Local, IndexTTS 2) is wrong: those families now list options without `reference_text`, so the field is hidden and the words aren't sent.
- A capture's transcript still reaches the request when the field is hidden (`:150`, `:227`). `/v1/voices/clone` doesn't transcribe the clip itself.

**Surviving claim:** in committed code, an OmniVoice clone made from a file or the microphone can't be given the clip's words. Committing the v0.9.1 catalog ends the effect, but the two rules stay out of step.

**FIX**
1. Change `:409` to `supports_clone_prompt_text: !listsOptions(m.family) || opts.has("reference_text")`.
2. Attack:
   - **Standard.** It mirrors the approved rule exactly as `slot.js:1016` implements it. No new wording.
   - **Readers of the flag:** PersonaCloneMaker.vue:336, src/services/voiceMakers.js, engines_api.js:124 (VoxCPM2 only), voice_model.js, persona_render.js.
   - **Simpler alternative:** commit slice 6's catalog. That removes today's effect but leaves the rules out of step.
3. Surviving fix: the one-line change in item 1.

---

## 12. Defaults the code invents
**Verdict:** CONFIRMED. **Severity:** VISIBLE (shown on screen, not sent unless the user moves it)
**Evidence:**
- `generated.js:106`: `Number(o.default ?? p.default ?? min)`.
- Recount matches:
  - Echo TTS `max_duration_sec` shows 0.05.
  - Kitten TTS 2 shows top_p 0.000001, min_p 0 and max_tokens 1.
- More invented values:
  - MioTTS `do_sample` and `best_of_n_enabled` show "off" (`:113`).
  - MioTTS `best_of_n_language` shows its first choice, "auto" (`:110`).
- Not sent: the screen shows `k.default` (PersonaEditorPage.vue:613-616), reset deletes the value (`:622`), and the request carries only saved values.
- The ↺ title (`:1162`) reads "Back to the model default (0.05)", a false claim, and dragging starts from that point.
- No approval covers this.

**Surviving claim:** as the finding states. The effect is on screen only.

**FIX**
1. Reviewer's fix: leave the default empty, meaning audio.cpp's own.
2. Attack:
   - **Schema change.** `KnobSpec.default` is required (models.js:1096).
   - **A slider can't rest on "no value",** so this needs finding 2's number field with a placeholder.
   - **New wording.** The ↺ title prints the number, so its wording for "audio.cpp's own default" is an open question.
   - **Standard sources** stay as they are: the spec's default, then model_params.json's.
   - **Blast radius:**
     - generated.js `settingsOf`
     - models.js `KnobSpec`
     - PersonaEditorPage.vue:613, :1162
     - StudioRenderChapter.vue:515
     - DeliveryKnobs.vue `shown` and `raw`
     - line_takes.js `lineModels`
3. Surviving fix: a setting with no default in the spec or model_params is shown unset (a number field, or a switch or choice with nothing selected). The placeholder and ↺ wording go to the user.

---

## 13. The "not tested" hover makes a claim nobody approved
**Verdict:** REFUTED. **Severity:** none
**Evidence:**
- The exact words "Works as audio.cpp describes it; JustVoice hasn't listened to it yet" were in the mock the user approved (cdb332f MockSpeechEnginesPage.vue:145). The approval: "1. Is the mock OK? If so, go to build the real tab." → "your rec on all go".
- The three models the download test contradicted (VieNeu, AuK, OuteTTS) are hidden now.
- What's left over is not a finding of this review's kind. The claim is unverified for the listed models that were never loaded (MOSS-TTS v1.5, MOSS-TTSD, FireRedAudio, DramaBox), and docs/engines.md:306 repeats it.

---

## 14. Skipping the hand-wired families drops models their manifests don't carry
**Verdict:** PARTLY. **Severity:** VISIBLE
**Evidence:**
- `generated.js:31-35`, `:170`.
- Recount: four models are in no manifest:
  - Qwen3-ASR 0.6B Q8 (1.1 GB) and F16 (1.8 GB), which have a catalog entry
  - Qwen3-TTS 1.7B Base original precision (4.2 GB)
  - VoxCPM2 original precision (4.6 GB)
- QwenCleo ASR (v0.9.1) has no catalog entry, so it belongs to finding 7's class.
- This is already recorded in substance in TASKS "Adopt everything…" (2026-10-13): its WHY says "the seven hand-wired engines sit outside audio.cpp's specs", and its OPEN 2 says "the seven hand-wired engines on the same path".

**Surviving claim:** these models aren't offered. Treat that as a list to carry into the adoption plan, not as a new finding.

**FIX:** carry the list into the adoption plan's hand-wired item. Its blast radius is that item's own: server/src/engines/{asr,qwen3,voxcpm2}/manifest.js and generated.js `HAND_WIRED_FAMILIES`.

---

## 15. IndexTTS 2 offers `text` as a setting
**Verdict:** CONFIRMED. **Severity:** VISIBLE
**Evidence:**
- `APP_OWNED_OPTIONS` (`generated.js:56-59`) lacks "text". IndexTTS 2's settings at v0.9.1 include "text" ("Fallback target text…"), and a saved value is sent (`slot.js:1003-1008`).
- Plan §5 excludes text.
- The same class, not in the finding:
  - VoxCPM1 `prompt_text`: its spec makes `reference_text` an alias of it, so this is the clip's words, which the app already sets.
  - MOSS-TTSD `voice_samples` and Fish and Audio8 `multi_reference_cond`: server file paths for WAVs, offered as free text.
  - dots.tts `source_text` and `target_text`: Edit template only.
  - Irodori `no_ref`: a switch that shows "on". Its spec says "default true unless a speaker reference is provided", so saving it on would force no-reference generation on a clone.

**Surviving claim:** `text` is offered though the plan excludes it. Several app-owned aliases, edit-only options and path options are offered the same way.

**FIX**
1. Add "text" to the excluded set, and hide the others.
2. Attack:
   - **Standard for two of them.** "text" is in the plan's own list, and `prompt_text` is the spec's alias of `reference_text`.
   - **The rest are new exclusions of ours.** They go through the plan's approved mechanism ("our file can hide or rename one"), one family file at a time, and each is named for the user.
   - **Blast radius:**
     - generated.js
     - slot.js:1004
     - curated/{voxcpm1,moss_ttsd,fish_audio,audio8_tts,dots_tts,irodori_tts}.js
     - server/tests/audiocpp_generated.test.js
3. Surviving fix: "text" and "prompt_text" go into the excluded set now. The others are hidden in each family's file once the user has seen the list.

---

## Seen while checking, not in the list
- **MOSS-TTS v1.5 and MOSS-TTSD are sent the language as a code ("en").** Their spec says "Full language name; the model does not understand codes like 'en'", but it has no enum and no capitalized default, so `slot.js:1033-1034` sends the code. audio.cpp's model_params.json gives MOSS v1.5 the choices "", "English" and "Chinese". Neither model was loaded in the download test.
- **ZipVoice's eSpeak paths are never set (unverified).** They are session options, and `slot.js` `ESPEAK_SESSION_FAMILIES` holds only kitten_tts. ZipVoice spoke on this machine. It is unverified on a machine without a system eSpeak NG.
