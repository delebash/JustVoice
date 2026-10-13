# Review: the engine list and the Speech engines screen (2026-10-11 to 2026-10-13)

Method: I read each line cited below. Counts come from running generated.js read-only against the working-tree `catalog.json` (slice 6, v0.9.1, uncommitted) unless a line says "committed" (HEAD, v0.9.0-jv.5). The analysis scripts are throwaway files in the scratchpad. No repo file was touched.

## 1. Findings

**1. Speech recognition families are never offered.**
(a) Plan §3. (b) "Speech recognition families become `stt` engines the same way (transcription choices for dictation and read-back)." (c) `server/src/engines/audiocpp/generated.js:173` does `if (!(fam.tasks || []).some((t) => t === "tts" || t === "clone")) continue;`, `:338` sets `KIND: "tts"`, and `server/tests/variant_wiring.test.js:147` asserts every generated engine is `tts`. (d) Only the hand-wired Qwen3-ASR 1.7B appears. 20 recognition families with a downloadable entry never appear in the committed catalog, 26 at v0.9.1: Canary, Citrinet, Cohere, Confucius4-R2T2, FireRedAudio's ASR, GigaAM, Granite, Higgs STT, Hviske, Kroko, Moonshine, MOSS Transcribe-Diarize, Nemotron, Niagara, Parakeet, Samsone, SenseVoice, VibeVoice-ASR (two), Voxtral Realtime; plus Audio Flamingo, CrisperWhisper, IndexEcho, LFM2.5, OWSM and OWSM-CTC at v0.9.1. Nothing in TASKS defers this. (e) Sure: read the lines and counted from the catalog. (f) Generate `stt` engines from the `asr` entries the same way.

**2. Number settings without a range are dropped.**
(a) Plan §1 and §5. (b) "Its settings come from its spec — numbers as sliders, choices as dropdowns, on/off as a switch"; "Shown: the spec's request options minus the ones the app sets itself (text, voice, clip, language, seed, the direction option, streaming and chunking)". (c) `generated.js:104` does `if (min == null || max == null || !(max > min)) continue;`. Any type other than number, enum, bool or string is dropped at `:101-116`. (d) 104 options are gone across the 24 families. Typical ones: top_k, max_tokens, num_inference_steps. IndexTTS 2 loses temperature, top_p, num_beams, repetition_penalty and interval_silence_ms. OmniVoice loses its steps and duration. As a result, CosyVoice3 and Higgs Audio 3 offer no settings except Seed, and GLM-TTS offers only top_p. 4 file-path options are dropped too: dots.tts `source_audio`, DramaBox `target_voice`, GLM's two noise paths. (e) Sure on the code; counted with settingsOf. (f) Show a number without a range as a number field, or take the range from audio.cpp's web UI.

**3. A family without a direction file loses its own instruction field, and ZipVoice's language is never set.**
(a) Plan §5 and §1. (b) Excluded are only "the direction option"; a model without a direction file "is offered but marked can't be directed yet". (c) `generated.js:56-59` `APP_OWNED_OPTIONS` (instruct, instruction, template_name, emotion_*, voice_id, lang …) is hidden in settingsOf (`:93`) and skipped in the request (`slot.js:1004`). Only a family's `DIRECTION` can set these, and slot only sets `language` (`slot.js:1024`), never `lang`. (d) These models' instruction can't be reached at all, not even by hand:
- dots.tts: instruction, instruct, template_name
- FireRedAudio and FireRedTTS3, including the *Instruct* model: instruction, template_name
- Irodori: instruction
- MOSS-TTS v1.5 and MOSS-TTSD: instruct
- OmniVoice: instruction
- ZipVoice: `lang`, which nobody ever sets

Kitten TTS 2's `voice_id` (its preset voice) is hidden the same way; that belongs with the recorded preset-voice finding. (e) Sure on the code. That the plan's "the direction option" means only a family's chosen direction option is my reading. (f) Hide only the option a family's DIRECTION uses; show the rest as settings; map `lang` like `language`.

**4. Generated models get no load-time (session) options.**
(a) Plan §5. (b) "Session options (read at load) go on the model's row, as Qwen3's do today (`engines/audiocpp/runtime_options.js`)." (c) `server/src/engines/audiocpp/runtime_options.js:29` `export const OFFERED = { qwen3_tts: [...] }` is the only source. The spec's `options.session` is never read (grep: no reader). (d) None of the 24 families' session options reach the row: weight_type, mem_saver, attention, perf_mode, reference_cache_slots and others. (e) Sure. (f) Build `OFFERED` rows from each spec's `options.session`.

