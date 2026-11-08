# The best engine you can sell with — tested, tuned, made the default (2026-11-08)

**Read this FIRST after any compaction.** Then re-check every name and number below at its source.

## The job, in the user's words

- 2026-11-07: "the point wa the best for commercial and i just realized everything we have been
  testing to get the best results are on breeze tts 2 which is not what we are supposed to focus on"
- "i gave you a single task give me 1 best model for commercial and 1 best model for non commercial
  … do we need to start testing for commercial"
- "stop the … release since you fucked up and we have to start over testing and tweaking as now jv
  is not really ready" — done: the family release session cancelled the fork's release run before it
  published (TASKS top item).
- 2026-11-08 (the go): "use that big brain to think on this adverserily multiple times until you
  have concenspous and take your own rec in fact do this until the app is complete do not stop for
  turns do not stop for anything"; "i do not want to listen to any test pages you do it all your
  self, you do it all without human intervention … you make all decisions on your own but onluy
  after advererily thinking about it unti you come to consensus".

So: no listening pages. Every pick is mine, attacked until it stops changing, recorded here as
**mine**. Still the user's (global rules): the release itself, anything sent off this machine,
money and accounts.

## Where it stands

- [x] Release stopped (fork run 42444512703 cancelled, no tags; kit audio.cpp pin v0.9.2-jv.6).
- [x] The judge: take-check alone fails; the LAION feeling heads tell strong actors from weak
  (arm Spearman 0.73, families 0.89) but not the sellable arms from each other (0.20) — RESEARCH
  §10.39. So: the LAION score places a new engine in or out of Breeze's tier; between sellable
  engines the user has heard, the user's own ratings decide.
- [x] Round 10 rendered and scored (Ming on the CPU; LAION score; read-back by the app's recogniser
  on the CPU — no card needed). D5 characters VoxCPM2, D6 narrator Drama 3, D7 the card's Voices.
