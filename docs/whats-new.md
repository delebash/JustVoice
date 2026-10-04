# What's new

## v0.1.0

- **Every voice knows its model, and a mixed cast renders (2026-10-03).** A
  voice now remembers the model it was made for — a Qwen3 speaker is
  CustomVoice, a clone is the model you picked when you cloned it — and every
  render loads that model, in the size you chose on AI Settings. A chapter whose
  voices need different models renders model by model instead of being refused
  (the mixed-Qwen3 refusal is gone). Import's **Model that speaks as this clip**
  lists models rather than engines
  ([Voices → Every voice knows the model that speaks it](voices.md#every-voice-knows-the-model-that-speaks-it),
  [Studio → One speech model at a time](studio.md#one-speech-model-at-a-time--a-mixed-cast-renders-model-by-model))
- **An empty transcript stays empty (2026-10-03).** Auditioning a cloned voice
  without typing what the clip says sent a dash as its transcript, and saving the
  audition kept it, so Qwen3 Base read the clip as saying "—". Now an empty box
  is no transcript: VoxCPM2 and Chatterbox clone from the sound alone, and Qwen3
  Base asks for the transcript or **Skip the words**, by name. **Skip the words**
  works again on Qwen3 Base — it had not reached the speech runtime since the
  2026-10-01 switch — and a voice saved with it keeps it for its renders
  ([Voices → What each model asks for](voices.md#what-each-model-asks-for))
- **Updating the speech runtime shows its progress and cleans up (2026-10-03).**
  The bar on the runtime row fills as the new build downloads, and the build it
  replaces is deleted afterwards — about 2 GB for a CUDA build
  ([Engines → The speech runtime](engines.md#the-speech-runtime))
- **JustVoice's own build of the speech runtime (2026-10-03).** The runtime now
  comes from [JustVoice's copy of audio.cpp](https://github.com/delebash/audio.cpp),
  so fixes no longer wait on upstream. The first build, v0.9.0-jv.1, lets
  VoxCPM2 use a cloned voice's transcript — a transcript field appears when you
  clone with it. The build you have keeps working; the runtime row on AI
  Settings → Speech engines offers **Update to v0.9.0-jv.1**
  ([Engines → The speech runtime](engines.md#the-speech-runtime))
- **VoxCPM2, a new engine (2026-10-02).** OpenBMB's 2B model clones a voice from
  a short clip or designs one from a written description, in 30 languages, at
  48 kHz — and written direction reaches its cloned voices, which no other engine
  here does. About 1.3× real time on an 8 GB card. It does not speak text in
  parentheses, so a line's own brackets are read as dashes
  ([Engines → The catalog](engines.md#the-catalog))
- **Every model has a 16-bit row (2026-10-02)** beside its 8-bit default — the
  original precision, a larger download that needs more memory. Read back on a
  real chapter, the two precisions came out level on every engine
  ([Engines → 8-bit or 16-bit](engines.md#8-bit-or-16-bit))
- **A chapter that mixes engines with different sample rates joins them at the
  highest one (2026-10-02).** Until VoxCPM2 every engine spoke at 24 kHz, so this
  never showed; a 48 kHz line would otherwise have played at half speed
- **Qwen3-TTS CustomVoice 0.6B is back (2026-10-02).** The same nine directable
  speakers as the 1.7B in a 1.7 GB download that took about 1.35 GB of graphics
  memory once loaded on an 8 GB card. audio.cpp does not publish this size, so
  JustVoice converted Qwen's official checkpoint with the speech runtime's own
  converter and publishes it at
  [delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF](https://huggingface.co/delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF);
  pick it on its row on AI Settings → Speech engines
  ([Engines → The catalog](engines.md#the-catalog))
- **Loading another model of an engine that is already loaded now loads it
  (2026-10-02).** Before, the row switched to "loaded" but the first model went
  on speaking — choosing Qwen3-TTS Base while CustomVoice was loaded, or the
  Spanish Pocket TTS model while the English one was, changed only the label.
  Now the first model unloads and the one you chose loads.
- **Fixes (2026-10-02).** Slider labels no longer print over each other
  (Generate's Speed read "sloweras written"). A chapter line spoken by a cloud
  voice now takes its sample rate from the audio the provider returns, instead of
  assuming 24 kHz
- **Speed works on every engine (2026-10-02).** Speed — Generate's slider, a
  persona's default, a render preset's pace, a line's own setting — used to reach
  only Kokoro and KittenTTS; Qwen3-TTS, Chatterbox and Pocket TTS ignored it. Those
  two still pace themselves; for every other engine JustVoice now time-stretches the
  finished line and keeps its pitch. Lines that were cached at a speed the engine
  ignored render again once. Generate's **Pitch** and **Gain**, which did nothing on
  that page (they worked in chapters), now apply there too
  ([Generate → the primary controls](generate.md))
- **Speech models run on the graphics card or the CPU, chosen per model (2026-10-02).**
  Each model row on AI Settings → Speech engines now says where it runs and why, with
  an **Auto · GPU · CPU** choice. Auto keeps a model on the graphics card when nothing
  else is there or it fits beside the AI model, moves it to the CPU when it speaks at
  least 2× real time there, and otherwise unloads the AI model for it with a toast — so
  on an 8 GB card Kokoro no longer pushes your language model out. CPU models run in a
  second runtime process that takes no graphics memory; its threads are on the runtime
  row. Voice engine setup's tiers say where each engine will run
  ([Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu))
- **Two new engines that run well on the CPU.** **KittenTTS** — eight English preset
  voices, 3.4× real time on an 8-core CPU. **Pocket TTS** — Kyutai's cloning model, the
  first since LuxTTS to clone fast on a CPU (4× real time), with 20 preset voices, one
  model each for English, German, Italian, Portuguese and Spanish. Its first clone asks
  you to accept Kyutai's terms ([Engines → The catalog](engines.md#the-catalog))
- **Voice training is gone (2026-10-02).** The Voices page's **LoRA** tab — the
  Preparer, the Dataset Builder and training runs — is removed, with the training
  settings and the `training.completed` / `training.failed` webhook events. It ran on
  the Python environments the speech runtime replaced, and the runtime cannot render a
  trained voice; it is to be rebuilt on the runtime later. **Default voice language**, the language a blend falls back to, moved
  from the Training settings to Settings → Generation
  ([Engines → Voice training](engines.md#voice-training))
- **Every voice engine now runs on one speech runtime (2026-10-01).** Kokoro,
  Qwen3-TTS, Chatterbox and speech recognition used to be separate Python programs,
  each with its own environment to install. Now one program — the speech runtime,
  built on [audio.cpp](https://github.com/0xShug0/audio.cpp) — runs them all. Install
  it once from the **Speech runtime** row at the top of AI Settings → Speech engines
  (the Voice engine setup wizard does the same); it picks the build for your machine
  — CUDA, Vulkan, CPU or Metal — and its **Backend** select changes that. Each engine
  is then just its models, downloaded from its rows. Measured on an 8 GB card: Qwen3
  renders about 7× faster than before, Chatterbox about twice as fast, and models load
  in seconds; the same seed now gives the same audio on every engine; on Windows, AMD and
  Intel graphics get the GPU (Vulkan) build for every engine instead of the CPU. **Your old engine downloads don't carry
  over** — the runtime uses new 8-bit model files, so each engine's model downloads
  again (from its row, or the first time you load it). Speech recognition is now
  Qwen3-ASR, which got fewer words wrong than Whisper in most languages measured, and
  chapter captions time their words with its aligner. Not available yet on the
  runtime: Chatterbox Turbo and its inline tags, Chatterbox in Hebrew, Japanese,
  Russian and Chinese, Kokoro blends and its Japanese voices, IPA lexicon entries
  (respellings work), and Qwen3 CustomVoice 0.6B;
  LuxTTS, TADA, MOSS-TTSD and Whisper are gone. The full list, and why, is in
  [Engines → Not available yet](engines.md#not-available-yet); the runtime itself in
  [Engines → The speech runtime](engines.md#the-speech-runtime)
- **A book's pronunciation lexicon now reaches the audio.** Overview has a new
  **Pronunciation lexicon** row — None, one of this book's lexicons or a reusable
  one. Until now the render read only the personas' lexicons, so a name fixed in the
  book's lexicon was still said wrong, with nothing to tell you. Every line is now
  read with the book's lexicon first, on the chapter audio, the M4B, the ACX check,
  captions, Lines and the voice-line export alike; where the book's and a persona's
  lexicon both have an entry the engine can use for the same word, the book's wins
  ([Lexicons → Which lexicons a line is read with](lexicons.md#which-lexicons-a-line-is-read-with))
- **Generate says a word the way the persona's lexicon says it.** Generate showed the
  picked persona's lexicon and sent it, and the server ignored it; now a line on
  Generate is read through it, as the same line in a chapter is
- **Lexicons shows who uses each one, and a new book lexicon is put to use.** A
  **Used by** column lists the books that chose a lexicon and the personas that carry
  it, or says **— not in use —**. A book-scoped lexicon you make for a book that has
  none chosen becomes that book's lexicon, as an import's does
  ([Lexicons](lexicons.md#which-lexicons-a-line-is-read-with))
- **The persona's "Lexicon override" is now "Lexicon"**, with its empty choice "None" —
  it never overrode the book's; it adds its own words on that persona's lines
- **A persona's lexicon stays on that persona's lines.** Every persona's lexicon in
  the cast used to be applied to every line of the chapter, so one speaker's slang
  spelling also reached the narrator
- **Changing a lexicon re-renders only the lines it changes.** Choosing a lexicon, or
  editing one pronunciation, used to re-render far more than it touched — on Kokoro a
  single IPA edit re-rendered the whole chapter. Now only the lines that contain the
  word are rendered again
- **"Scan the book for names" works, and counts what the render reads.** The scan
  failed with an error on any book. It now runs, and a name counts as handled only
  where the render would read it — the lexicon chosen on Overview, or the speaking
  persona's on that persona's lines ([Lexicons](lexicons.md#find-the-names-before-you-hear-them-wrong))
- **Closing the app shuts down cleanly with "Require a token even on localhost" on.**
  The window's close asks the server to stop, and that request carries no token — so
  with the setting on it was refused and the app fell back to killing the server. The
  shutdown now answers from this machine without a token, as the health check and the
  token settings already did; from anywhere else it is still refused
  ([Settings reference](settings-reference.md))
- **A model whose speculative-decoding draft won't load fails fast when another program
  holds the GPU memory.** It used to restart the AI engine and try again first, which can't
  free another program's memory; now it says at once what is holding it. With nothing else
  on the GPU it still restarts once ([GPU](gpu.md))
- **A speech engine that stops cleanly now logs exit code 0.** Every clean stop used to
  log exit code 1, so a real failure looked the same as a normal one
- **Books in single quotes, guillemets or German marks now have dialogue.** Only
  double quotes used to count as speech, so a book written ‘like this’ was read as
  all narration and no re-analyze could fix it. Overview has a new **Speech marks**
  setting — Auto (the default: each chapter's own), “Double”, ‘Single’, «Guillemets»
  or „German“ — and in single-quote mode an apostrophe (don’t, 'tis) never starts or
  ends a speech ([Studio → Speech marks](studio.md#speech-marks))
- **Edit, split and merge lines on Script.** Tick a line and choose **✎ Edit…** to
  change its words (Undo puts them back) or **Split at the cursor**; tick lines that
  sit next to each other and choose **⇲ Merge**. Merging asks first when it would
  delete rendered takes ([Studio → A line's words](studio.md#a-lines-words-edit-split-merge))
- **An edited chapter re-analyzes as well as it did the first time.** Editing a line —
  the right-click rewrite included — used to make the next Analyze read every line as
  a paragraph of its own, which lost every *"said Marius"* in the chapter and sent all
  of it to the AI. Now a chapter you've edited is read as its lines stand, and what you
  cut by hand is never re-cut ([Studio → Re-analyze](studio.md#re-analyze))
- **Leave out dialogue tags.** A new Overview switch, off by default: the narrator
  skips lines like *"said Marius,"* that only say who spoke, in the chapter audio, the
  M4B and its captions alike. Script marks each skipped line **Left out**
  ([Studio → Leaving out dialogue tags](studio.md#leaving-out-dialogue-tags))
- **One narrator rule.** The narrator is the speaker holding the narrator role —
  nothing else. A speaker merely called "Narrator" used to count on the server but not
  in Studio, so the two could disagree; a custom (plain-text, SRT) import now adopts
  its own "Narrator" as audiobooks and podcasts do. Script's no-speaker banner on a
  book with no narrator links to Cast instead of offering a button that did nothing
  ([Cast](studio.md#cast))
- **Speech engines no longer outlive the app.** An engine used to keep running,
  and keep its GPU memory, whenever the server was closed the hard way — five of
  them held 1.6 GB across four restarts, and the AI model then couldn't load. Now an
  engine exits when its server goes, closing the window shuts everything down
  cleanly, and the server stops any leftovers when it starts. If a model still
  fails to load because of them, the loading screen says how much they hold and
  offers **Stop them and retry**, and a failed model load's message now starts by
  naming whatever else is holding GPU memory
  ([GPU → Engines left over from an earlier session](gpu.md#engines-left-over-from-an-earlier-session))
- **One pause between lines, everywhere.** Studio's Render joined lines with 250 ms
  while the exported audiobook and ACX QC used 600 ms, so the chapter you listened to
  was paced differently from the one you shipped. Both now use **Pause between lines**
  in Settings → Generation pipeline (600 ms by default); a line's own pause from an
  import still wins ([Studio → Render](studio.md#render))
- **A tag the engine can't perform is dropped, not read aloud.** Only the tags the app
  recognised used to be removed, so a `[warm]` was spoken as "warm". Now every
  bracketed tag the rendering engine doesn't list is dropped — on Generate too, which
  used to send text untouched — and Chatterbox Turbo keeps its own. Bracketed text
  like `[sic]` is dropped the same way. The podcast demo loses its `[warm]`
  ([Speech engines](engines.md))
- **Persona names are unique, and a persona must have a name.** A persona is a voice
  in your library, so no two share a name (case and extra spaces don't count);
  creating or renaming into a taken name is refused, and Save stays off while the name
  is blank — the dialog used to save a persona with no name at all. It also makes
  casting by exact name dependable ([Personas → Names](personas.md#names))
- **Engine installs skip a broken uv.** An empty `uv.exe` ahead of the real one on the
  path made every engine install fail with "[WinError 193]". The app now passes over a
  uv that doesn't run, and if none runs it names the bad file instead
  ([Speech engines](engines.md))
- **ACX mastering now meets ACX.** A chapter mastered for ACX used to come out too loud
  — about −17 LUFS with its peak near −0.5 dB — because the dynamics step ran after the
  loudness step and undid it; ACX QC then failed it. The order is fixed: an ACX chapter now
  measures about −20 LUFS with its peak at −3.5 dB, and passes. Render again to get the new
  levels ([Mastering](mastering.md))
- **Speakers and personas are two things.** A **persona** is now a finished spoken
  voice: a voice and its engine, plus speed, pitch, gain, direction, effects,
  lexicon and a short **Note on how it sounds**. It lives in your library and can
  be used in any book. A **speaker** is a person in one book: a name, the other
  names the text uses (**Also called**) and **Who they are**. Discover finds
  speakers, Script gives lines to speakers, and **Cast gives each speaker a
  persona**. One persona can play many speakers, so change it once and all of them
  change. Also called and Who they are moved from the persona to the speaker; in
  place of the character sheet, a persona has its note, which Compose, Rewrite and
  Smart-assign read.
  Cast is now the speakers on the left and your personas on the right, with a
  card for the selected speaker (Name, Also called, Who they are, **Edit their
  persona →**). A new speaker whose name exactly matches a persona in your library
  arrives already cast with it. Removing a speaker (Cast's ✕, or Discover's new
  **Remove from cast** and **Remove N selected**) asks first, because their lines
  go back to no speaker. The persona list's **Used by** column shows who each
  persona plays. Your data was reset for this change: **Load demo** brings The
  Ninth Facet back, and its chapters need Discover and Analyze again
  ([Personas](personas.md), [Studio → Cast](studio.md#cast))
- **The Lab's cast boxes say Speakers, Known speakers and Personas.** They were
  Characters, Known characters and Voices. Only the boxes' names changed — the
  prompts the model reads are word for word the same
  ([AI features](ai-features.md))
- **"Next to check" always finds the line.** It used to look only below the line you
  had selected, so a chapter's one line to check — selected, or above it — got
  "Nothing more to check below". It now wraps around to the top (`Shift+N` to the
  bottom) ([Studio → Script](studio.md))
- **Discover keeps a record of everyone each chapter names.** A scan saves the
  speakers in the cast the chapter names (found by name, without the model), names
  a persona in your library has, and new names — one list, each person once, with a
  status: **In the cast**, **In your library**, **New** or **Ignored**, and chips to
  filter by it.
  Add and Ignore change the status instead of removing the row, so rescanning a
  finished chapter no longer comes back empty. The chapter grid's **Proposed**
  column is now **Found** ([Studio → Discover](studio.md#discover))
- **No book gets a narrator on its own.** Creating or importing a book no longer
  makes a Narrator — every import made a new one, and deleting the book left it in
  your library. Tick **Narrator** on any speaker in the cast, or use **Add
  Narrator**, which makes a speaker called Narrator — cast with your persona called
  Narrator if you have one — and moves the narration with no speaker to it
  ([Personas → The Narrator](personas.md#the-narrator))
- **Speaker names are unique within a book.** One book can't have two speakers with
  the same name; adding or renaming into a clash is refused and says so
  ([Studio → Discover](studio.md#discover))
- **Delete several personas at once.** Tick them in the persona list, then **Delete
  N selected** ([Personas](personas.md#deleting-several-at-once))
- **Switching Studio steps keeps your place in Script.** Coming back finds the same
  chapter or grid, with the same ticks, filters, selected line and scroll — it used
  to start over ([Studio](studio.md))
- **The mastering target shows the real target.** A new project starts on its kind's
  target (ACX for an audiobook, Podcast for a podcast, raw otherwise), so the
  "This kind's default" option — which only repeated one of the others — is gone
- **Overview's "Continue ➜" button is gone.** It repeated the step cards and the
  clickable rows of "Where it stands"
- **The title bar shows both engines.** Beside the voice engine there is now the
  language model the AI features run on (the model's name while it is loaded);
  each opens its settings page. Studio's own "TTS" and "Script" chips, which
  repeated this, are gone, and the "Operational" status is no longer a button
- **Add or ignore several proposed speakers at once.** Discover's Proposed speakers
  list has a checkbox on each name and one to tick them all, then **＋ Add N
  selected** / **Ignore N selected** ([Studio → Discover](studio.md#discover))
- **Discover no longer misses a first-person book's narrator and hero.** Told to leave
  out "the narrator", with a cast member called Narrator, the model dropped Watson
  *and* Holmes from The Speckled Band. Both are found now; the sample books still
  find everyone they did
- **Anyone in the cast can be the narrator.** A first-person narrator also speaks —
  Watson tells *The Speckled Band* and talks in it — so tick **Narrator** on their
  card in Studio's Cast step and their narration and lines share one voice. The speaker
  who had the role stays in the cast; the narration Analyze decided moves with the
  role, and lines you set stay ([Personas → The Narrator](personas.md#the-narrator))
- **Cancelling a voice-model download cleans up before it says "cancelled".** The
  half-downloaded files used to be removed just after, so a download started right
  away could lose its first files
- **The Narrator can be deleted like anyone else.** Deleting it used to fail
  with "persona … is built-in". There are no built-in personas now, and the
  narrator is an ordinary speaker that can leave the cast in Studio. A removed
  narrator stays removed — restarting the app no longer brings one back — until
  **Add Narrator** in Studio's Cast step makes a new one
  ([Personas → The Narrator](personas.md#the-narrator))
- **Script opens on a grid of your chapters.** One row per chapter says how many lines
  it has, when it was analyzed, how many lines the book itself names the speaker of
  and how many the AI decided, how many are flagged and how many have no speaker.
  Filter to the chapters to check, tick them — select-all ticks only what's shown —
  and Analyze runs them one after another; each row fills in as its chapter finishes,
  and the run keeps going while you work elsewhere. A chapter analyzed before someone
  joined the cast, whose text names them, says so and offers Re-analyze
  ([Studio → Script](studio.md#the-chapter-grid))
- **A chapter's page says why each line has its speaker.** "Decided by" shows the
  book's own words when it names the speaker — *“said Marius”* — or "AI, from the
  story around it". Lines where the AI most often goes wrong are marked with a
  question: one person speaking three times with no reply, a speaker's only line,
  the book and the AI naming different people. "Next to
  check" jumps between them; tick lines to set several at once or swap two speakers;
  Undo takes back your changes, including what they would have taught the next
  Analyze ([Studio → Script](studio.md#a-chapter))
- **Speech in straight quotes that runs over several paragraphs is read as speech.**
  Each paragraph of a long speech opens a quote and only the last closes it; with
  straight quotes (`"`) the unclosed paragraphs used to go to the Narrator — a fifth
  of the spoken words in the test book. Curly quotes always worked. A chapter in
  straight quotes analyzed before this gets a different split when re-analyzed
- **"Analyzed" means Analyze ran.** An imported podcast script that names its
  speakers used to count as analyzed; it now shows as *from the import*, and
  Overview says "12 of 12 episodes have speakers · from the import"
- **Links land on the problem.** Overview's and Home's "no speaker" numbers open
  Script's grid on the chapters to check, and a render that stops on lines with no
  speaker offers **Fix in Script ➜**, which opens the chapter on those lines
- **Discover's lists take a ✕.** Each ignored name and each cast member has its own
  ✕, and both lists have **Clear all** (the cast's keeps the Narrator). Restore is
  gone ([Studio → Discover](studio.md#discover))
- **A model reading a chapter no longer freezes the rest of the app.** A Discover
  scan, and the attribution Lab's Analyze and Discover runs, used to hold up every
  other request to JustVoice until the model finished — other pages waited, and a
  status check could time out. They now run beside everything else, as Script's
  Analyze already did

- **The engine's Update button works again.** It had quietly stopped appearing in
  August, when llama.cpp changed how it labels releases — the app compared the new
  label to its own version number, decided you were up to date, and said nothing.
  It now follows llama.cpp's official releases, and also offers the build this version
  of the app is tested with, whichever is newer
  ([AI features](ai-features.md#updating-the-local-engine))
- **An engine update can no longer leave you unable to load models.** Before a new
  engine replaces yours, the app checks that it starts *and* that it accepts the
  settings the app launches models with; if it fails either, your engine is kept and
  the message says what it refused. Updates also work again on AMD graphics cards,
  whose download files upstream had renamed
- **A feature that carries a JSON schema now really gets it.** The app was sending the
  schema in a form the local engine silently ignores, so the answer was only asked to
  be valid JSON, not to match the shape
- **New installs get a newer, tested engine.** The bundled llama.cpp version moved
  forward by about 1,250 builds. We tested it on the 26B model with the kind of requests
  the app really sends, and it runs as fast as the version we had measured before. Your
  existing install keeps the engine it already has until you click Update
  ([AI features](ai-features.md#updating-the-local-engine))

- **Models set to run fully on the graphics card now really do.** The engine
  counts its output layer as a layer, so the app's "every layer" launch was
  leaving the first one on the processor. Fixing it made the 26B model about
  6 % faster (35 → 37 tokens a second) for 50 MB more graphics memory
- **The memory figures in the model catalog are exact now** — "needs … VRAM"
  and the Fit badge come from the model file's real weight sizes, placed the
  way the engine places them, in the same units your graphics card reports.
  Mixture-of-experts models such as Granite and Mixtral are no longer
  estimated as if every weight had to fit on the card
  ([AI features](ai-features.md#picking-models-fit-speed-and-your-override))
- **A designed voice keeps the take you auditioned**, and stays one person for
  a whole book instead of re-inventing itself line by line
  ([Voices](voices.md#keeping-a-designed-voice-is-what-makes-it-one-voice))
- A designed voice you have not kept a clip for now actually reaches the
  model — its description is spoken on every line, with your direction added
  after it ([Voices](voices.md#design--from-a-description))
- A table of **which voice types take written direction**, because it depends
  on how the voice was made, not just which engine you picked
  ([Voices](voices.md#which-of-them-take-written-direction))
- A cast that mixes Qwen3 checkpoints is refused **before** the render starts,
  naming every voice and the model it needs, instead of failing partway
  through ([Studio](studio.md#one-qwen3-model-at-a-time))
- Bracketed tags typed into Qwen3 text are removed rather than read aloud —
  Qwen3 takes direction as words, not markup ([Engines](engines.md))
- Four ways to blend a Kokoro voice — mix, exaggerate, add and subtract, or
  splice one voice's sound onto another's delivery
  ([Voices](voices.md#blend--make-a-voice-out-of-other-voices))
- Voices library filters by language and gender, and shows language as a name
  rather than a code ([Voices](voices.md#finding-a-voice-in-the-library))
- **Any column heading sorts, on every list in the app**
  ([Core concepts](core-concepts.md#lists))
- Loading a model from the Voices page shows the same progress bar, Cancel and
  error as the Speech engines page — and the **Size** dropdown now decides
  which weights are fetched ([Voices](voices.md#finding-a-voice-in-the-library))
- Every slider says what its ends MEAN — *slower · as written · faster* — and
  its number box can be typed into ([Generate](generate.md#delivery-overlay))
- One AI Settings console — text AI (providers + models) and speech (engines,
  self-hosted servers, cloud APIs) with per-feature routing and a live Lab
- Multi-use Project model (audiobook / game voice lines / podcast / custom)
- Managed Python environments for speech engines, built for you on first
  install — **every engine gets its own**, so installing one cannot change
  what another already depends on, and every engine has a real Uninstall.
  Costs far less disk than it sounds: the five environments report 5,284 MB
  but add only 431 MB, because they share one download cache
  (replaced on 2026-10-01 by one speech runtime for every engine —
  [Engines](engines.md#the-speech-runtime))
- See which programs are holding GPU memory: **show apps** on the memory
  strip's *Other apps* cell ([GPU / CUDA](gpu.md#which-apps-are-using-the-gpu))
- A sleeping AI model lends its memory to your speech engine and takes it
  back with a visible swap, instead of both quietly claiming the same card
  ([GPU / CUDA](gpu.md#when-the-ai-model-goes-to-sleep))
- Take versioning with source lineage
- HMAC-signed webhooks with exponential backoff
- Backup / restore from Settings → Backups
- Audio output channels (multi-device routing)
- System tray with full lifecycle controls
- Multi-adapter import (JustWrite / CSV / SRT / Audacity labels / standard JSON)
- In-app help drawer
- Multi-use first-run onboarding (5 audiences)