**5. Voice-design entries are dropped even in families that do appear.**
(a) Plan §1 and §3. This sits next to the recorded clone-only finding but is a separate line. (b) "makes a voice from words"; "A model (variant) per catalog entry — its package × task (Breeze: design and clone)". (c) `generated.js:38` `SPEECH_ENTRY_TASKS = new Set(["tts", "clon"])` and `:176` `if (!SPEECH_ENTRY_TASKS.has(e.task)) continue;`. The header at `:14-15` says "Built-in voices and voice design need a family file … and come later", a deferral nobody approved. (d) Never offered:
- Breeze TTS 2's design entry
- FireRedTTS3 Instruct design
- FireRedAudio design
- Irodori v4 design
- Irodori 600M v3 VoiceDesign, a separate 1.2 GB model that never appears at all

(e) Sure; enumerated from the catalog. (f) Add `vdes` entries as design rows in the adoption plan.

**6. Fewer packages than audio.cpp's own web UI offers, and a 16-bit row the plan promised.**
(a) Plan §3, and the GO "access to all engines and all models". (b) "plus the spec's 16-bit package as a '16-bit' row where one exists". (c) `scripts/audiocpp-catalog.js:80-116` ports only `relatedPackages`, while its comment says "audio.cpp's own web UI rule, ported as it is". audio.cpp's `installChoices` at the pinned tag (`webui/native/src/lib/catalog.ts:255-345`) also offers every GGUF in an "expose-all" family's folder (breeze_tts, cosyvoice3, irodori_tts …) and uses a wider stem rule for moss_ttsd. On top of that, `generated.js:182-189` keeps only the preferred package's stem. (d) Never offered:
- MOSS-TTSD Q4_K (9.5 GB) and BF16 (18.9 GB)
- MOSS-TTS v1.5 Q4_K (8.6 GB) and BF16 (19.1 GB). The BF16 is the plan's 16-bit row.
- CosyVoice3 F32 (6.5 GB)
- Irodori-TTS v4.1 Anime Q8 (1.0 GB, a different model)
- Breeze TTS 2 Q4_0 (3.5 GB, v0.9.1)
- ZipVoice Q8_0

The two Q4_K files are the only MOSS v1.5 and MOSS-TTSD downloads near an 8 GB card. The download test recorded both as too big at Q8. (e) Sure: read both files and compared the catalog. (f) Port `installChoices` (expose-all and the special stems) and add every GGUF package of an entry's folder.

**7. F5-TTS (Habibi, Arabic dialects) never appears.**
(a) Plan §3. (b) "Entries with no download (`download_id` absent, 9 of 144) … are left out." (c) `generated.js:175` loops over `fam.entries`. f5_tts has 9 GGUF packages, is community status and clones, but audio.cpp's web catalog gives it no entry, so `runnable` stays empty. (d) A whole cloning family is missing, and the plan never names this case. (e) Unsure whether the plan's "one model per catalog entry" was meant to cover it. (f) Make a model from a family's default package when it has no catalog entry.

**8. "Can't be directed yet" never reaches the screen, and two models are labelled "written direction" while their words are dropped.**
(a) Plan §1. (b) "A model without it is offered but marked **can't be directed yet**." (c) Several pieces:
- `capability_details.js:416` writes that note, but nothing in `src/` renders capability `notes` (grep).
- The tab's chip comes from `voice_model.js:149-155` `directedBy` through `personaFacts.js:53-55`, which shows "SLIDERS ONLY" ("Pace, pitch and gain — no words, no tags").
- `capability_details.js:410` sets `supports_instruct_freeform` for any DIRECTION, so CosyVoice3 and Higgs show "✓ WRITTEN DIRECTION" ("Describe how it speaks, in words"). Their files send emotion only and drop the words.
- `persona_render.js:88` offers all nine emotions for them, though CosyVoice3 takes 5, Higgs 7 and Fish 8.

(d) `docs/engines.md:311` says "the others say *Can't be directed yet*", which isn't true on screen. (e) Unsure: the mock the user approved showed these same chips (`src/services/mock/speechEnginesMock.js:58,68,80`). (f) Add the "can't be directed yet" marker; give emotion-only families a label that says so.

**9. Round 3's direction mapping was replaced, not carried over.**
(a) TASKS "Slice 0, round 3" OPEN and plan §4. (b) "both come in through the engine list …, carrying the branch's direction mapping"; "Round 3's CosyVoice3 and IndexTTS branches (test branch 1b5bff4) become data in their files". The plan also says "its findings land in these files". (c) Each family file chose its own mapping:
- `curated/cosyvoice3.js:10-23` sends only 5 fixed sentences and drops all direction words. Round 3 sent the words and scored 4 of 21.
- `curated/index_tts2.js:10-25` sends a vector at 0.65 for 5 emotions and drops the words whenever the emotion has a vector. Round 3 sent words at 1.0 and scored 12 of 21.
- `breeze_tts.js:12` raises guidance to 4 on a directed line.
- `higgs_audio_tts.js` sends nothing for sarcastic and no words.

