## Findings

**1. Generated models never warm up, so the approved fallback for a missed memory reading never runs for them (OmniVoice included)**
- (a) "The two-day review's fixes" → "The door, the too-big rule…" item 2. Also the audit's step 3.
- (b) Approved: "And save the fallback card number for models whose probe fails." Audit step 3: "a full-length warm-up line on a model's first load records its real peak".
- (c) `slot.js:540-572`: `_warm` warms only the hand-wired families. Every generated row (`family` = e.g. "omnivoice") falls to `else { return false; }`, so `calibrated` is always false for them. `manager.js:1966` saves the whole-card difference only `if (calibrated && this._prices(proc))`.
- (d) The fix never applies to the ~22 generated engines. That includes OmniVoice, the case it was made for (RESEARCH §10.14 "OmniVoice fits the card"). The code comment at `manager.js:1945-1947` and the test `engine_vram_wiring.test.js:210` (a fake slot that returns `calibrated:true`) both claim it is fixed. Also, generated models get no full-length calibration at load. And the spill check (`manager.js:1918`) sees only the weights: working buffers are allocated on the first line, after the check.
- (e) Sure on the code: read `_warm`, `load`, the test. The spill-on-first-line effect is unsure (not measured).
- (f) Fix: give generated models a warm-up where the spec can speak without a clip, or save the difference for any load whose probe misses.

**2. The runaway thresholds are invented, hardcoded, and the comment calls them "decided"**
- (a) FINDING "Digital silence…", the price fix.
- (b) Approved: "Worth fixing so a single odd reading can't do that again." The user: "your re go". No numbers were shown.
- (c) `manager.js:94-101`: `RUNAWAY_S_PER_CHAR = 0.5`, `RUNAWAY_MIN_S = 30`, with the comment "(decided 2026-10-11…)". `_noteRunaway` is at `:1427-1436`.
- (d) The numbers are the implementer's and are not settings (family rule). The fix also covers only lines whose audio runs long. Any other single odd reading still sets the price, because the price is the max of the newest 5 rows (`_priceMb :794`, `_ramPriceMb :1296`).
- (e) Sure on the numbers and the comment. Whether "only runaway lines" fully answers "a single odd reading" is unsure.
- (f) Fix: move both numbers into `speech_runtime` settings, ask the user for the values and the scope, and drop "decided" from the comment.

**3. The AI model's refusal never names a speech model running on the CPU**
- (a) "The new words (2026-10-13)" item 2; kit TASKS, the words.
- (b) Approved: "With a speech model loaded, the last sentence becomes: 'A speech model (voxcpm2) is loaded and holds memory too — unload it first…'"
- (c) Kit `lifecycle.js:3496-3500` names only arbiter reservations with `kind !== "llm"`. A speech model on the CPU on a discrete card never books one: `manager.js:1795` (`books` is false for the CPU), and `:1458`/`:1470` (no booking for the CPU).
- (d) With Kokoro, Pocket or a too-big model on the CPU holding RAM, the user gets "Close other programs…" instead of the approved sentence. CPU slots are the ones that hold the most RAM.
- (e) Sure: read both paths.
- (f) Fix: list the loaded speech slots from JustVoice (e.g. a host callback), not from the card's reservations.

**4. "A saved price bigger than the card" is coded as price + 1 GB margin, and the reason then says something untrue**
- (a) "The door, card-first, the spill" item 4 and "The new words" item 4.
- (b) Approved: "A saved price bigger than the card would take that same route"; the words "it took about X GB on this card before, more than it holds".
- (c) `manager.js:911`: `if (prior && cardMb > 0 && prior + margin > cardMb)`. `engineFacts.js:55` tests the same number with no margin ("fits this card").
- (d) Example: a 7.5 GB price on an 8 GB card. Auto sends it to the CPU and says "more than it holds", while the tab's memory line says "about 7.5 GB, measured here · fits this card".
- (e) Sure.
- (f) Fix: use the approved rule (price > card), or bring the margin version and its wording to the user.