- [x] Defaults, Voices, VoxCPM2 feeling words, Ming direction, Drama 3 load options, tests, mock, docs.
- [x] End run: lint; server 1310 (+2 skipped); unit 312; the guard; e2e 10/10 — on 3d5b2020 and again
  on e23e09a8 (D8). Pushed: 29eb8380, 3d5b2020, e23e09a8. Rerunning both suites on the kit's 0076ba18
  (web-9e's mocap changes landed after my run).
- [x] JustDirect: fixtures sent; it aligned its client; its live round trip runs on my server in the
  card window (after "JustVoice ready"), then it gets "card free" with JustVoice closed.
- [x] The real window, 2026-11-08 (the UnPackaged build of e23e09a8 on <repo>/data through the
  server on 17494, scratchpad `window/look.js`, `look390.js`): Alice VIII's card read "Qwen3-TTS
  VoiceDesign → BreezeTTS 2 · Commercial use: Separate licence"; Voices → "Best voices you can sell"
  turned it into "→ VoxCPM2 · narrator Fish Audio Drama 3 · Commercial use: Conditional", no stop
  (Drama 3's licence accepted here), saved `voxcpm2` / `fish_drama3-fishdrama3`; no page error; at
  390 px no overflow, the select 282 px wide, its label cut with "…", the chip under it. The mock
  (#/mock/one-click) shows the same words in its design step and Voices; its picture is behind the
  start-up splash (the dev renderer warms the chat model), not taken. The dev database is now on
  the sellable set (switched through the card).
- [x] JustDirect's live round trip on my server (web-4c's report, 2026-11-08 06:43–06:47 UTC):
  POST /v1/character-voices → done in 211 s — Mara described by JustVoice's prompt on gemma, designed
  on Qwen3-TTS VoiceDesign (Yes), kept on VoxCPM2 (Yes), the audition 4.32 s at 24 kHz; POST
  /v1/audio/speech/batch, release: true → done in 40 s, the line fetched by its url (3.36 s at 48 kHz),
  the batch deleted; the card back to 604 MiB as the batch ended (the release worked). My fault in
  it: my mock capture's start-up asked the server for the chat model at 01:43:41 local, 10 s after the
  arbiter had evicted it for the designer, so it loaded beside the designer over budget — the job
  still finished. Don't open a renderer on a server another app is using.
- [x] The smoke gate: every view, zero JS errors (17494, the user's data). JustVoice closed (no
  process, ports 17494 and 8080 free), "card free" sent to web-4c.
- **Done.** JustVoice is ready for the release on its side. The release itself stays the user's; when
  it is restarted, the release session must ship the fork's v0.9.4-jv.7 (Drama 3 and Ming are not in
  jv.6) and the catalog at its tag — told by message 2026-11-08.
- [x] JustDirect's second run (web-4c, 2026-11-08: a 3-shot film end to end, one voice cloned from
  Mara's audition, one described, their lines as one batch with release: true, then its clips): my
  headless server is up on 17494 with the dev build (fork 6d64f04e), on "Best voices you can sell"
  (design qwen3-vd, cast voxcpm2, narrator fish_drama3-fishdrama3). What I told it about release
  (checked in client_api.js and the kit's runtime_service.js): every speech model goes; the kit holds
  one per kind, since a load unloads the kind's others. The chat model is not release's: the
  designer's card load evicts it through the arbiter, and it stays (mostly in RAM, until its 900 s
  idle sleep) only if the designer ran on the CPU. Measured as the batch ended (03:50 local): one load
  only, VoxCPM2 on the card; the card 501–612 MiB after (nvidia-smi); left: one idle speech server
  (397 MB RAM, no model) and the Node server. Pell had no line, so JustDirect skipped its
  character voice on purpose; one clone (Ines) and one batch was the whole call. The run ended
  09:13:45 UTC with no errors on my side; JustVoice closed (its process tree, the speech server
  included; 17494 doesn't answer); web-4c gave just-stage "card free" itself. Mistakes: my first log
  watch piped through `cut`, which held its lines, so it was blind (I read the log directly; the
  numbers stand); and I stopped a leftover `tail -f` in the same command that printed what it was. It
  turned out an orphan (its parent gone, its log last written 2026-10-29), but look first, then stop.
- [x] The smoke gate on the user's data and the real window, after "card free" (above). The
  placements I changed are back to Auto (Ming, Transcription).
- [x] JustDirect's client API built (`api/client_api.js`, voices_api changes, models, health
  `client_api`, `docs/dev/client-api.md`, `tests/client_api.test.js` + fixtures), and since run live
  (above). Shapes sent to web-4c 2026-11-08; per-line WAV URLs added at its request.
- [x] Tuning the leader: VoxCPM2 told the feeling's words (D5). The narrator pick: Drama 3 (D6).
- [x] Defaults switched (code, dev database, tests, mock, docs), suites run once, the app looked at.

The graphics card: just-stage holds it (~1.5–2 h from 2026-11-08 ~00:15), then web-4c's clips run,
then me — each sends "card free". Until then only CPU work. No ~18 GB CPU job while web-4c's retry
runs (it holds ~24 GB of RAM). Machine: 32 GB RAM, RTX 2070 SUPER 8 GB, Ryzen 7 5700X.

## Decisions (mine, under the go)

**D1 — what counts as commercial.** A licence word of **Yes**, or **Conditional** where a normal
audiobook seller may sell under it: Fish Audio Drama 3 (under USD 500,000 a year, "Built with Fish
Audio" shown, not as a speech service for others), DramaBox (under USD 10 million a year, say the
book is machine-generated). Out: Higgs Audio 3 (building it into an app for others needs Boson's
licence, and its quantized files are research-only — RESEARCH §10.13), IndexTTS 2.5 (Unclear: a
non-commercial codec part), BreezeTTS 2 and Fish S2 Pro (Separate licence), OmniVoice, Voxtral,
XTTS, ZipVoice (No). Ties go to a plain Yes.
- Attack 1, past decisions: the 2026-10-11 ruling "offer the best models, labelled" stands; the run
  already stops for a licence that isn't a plain yes (`docs/engines.md` "Separate licence" /
  conditional stop), so a Conditional default shows its terms before the first run.
- Attack 2, the user's surprise: "best for commercial" may mean plain Yes only. But a capped licence
  is a commercial licence, JustVoice's first audience is audiobook producers, and the tie rule keeps
  a plain Yes whenever the judge can't separate them. Held.
- Attack 3, edges: Drama 3's "not as a service" — JustVoice serving JustWrite on the same machine is
  the user's own use. Held.

**D2 — the judge stands in for the user's ears.** The test kit (`tools/take-check`: Whisper WER,
WavLM speaker similarity, UTMOSv2, emotion2vec+, emo_vad, loudness) is checked against the user's
own per-take answers from rounds 4–9 ("full feeling / weaker / plain / something else", best picks).
If a combination of scores predicts the user's answers on engines it wasn't fitted on, it judges
round 10; if not, each score is read on its own with the user's past engine order as the prior.
- Attack 1: scorers agree with people on model averages (ρ 0.94) but weakly per take (0.40)
  (RESEARCH §10.11) — an engine pick is a model-average question, which is what they're good at.