(d) These are untested numbers and narrowings from authors' docs. Both TESTED notes still cite the old mapping's scores, and TASKS "Check our direction…" says BUILT "nothing yet". Nothing in TASKS records this change. (e) Unsure: the plan's "findings land in these files" may cover it. (f) Ask the user. Keep words as a fallback where the old mapping scored.

**10. The language wording is half done.**
(a) TASKS "Speech engines: the real tab…". (b) "show audio.cpp's own wording ('100+ languages') whenever its list is a description rather than language codes". (c) `generated.js:43` `NOT_LANGUAGES` strips "multilingual"; `:208` matches only `N+ languages`. (d) dots.tts (`["multilingual"]`) shows no language chip at all. Audio8 TTS counts "auto" as a language (12 for 11). (e) Sure. (f) Show "multilingual" as worded; drop "auto" from the count.

**11. The clone maker hides the clip's-words field for the families that now get the words.**
(a) TASKS "The download test's last findings", item 1. (b) "Send the clip's words to models whose spec lists no options". (c) `slot.js:1016` sends them. But `capability_details.js:409` `supports_clone_prompt_text: opts.has("reference_text")` is false for exactly those families, and `PersonaCloneMaker.vue:336` hides "What's said in the recording" when it is false. (d) In the committed catalog this hits OmniVoice, Higgs, MioTTS, MOSS-TTS Local, MOSS-TTS Nano and IndexTTS 2; at v0.9.1, MioTTS, MOSS-TTS Local and IndexTTS 2. A new OmniVoice clone can't be given its words unless the clip already carries a transcript, and OmniVoice can't clone without them. (e) Unsure on the effect: a candidate clip may bring a transcript (`PersonaCloneMaker.vue:150`). (f) Set the flag to `!listsOptions || has("reference_text")`.

**12. Defaults the code invents.**
(a) Plan §5. (c) `generated.js:106` `Number(o.default ?? p.default ?? min)`: a ranged option with no default gets its minimum. (d) Echo TTS max_duration_sec shows 0.05 s; Kitten TTS 2 shows top_p 0.000001 and max_tokens 1. (e) Unsure whether these are ever sent: they are shown as the default and as "Back to the default". (f) Leave the default empty, meaning audio.cpp's own.

**13. The "not tested" hover makes a claim nobody approved.**
(a) Answer 5: "Not tested by JustVoice yet". (c) `SpeechEnginesTab.vue:966`: "Works as audio.cpp describes it; JustVoice hasn't listened to it yet". `docs/engines.md:306` says the same. (d) The claim is unverified, and the download test contradicted it for VieNeu, AuK and OuteTTS. (e) Unsure: it was in the approved mock (`MockSpeechEnginesPage.vue:139`). (f) Say "JustVoice hasn't tested it yet."

**14. Skipping the hand-wired families also drops models their manifests don't carry.**
(a) Plan §3. (b) "The generated list skips the families they cover". (c) `generated.js:31-35` and `:170`. (d) Never offered:
- Qwen3-ASR 0.6B (Q8, F16), a catalog entry even in the committed catalog
- QwenCleo ASR (v0.9.1)
- Qwen3-TTS 1.7B Base original precision
- VoxCPM2 original precision

(e) Unsure: the skip itself is approved. The TASKS adoption entry partly covers this ("the seven hand-wired engines sit outside audio.cpp's specs"). (f) This belongs to the adoption plan.

**15. IndexTTS 2 offers `text` as a setting, which the plan said to exclude.**
(a) Plan §5 ("minus … text"). (c) `APP_OWNED_OPTIONS` (`generated.js:56`) lacks "text", so IndexTTS 2 / 2.5 show a "Text" setting ("Fallback target text"). (d) This is a defect in the opposite direction from the others: something is shown that the plan excluded. (e) Sure. (f) Add "text" to the excluded set.

## 2. Decisions checked with no finding
- "Offer the best models audio.cpp has, licence-labelled, not licence-limited": nothing filters by licence or by Hugging Face gating. TERMS gates the download only.
- "Every speech engine's licence in plain words": hover, opened engine and prompt all read the curated LICENCE.
- "A fifth commercial-use word: Separate licence".
- "Speech engines: the real tab…": the Unclear wording, status and tested chips, filters, sort and memory line are in place. Only item 10 is a finding.
- "The download test's first findings": VieNeu is hidden and MioTTS's codec is fetched.
- "The download test's last findings" (engine-list parts): AuK and OuteTTS are hidden as approved, and the request path sends the words. See item 11.
- "FINDING — VoxCPM2 clone…": `slot.js:956` drops `reference_text` on a directed line; the note and the manifest header say so.
- Build the engine list, answer 3: wip and unsupported are hidden. "testing" is also shown, but only Chatterbox Turbo has that status, and it is hand-wired.
- Non-GGUF packages left out, as the plan approved.
- "Check our direction…": nothing is claimed as built; its open items are simply still open. The mapping change is under item 9.