**5. Runtime options: only measured options are offered, against the approved "expose every option"**
- (a) Audit decisions: batch "5h exposing every option"; the design row for the fork's options endpoint.
- (b) The audit §6 item 3 the user approved: "everything is exposed (advanced ones folded)".
- (c) `runtime_options.js:7`: "Only options whose effect was measured are offered". `:14-15`: "`mem_saver` changed nothing there, so it is not offered". `OFFERED` (`:29-56`) holds two Qwen3 options only. Not offered: Chatterbox and VoxCPM2 `mem_saver`, VoxCPM2 `audiovae_latent_capacity`, Qwen3 `voice_prompt_cache_slots`, and the server's `min_free_memory_mb` / `idle_unload_ms` (audit §7). The changed recommendation is recorded in audit §13.5 but was never asked.
- (d) Memory-saving options audio.cpp has are hidden from the user.
- (e) Sure.
- (f) Fix: offer every session option audio.cpp lists, at its runtime default, folded as advanced.

**6. The silence guard fills only stretches of 10 ms or more, and its numbers are hardcoded**
- (a) FINDING "Digital silence…", DECIDED 2026-10-11.
- (b) Approved: "fills any stretch of pure digital silence with that inaudible noise".
- (c) `slot.js:128`: `SILENCE_RUN_S: 0.01, REFERENCES_KEPT: 200`. `:234` sets the shortest run filled.
- (d) Shorter exact-zero runs are left as they are. Whether those trigger the runaway is untested. The 200-file cache cap is also the implementer's.
- (e) Sure on the code. The effect is unsure.
- (f) Fix: tell the user the 10 ms definition and the 200 cap, or make them settings.

**7. `spill_mb` = 256 is the implementer's number, and several thresholds can't be changed from Settings**
- (a) "The door, card-first, the spill" item 5. The audit's "a split size per model". The family rule.
- (b) Approved: "A spill counts as a failure, once loads that fit have been measured" (no number). And: "a split size per model (a catalog default you can override per model)".
- (c) `models.js:448` and `runtime.js:205-208` (256). `SpeechEnginesTab.vue:329` sends `cpu_min_realtime` but no control shows it or `spill_mb`. `engine_overrides.split_chars` (`models.js:422`) can be set only through a raw PATCH /v1/settings (audit doc line 683); grep finds no UI.
- (d) The user can't change the spill threshold, the 2× CPU bar or a model's split size from the app, although they are stored in the database.
- (e) Sure that the number was never shown and that there is no control. Unsure whether API-only counts as "editable in Settings".
- (f) Fix: add controls for them on the runtime row and the model row, and confirm 256 with the user.

**8. A remembered card failure has rules the user never saw**
- (a) "The door, card-first, the spill" item 4.
- (b) Approved: "the remembered failure sends the model to the CPU next time."
- (c) `manager.js:947-967`. A failure counts only for "this runtime build"; it is cleared only by a later measured card load ("a pin to the GPU"); 5 rows are kept (`:989`). The comment says "(decided 2026-10-12)".
- (d) One transient spill, for example a game holding the card, keeps the model on the CPU under Auto indefinitely. The only ways out are pinning it to GPU or a new runtime build. There is no reset control.
- (e) Unsure: "next time" is ambiguous, but the clearing rules and the build scope are not in the approved words.
- (f) Fix: put the clearing rules to the user (e.g. an expiry, or a "try the card again" action).

**9. How the CPU speed is recorded: a minimum line length and best-of-5, neither shown**
- (a) "Speech models run on the CPU or the GPU…" ("The first line … records its real-time factor", plan §8); audit batch 5d.
- (b) Approved: "fast enough = 2× real time". Batch 5d came under "your recs on any fixes you find"; no numbers were shown.
- (c) `manager.js:1047`: `if (!audioS || audioS < 2.0 …) return;` (from 1c7398d, 2026-10-02). `:750`: best of the newest 5.
- (d) Lines under 2 s never record a speed. The 2 s and the 5 are hardcoded and were never shown.
- (e) Sure on the code. Unsure whether the blanket go covers it.
- (f) Fix: list both numbers for the user's word, or make them settings.