- Attack 2: the answers are half Breeze (round 8 was Breeze only) — validate leave-one-engine-out.
- Attack 3, simpler: raw emotion gain alone mis-ranked round 6 (Drama 3 ≈ Breeze by score, Breeze
  ahead by ear) — so the calibration is needed, not optional.

**D2's first result (2026-11-08, measured):** 321 rated takes (rounds 4, 5, 6, 7, 9) joined to their
take-check scores and their untold twins (scratchpad `judge/build.js`, `fit.js`). Leave one engine
family out, a logistic model on all scores predicts the user's "full feeling" at take AUC 0.65 and
**ranks the arms at Spearman −0.02 to 0.14** — no better than chance; the best single score is the
told take's loudness against its twin, signed by the feeling (arm Spearman 0.56), then "less
emotion2vec neutral" (0.43). The dots.tts edits score as emotional and the user heard none of them
full. **So take-check as it is cannot stand in for the user's ears** — a better judge is tried
next: LAION Empathic-Insight-Voice (CC-BY-4.0; 40 emotions, Arousal, Valence, "Monotone vs.
Expressive"), through NVIDIA NeMo's own wrapper (`nemo/collections/tts/metrics/emotion_encoder.py`,
Apache-2.0, vendored into `tools/take-check` as `emotion_encoder.py` with every head added; NeMo
installs on Linux only). LAION's own voice-acting studies on MOSS-TTS score takes this way
(projects.laion.ai/moss-8b-voice-acting).

**D3 — the candidates (mine).** Every model the app accepts for a cast voice (copies a voice and
takes direction, `book_voices/index.js` `checkedModels`), sellable under D1, on the 8 GB floor:
- **Ming 3.0 TTS 0.5B** (MIT) — new: Artificial Analysis's speech arena (provider voices, October
  2026) has it 4th of the open models (Elo 1187; Drama 3 1275, Breeze 1228); CV3 emotion control
  72.33 %. Wired into the app 2026-11-08 (`curated/ming3_tts.js` DIRECTION: its seven labels on the
  speaker embedding, shouted/whispered as volume; `generated.applyDirection` takes a phrase that is
  options). Never heard; rendered in round 10.
- **Fish Audio Drama 3** (Conditional) — the arena's first; by ear 5 of 13 told the book's cue
  words (round 6), 0 of 13 told a delivery note (round 7). Round 10 adds it told only the feeling's
  word. ~17 GB of RAM mapped, 6.9 s a take.
- **VoxCPM2** (Yes) — by ear 5 and 6 of 13 told one word with the clip alone (rounds 4 and 9),
  2–3 of 13 told the cue phrases (rounds 5–7): one word suits it.
- **CosyVoice3** (Yes) — round 4 rendered it with its makers' fixed sentences (300 takes, scored
  +0.06), never heard; judged from those takes.
- Out, with why: Drama3-small (a community quant, 10.5 GB, no gain on the card); MOSS-TTS v1.5
  (Apache, 13.2 GB q8 in the app, above the 8 GB floor — a 16 GB-tier option, tried on the CPU only
  if time and RAM allow); MOSS-TTS-Local (no direction); Qwen3 CustomVoice graft (1 of 13, round 6);
  dots.tts Edit (0 of 13, round 9); Chatterbox (no written direction); DramaBox (17.6 GB, above the
  floor); Higgs, IndexTTS (D1).

**Round 10 — set before rendering (mine).**
- Lines: round 5's 13 (7-3, 7-31, 7-32, 7-57, 7-58, 7-70, 7-95, 7-117, 8-27, 8-44, 8-48, 8-57,
  8-67) — the lines every rated page used, so new takes sit beside rated ones; seeds 7, 8, 9; told
  and plain; the Hatter's voice; through the app under `npm run dev`'s runtime (fork jv 6d64f04e,
  built 2026-11-07 21:59, holds Ming3 TTS and Drama 3).