**10. Both RAM refusals report a "free" figure that includes credited memory**
- (a) 4(a)/4(b) messages; kit, the words.
- (b) Approved: "but only 1.5 GB of this machine's 32 GB is free".
- (c) `manager.js:1342`: `freeMb = os.freemem()… + creditMb + aiCreditMb`, printed at `:1357`. Kit `lifecycle.js:3482`/`:3490`: free + `creditMb`.
- (d) The message overstates what is free. When the AI credit was already counted, it still says "unload it first", which can't help.
- (e) Sure on the code.
- (f) Fix: print `os.freemem()` alone, and name only holders whose memory wasn't credited.

**11. Kit: the RAM check at a wake is skipped for a model with no card booking**
- (a) Kit TASKS, "It runs at wakes too."
- (b) Approved: "It runs at wakes too. At a wake it warns and goes ahead".
- (c) `lifecycle.js:2594-2598`: `if (want <= 0) return;` comes before the `_admitRam(… wake: true)` line.
- (d) An AI model booked at 0 MB on the card (all on the CPU) gets no wake warning. That is where RAM matters most. Only a log line is lost.
- (e) Unsure: I did not confirm when the booking is 0.
- (f) Fix: run the RAM check before the `want <= 0` return.

**12. Kit: the approved measurement was swapped for a different one without asking**
- (a) Kit TASKS, "What it checks instead".
- (b) Approved: "Measure one more placement first, with a speech model on the card".
- (c) Kit TASKS:40-42 (BUILT): measured `--n-cpu-moe 25` instead, saying "'beside a speech model' is not a placement the kit makes (it evicts)".
- (d) The substitution was never brought back to the user.
- (e) Unsure. The reasoning may hold.
- (f) Fix: tell the user, or run the approved measurement.

**13. Low: internal timings are still hardcoded (family rule)**
- `manager.js:92` `PROBE_TTL_S = 2.0`, `:1193` 4 s drain wait, `:1026` 6 s / ×0.8 unload wait; kit `lifecycle.js:3539` settle loop 30 × 2 s.
- The audit doc §13.5 lists the first two as "Hardcoded still".
- Sure.
- Fix: decide with the user whether these count as "a value a user might want to change".

## Decisions checked, no finding
- 4(a) and 4(b): files and the measured `ram_peak` against free RAM, the occupant credit, the approved message, the AI model named. RAM rows kept newest-5, the same way as the card's peak rows. Per-process readings, raise-only after each line. The AI credit, then an exact re-check before the slot starts.
- Card-first: files + margin ≤ card total, with its words. "its files are about X GB, more than this card's Y GB". "— this may be slow on the CPU" / the measured speed. `needOf` takes the larger of the estimate and the files.
- A failed or spilled Auto card load retries on the CPU in the same click; a `no_card` row is written once the CPU took it.
- The AI model's door: CPU-held share + margin, raised by the measured `ram_peak`, credits evictable speech slots; refuses at a load, logs at a wake; plain mmap excluded; the approved refusal words.
- CPU threads = physical cores, as a setting, on the runtime row. The 2× value. An unmeasured model counts as not fitting while the AI model is on the card. The third step unloads the AI model through `makeRoom` (toast). Unified-memory machines stay on the GPU.
- Split defaults: Qwen3 CV/Base 200, VoxCPM2 200, Kokoro 240; description voices whole. The price is the exact model's own peak, by split and runtime build. Refusal comes before download or eviction.
- Gap 9: 16-bit rows for all but KittenTTS; VoxCPM2 warms up.
- The 20 s clip cap: not built and no wording left (replaced by the guard). The guard is Qwen3 Base only, ±2 LSB, and leaves the voice's own file untouched. Clips are 16-bit by upload (`voices_api.js:313`).
- The Slice 6 FINDING (Auto says "nothing else is on the graphics card" and the admission refuses) is already recorded in TASKS, so it is not re-reported.

Nothing was edited or run; this was a read-only review.