- New arms: `ming3-r10` (Ming 3.0 TTS bf16, the app's new direction), `drama3-word` (Drama 3 told
  only the feeling's word). Reused, already rendered the authors' way: `voxcpm2` and `cosyvoice3`
  (round 4), `drama3-r6` (round 6), and Breeze (comparison only).
- The pick: the sellable arm the validated judge rates highest on the full feeling, provided its
  read-back WER ≤ 0.05 and its told speaker similarity ≥ 0.80 (round 9's gate); when two arms'
  bootstrap intervals overlap, a plain Yes beats a Conditional (D1). If no judge validates, the
  pick falls back to the user's own past full rates for the heard arms (VoxCPM2 5–6 of 13 told one
  word, Drama 3 5 of 13) plus each new arm's single best-validated score — and says so.

**The evidence going in (2026-11-08, before round 10's numbers):**
- Characters — the user's full-feeling rate on the sellable engines heard: VoxCPM2 told one word
  with the clip alone 11 of 26 (42 %, rounds 4 + 9); VoxCPM2 told the cue words at guidance 2.7 6 of
  52 (12 %, rounds 5–7, confounded: words AND guidance changed); Drama 3 told the cue words 5 of 13
  (38 %); Drama 3 told the note 0 of 13; CustomVoice 1–2 of 13; dots.tts 0 of 13. VoxCPM2 one word
  ≈ Drama 3 cue: a tie by D1 goes to VoxCPM2 (plain Yes; also faster, 2.3 s against 6.9 s a take;
  ~3 GB against ~17 GB of RAM mapped; in the pinned jv.6, Drama 3 is not).
- Narrator — the user's picks: Drama 3 over Breeze 5 to 3 (3 the same; round 8 part 2), Breeze over
  VoxCPM2 10 to 0 (round 7). So the sellable narrator by ear is Drama 3; VoxCPM2 is out.
- The app sends VoxCPM2 "(<feeling>. <cue words>)" today (persona_render `composeInstruct` → slot.js
  `voxcpm2`): the 12 % way. The 42 % way is the feeling's word alone at its default guidance 2.0.
- Ming 3.0 TTS and Drama 3 are not in the pinned release v0.9.2-jv.6 (Ming came 2026-10-21) — any
  default on them needs the fork's v0.9.4-jv.7 in the release, as the release plan already has.
- Drama 3 loads on an 8 GB card only with `fish_drama3.disk_experts=true`,
  `cpu_expert_layers=0` (round 6's options); the app has no default for them yet
  (`curated/fish_drama3.js` has no `LOAD_OPTIONS`) — needed if it becomes a default.
- Open (mine to decide after the pick): a choice on the one-click card between the voices you can
  sell with and BreezeTTS 2 (the best you can't), so the user's "1 best for commercial and 1 best
  for non commercial" are both one click away — today only `book_voices.*` in settings.

**Round 10's numbers (2026-11-08)** — the LAION feeling score on the 11 scorable lines × 3 seeds
(told takes; gain = over the untold twin; expressive = "Monotone vs. Expressive"):

| Arm | Licence | Feeling [95 %] | Gain | Expressive |
|---|---|---|---|---|
| BreezeTTS 2 (comparison) | Separate licence | 1.13 [0.75–1.56] | 0.65 | 1.78 |
| VoxCPM2, one word (round 4) | Yes | 0.84 [0.55–1.14] | 0.47 | 1.64 |
| Ming 3.0 TTS (round 10) | Yes | 0.65 [0.33–1.01] | 0.13 | 0.67 |
| Drama 3, cue words (round 6) | Conditional | 0.62 [0.28–1.00] | 0.07 | 1.13 |
| CosyVoice3 (round 4) | Yes | 0.40 [0.18–0.65] | 0.00 | 0.97 |

Ming acts sad (1.40, 0.99) and a little fearful, not shouted (its volume control: 0.38, 0.04).

**D5 — the character voices: VoxCPM2, told the feeling's words (mine, 2026-11-08).** The user's ears
put it first among the sellable engines heard (42 %, Drama 3 38 % — a tie, and D1 gives a tie to a
plain Yes); the judge agrees (0.84, above Ming, Drama 3, CosyVoice3; no new engine reached Breeze's
tier). Attacks: (1) past decisions — "best for commercial" (2026-11-07) is what it answers; the
2026-10-16 Breeze pick was for best overall and stays the non-commercial best. (2) cost — in the
pinned jv.6 (no release dependency), 2.3 s a take, ~3 GB. (3) surprise — it acts below Breeze (42 %
against 70 %+ by the same ears) and its whispers drew "volume wrong" (round 9): said in the docs and
the card's licence chip stays Yes. (4) simpler — VoxCPM2 was a default before (the narrator until
2026-10-21). (5) edge — only told the feeling's words (FEELING_WORDS); the cue-word way is the 12 %
one. Held.

**D6 — the narrator: Fish Audio Drama 3 (mine, 2026-11-08).** By the user's ears the sellable
narrator: Drama 3 over BreezeTTS 2 5 to 3 (3 the same, round 8), BreezeTTS 2 over VoxCPM2 10 to 0
(round 7). No automatic judge reads narration: of 20 LAION heads the best agrees with 13 of the 18
decided picks (Serious vs. Humorous) — chance level for the best of 20 — so Ming 3.0 TTS's narration
(rendered, `data/round10/narration`) can't be placed, and the ears' pick stands. Attacks: (1) past
decisions — the 2026-10-21 narrator on Breeze is replaced by the commercial ruling; D1 counts
Conditional. (2) cost — ~2× slower than real time on the 8 GB card (round 8: 256 s for 120 s), a
23.4 GB download, ~17 GB mapped while loaded, two models in a run (the speech queue groups lines by
engine, so few swaps — the 2026-10-18 default had two too). (3) surprise — the licence stop before
the first run ("Fish Audio Drama 3's licence isn't accepted…") and "Built with Fish Audio": said on
the card and in the docs. (4) simpler — VoxCPM2 for both is faster but lost the narration 0 to 10
to Breeze. (5) edge — not in the pinned jv.6: the release must carry v0.9.4-jv.7 (already its plan);
its 8 GB load options are now its defaults (`curated/fish_drama3.js` LOAD_OPTIONS). Held.

**D7 — the card's Voices (mine, 2026-11-08):** the one-click card gets a **Voices** choice between
`book_voices.sets` — "Voices you can sell" (VoxCPM2 · narrator Drama 3) and "Best acting — not for
sale" (BreezeTTS 2) — so both of the user's picks are one click away; the sets are settings (the
family's no-hardcoded-presets rule). Picking one sets `clone_model` and `narrator_model`.

**D8 — a lighter set you can sell (mine, 2026-11-08, after attacking D6 from the end user's side).**
Drama 3 is a 23.4 GB download that maps ~17 GB of the file in memory; on the floor tier (8 GB card,
16 GB of RAM) it may not run well, and the card offered no lighter sellable choice. So `sets`
gets a third: **Lighter voices you can sell — VoxCPM2** for every voice (one ~3 GB model, a plain
Yes, faster; its narration lost to Breeze's 0 to 10 by the user's ears — said beside it). The first
set's label becomes **Best voices you can sell** so the two read apart.

**JustDirect's brief (web-4c, 2026-11-08; the user told it "there is a jv session running if you
need to have it do any code changes jv needs").** After the commercial pick, on the same defaults:
1 make a character voice in one call (book_voices' recipe; commercial cloner; job), 2 speak a line in
OpenAI's `POST /v1/audio/speech` shape, 3 clone from a recording (`POST /v1/voices/clone` +
commercial word), 4 list and delete its voices (with model + commercial word), 5 free the card when
another app's job ends, 6 a contract (version field, documented shapes, contract test), 7 speak a
batch (many lines → WAVs or a zip keyed by its line ids, the card freed at the end; the user's
design: "if you need to make a call to jv just unload your model first, make sure you do a batch to
jv do all sound work in groups then you can reload your models"). Shapes go back to web-4c before
it builds.

**JustDirect's API — the design (mine; built after the pick, shapes sent to web-4c first).**
Standard: OpenAI's speech request for one line (platform.openai.com/docs/api-reference/audio/
createSpeech — `model`, `input`, `voice`, `instructions`, `response_format`, `speed`), the kit's job
router for long work (`makeJobsRouter`, `/v1/jobs/:id`, `/events`, `DELETE`), JustVoice's own
`/v1/voices*` for voices. JustDirect is the first app to call JustVoice live (JustWrite hands over a
file, design-decisions §3).
1. `POST /v1/character-voices` → 202 job (kind `character-voice`). Body `{name, description, lines?,
   context?, language, gender?, commercial_use?}`. The one-click recipe for one person: the Local
   describe prompt (`book_voices` ACTIONS.speaker) over the card and the lines; no language model
   set → the card's description goes to the designer as written (`described_by: null`); designed
   once on `book_voices.design_model` speaking a calm line of theirs (else the stock line), kept as
   a clip voice on `book_voices.clone_model`, marked `made_by` (the caller's `X-Client` header,
   e.g. "JustDirect"). Result `{voice_id, name, gender, description, described_by, design:
   {model, name, commercial, summary, url}, clone: {…}, audition_url}`. `commercial_use: true`
   refuses (409, saying which model and why) a model whose word is No, Separate licence or Unclear;
   Yes and Conditional pass, with the words shown.
2. `POST /v1/audio/speech` — OpenAI's body; `voice` a JustVoice voice id; `instructions` the
   delivery in words; JustVoice's own extra `emotion` (one of the nine) for models that take a
   label (Ming, CosyVoice3); `response_format` `wav` (others 400); `speed`; `seed`. → `audio/wav`.
3. `POST /v1/voices/clone` as it is, with `engine` optional: none → `book_voices.clone_model`'s;
   the reply adds the model's licence facts and `made_by`.
4. `GET /v1/voices?made_by=JustDirect` — every voice row gains `made_by` and `licence {commercial,
   summary, url}`; `DELETE /v1/voices/:id` as it is.
5./7. `POST /v1/audio/speech/batch` → 202 job (kind `speech-batch`): `{lines: [{id, voice, input,
   instructions?, emotion?, seed?}], release: true}` → each line rendered in order, the job's result
   `{lines: [{id, file, seconds, error}]}`, the zip at `GET /v1/audio/speech/batch/:job_id.zip`
   (`manifest.json` keyed by the caller's ids + one WAV each); `release` (default true) lets go of
   every speech model when the batch ends, so the card is the caller's again.
6. `GET /v1/health` gains `client_api: 1`; the shapes in `docs/dev/client-api.md` (dev docs: no
   user-visible screen changes) with example bodies; `server/tests/client_api.test.js` checks each
   route against those examples, which JustDirect's fake copies.
- Attack 1, past decisions: JV stays standalone (design-decisions §3) — this is a door others call,
  not a dependency; no JustDirect code or name in JustVoice beyond the `made_by` string it sends.
- Attack 2, cost: `made_by` is a new voice field (storage `voices.js` manifest + DTO); the DTO's
  `licence` reads the curated file per row — `vmod.describe` already resolves the model.
- Attack 3, edge: two apps on one card — `release` frees JustVoice's hold; JustVoice never unloads
  another app's models (the user, 2026-10-29). A batch's lines ride the speech queue as interactive
  singles, ahead of a running book render at each line boundary (checked: `generate_api.js:320-326`);
  a book rendering then slows — accepted, the caller freed the card for it.
- Attack 4, simpler/standard: a batch as many `/v1/audio/speech` calls loses the "free the card at
  the end" and the one-zip handoff the user designed ("do a batch to jv do all sound work in
  groups"); kept.

## The standard each piece follows

| Piece | Standard | Kit code |
|---|---|---|
| Speech models: load, place, unload (the batch's release too) | the kit's audio.cpp runtime | `packages/core/src/runner/runtime_service.js` |
| Long work of the client API (a character's voice, a batch) | the kit's job registry and its routes | `makeJobsRouter` |
| The card's **Voices** | the kit's select | `UiSelect` |
| The licence words (`licence`, the card's chip) | JustVoice's reading of each model's licence at its source | app — curated/<family>.js, JustVoice's own catalog of voices |
| A line's feeling for VoxCPM2 and Ming 3.0 TTS | each model's makers' way, as tested by ear | app — how a voice model is directed is JustVoice's own logic |
| `POST /v1/audio/speech` | OpenAI's createSpeech request (platform.openai.com/docs/api-reference/audio/createSpeech) | app — JustVoice's speech door; the kit has no speech route |
| The voice sets | settings, not code (the family's no-hardcoded-presets rule) | app — JustVoice's `book_voices` settings |
| The judge (take-check's LAION heads) | NVIDIA NeMo's Empathic-Insight wrapper, vendored | app — the test kit beside the app, never shipped |

## Mistakes to avoid
- `take-check empathic` took 18.5 GB of RAM on 512 takes (not the 3–4 GB guessed): tell the other
  sessions the measured figure, and score in chunks.

- Never tune or default on a non-commercial engine; Breeze is a comparison arm only.
- Read `LICENCE.commercial` in `server/src/engines/audiocpp/curated/<family>.js` before any pick.
- One model loaded at a time; Drama 3 maps ~17 GB of RAM; nothing on the card without "card free".
- `node -e` and scripts are ES modules (`--input-type=module`), never `require`.
- Commit with `git commit -F - -- <paths>`.

## Next steps

1. Gather the user's answers (rounds 4, 5, 6, 7 from the pages' collections; 8, 9 saved in session
   7174f3f8's scratchpad `answers2/`) and each take's scores; fit and validate the judge.
2. Candidates and how each is told (round 10's plan, below, set before rendering).
