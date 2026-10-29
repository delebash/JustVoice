# What's new

## v0.1.0

- **audio.cpp's update of 2026-10-29: new models, flash attention at any precision** — the speech
  engines list now has what audio.cpp added since: Gradium Phonon, LFM3-Audio (speech and speech
  recognition), Ming 3.0 TTS, Ming 3.0 Audio Tiny (speech and speech recognition), XTTS v2 and a
  smaller Fish Audio Drama 3 download, each with JustVoice's reading of its licence
  ([Speech engines → Commercial use, in plain words](engines.md#commercial-use-in-plain-words)). Qwen3-TTS's **Attention** load option is now **Speed mode**, on
  every row, not just the 8-bit ones, with a third choice, *All speed-ups (CUDA)* — flash attention
  plus audio.cpp's other speed-ups for an NVIDIA card, not yet measured by JustVoice. They load with
  `npm run dev` now, and in the installed app once the next speech runtime release ships
- **The dictation pill's focus ring shows on any background (2026-10-24)** — when a failed
  dictation's pill has keyboard focus, its white ring now sits inside a dark one, so it shows over
  light windows as well as dark
- **Whispers under the narration (2026-10-21)** — the speech models whisper at speaking volume, so a
  whispered line is now set a fixed amount under the chapter's narration when the chapter is
  joined: **Whispers under the narration** in Settings → Generation pipeline, 18 dB by default
  (about 15 dB once the chapter is mastered, the gap you picked in the listening test). Render
  marks each such line *Whisper · 18 dB under the narration*; a line with a volume of its own keeps
  it. Nothing renders again ([Studio → Render](studio.md#render))
- **The narrator on BreezeTTS 2 too (2026-10-21)** — **Make the audiobook** now keeps the
  narrator's designed voice on BreezeTTS 2 as well: with the narrator's own voice it read the
  narration better than VoxCPM2 on all 10 passages of the blind listening test. One model now reads
  the whole book; `book_voices.narrator_model` still gives the narrator its own
  ([AI features → Voices from the book](ai-features.md#voices-from-the-book)). A database you
  already have keeps its setting until you reset it or change it
- **Stop stops the language model at once (2026-10-21)** — **Stop** on **Make the audiobook**, and
  **Cancel** on Analyze, now end the language model's answer in progress instead of waiting for it
  (minutes on a long chapter on the built-in model). What was done is kept; Resume does the chapter
  the run was on again ([Studio → Make the audiobook](studio.md#make-the-audiobook)). So does
  **Cancel** on Script's 🔎 Second look, and leaving any AI request whose answer nothing keeps —
  Smart-assign, a persona's Compose and Rewrite, a speaker's Rewrite as them, the voices' gender
  guess and descriptions, the merge of the scanned names, show notes and the Labs' runs. Cancel means
  cancel, as on Analyze, on Discover's scan, direction, the lines with no single speaker and matching
  the rest from your library too: the call stops and nothing of it is kept — closing the window or
  reloading mid-call counts as a cancel there
- **Change folder keeps the old copy until you remove it (2026-10-20)** — Settings → Storage is
  the family's own panel now: after a move it lists the old folder with its size and **Remove the
  old copy**, offers **Move back to the default folder**, and says when the folder is set by
  `JUSTVOICE_DATA_DIR` ([Backup and restore](backups-and-data.md)). Field edges are easier to see
  (3:1 against the page), and in dark mode the buttons' text is dark on the light fills, and
  warning, error and information text is readable on dark cards. A folder you linked into the data
  folder is removed as a link by the reset and by **Clear** — the folder it points to keeps its
  files (they were emptied before)
- **A restore that is all or nothing, and the headless server on macOS and Linux (2026-10-20)** —
  importing a backup swaps the folders and tables in whole or not at all; it first stops what was
  working on your files (a book's run, a render, an export, a take playing), and a change saved
  from another window meanwhile is refused instead of lost
  ([Backup and restore](backups-and-data.md#restore)). `justvoice-server` now comes with the
  macOS and Linux apps too ([Run modes](run-modes.md#headless)). Copy buttons work in a browser on
  another computer; the "Can't reach the server" page says three more reasons it didn't start
  ([Troubleshooting](troubleshooting.md)); Change folder moves the data into a new *JustVoice*
  folder where you point it, and a data folder you name must exist
  ([Backup and restore](backups-and-data.md)). The server answers this computer only under its own
  names (`JUSTVOICE_ALLOWED_HOSTS` adds a reverse proxy's), refuses `*` as a CORS origin, and
  trusts the system's certificates ([Run modes](run-modes.md#headless))
- **The characters on BreezeTTS 2, the narrator on VoxCPM2 (2026-10-18)** — **Make the audiobook**
  now keeps each character's designed voice on BreezeTTS 2, which played every line like the book
  in the blind listening test, and the narrator's on VoxCPM2, which read the narration better.
  The narrator has its own setting, `book_voices.narrator_model`. BreezeTTS 2's licence doesn't
  let you sell what it makes without a separate licence from its makers: the run's card shows
  *Commercial use: Separate licence* beside it before you start, and until its licence is
  accepted on your computer the run doesn't start — **BreezeTTS 2's licence ➜** opens it. The
  same holds for the models that design the voices and read the narration, if you set ones whose
  licence you haven't accepted: the stop names what that model would make
  ([Studio → Make the audiobook](studio.md#make-the-audiobook))
- **Make the audiobook (2026-10-16)** — an audiobook's Overview has one button that turns the book
  into a finished audiobook, unattended: it finds the speakers, merges their names, decides who
  says every line, gives the main speakers voices made from the book and casts the rest from your
  library, directs the lines, renders and checks every take, and exports the M4B. Before it starts
  the card names each step's model and recipe; on a cloud model it shows the estimated tokens and
  price and asks once. It runs on the server — leave the page, close the window, or restart the app
  and **Resume** picks up where it stopped — does only what isn't done yet, never overwrites what
  you set, and afterwards lists what to check, each with a link: Script's marked lines, flagged
  takes, the voices it made. Each step writes down its model, recipe, tokens and time
  ([Studio → Make the audiobook](studio.md#make-the-audiobook))

- **Direction: how each line is said, from the book (2026-10-16)** — a new AI step reads a chapter
  and writes how each spoken line should be said, only where the text gives a reason: one of the
  nine emotions and a few words from the book's own cue, carried to the speaker's other lines in
  the same paragraph. It goes into the line's Style Instructions and Emotion on Render (a tag
  model's own tag), shaped to the model that speaks it, and never over what you set. Two recipes,
  **Local** and **Frontier**, under AI Settings → Routing by feature. No button yet — the one-click
  audiobook will run it; `POST /v1/scenes/{id}/direction` runs it now
  ([AI features → Direction](ai-features.md#direction--two-recipes-and-the-carry))
- **The take check (2026-10-16)** — the one-click run's step after the render: each take in use
  is read back by your speech-recognition model and lined up against the line's words; a take that
  skips words, says the line twice, runs on past its text or runs far too long is rendered again
  once with a new seed, and one that still fails is flagged on its line. For now it runs through
  the API (`POST /v1/scenes/{id}/check_takes`); Render doesn't show its findings yet. Its limits are
  settings, `take_check` ([Studio → Checking takes](studio.md#checking-takes))
- **A model measured on your card is weighed at what it took (2026-10-16)** — the 0.5 GB speech
  margin is for models not measured yet; once a load has measured one here, Auto weighs it at its
  measured size, so BreezeTTS 2 (7.3 GB) runs on an 8 GB card by itself instead of on the CPU at
  0.2× real time ([Engines → The speech margin](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu))
- **A chapter's buttons wait while Make the audiobook works on it (2026-10-16)** — Script's and
  Discover's buttons for that chapter grey out until the run moves on, and Script's row shows the
  step it is on; the price before a cloud run now reads *up to about $…*, the step for lines no
  one person says counted in it ([Studio → Make the audiobook](studio.md#make-the-audiobook))
- **A removed speaker stays out; "Said together" names the whole group (2026-10-16)** — removing
  a speaker now puts the names the scans gave them on the book's ignore list (the question says
  *… won't be suggested again*), so Discover shows them as Ignored and Make the audiobook doesn't
  add them back; the cast card's Clear all ignores no one. Script's "Said together" question names
  everyone the AI said speaks the line ([Studio → Removing a
  speaker](studio.md#removing-a-speaker))
- **Lines several people say are marked even when Analyze named one; direction carries less
  (2026-10-16)** — a line Analyze gave to one of a group (*"Sh! sh!"* — the Hatter and the March
  Hare) is now asked about and marked **Said together** like a blank one, when the words beside
  it say several people speak it. And a line's direction carries to the speaker's next line in the
  paragraph only across their own tag — a new sentence or a new *she went on* stops it
  ([Studio → Lines with no single speaker](studio.md#lines-with-no-single-speaker),
  [AI features → Direction](ai-features.md#direction--two-recipes-and-the-carry))
- **Names merged across chapters; lines no one person says (2026-10-16)** — two steps of the
  coming one-click audiobook, as routes and as cards in AI Settings → Routing by feature: **Merge
  found names** turns every chapter's Discover scan into one list of people (*the Queen* and
  *Queen of Hearts* one person; people named but never heard speaking left out), and **Speaker
  attribution · lines with no single speaker** gives a line several people say at once to one of
  them — or to the narrator when no one is clear — marked to check. No button runs them yet. In
  the AI tasks panel, Discover's scan now carries its feature's own name, `speaker_discovery`
  ([Studio → One list for the whole book](studio.md#one-list-for-the-whole-book),
  [Lines with no single speaker](studio.md#lines-with-no-single-speaker))
- **Voices from the book (2026-10-16)** — the one-click audiobook's voices step, not on a screen
  yet: your language model describes each main speaker's voice from how the book shows them and the
  narrator's from the book's genre and tone; each is designed once on Qwen3-TTS VoiceDesign, its take
  kept as a VoxCPM2 voice and made a persona named after its speaker, with the description and the
  model that wrote it as its note; everyone else is matched from your library. Three routes, one per
  step; a speaker you cast is never recast. Its prompts are on AI Settings → Routing by feature, a
  Local and a Frontier recipe ([AI features → Voices from the book](ai-features.md#voices-from-the-book),
  [Personas → Personas made from the book](personas.md#personas-made-from-the-book)). Smart-assign's
  matches are now cast by the server — nothing changes on Cast
- **A cloud model gets the big-model route (2026-10-16)** — every engine preset has a **Recipe**:
  Local for a model on this machine, Frontier for a cloud account, or set by hand on a feature's
  chip. Speaker attribution's Auto now gives a Frontier model **Direct**; it used to read a cloud
  model's size as 0 B and give it Guided ([AI features → How routing works](ai-features.md#how-routing-works))
- **The Effects chain editor is compact (2026-10-16)** — each step of a chain is one row: its name,
  its settings with their units (*Gain [-2] dB*), then ↑ ↓ Remove; a setting past the effect's range
  is held to it ([Effects → Edit a chain](effects.md#edit-a-chain))
- **A speech model gets more of the graphics card (2026-10-16)** — its headroom on the card is now its
  own 0.5 GB (a setting, `speech_runtime.card_margin_mb`), not the AI model's 1 GB, so a model measured
  at 7.3 GB fits an 8 GB card; and a model you pin to **GPU** is loaded there whatever the margin
  says — its *Runs on* line warns when it may spill into the computer's memory, instead of the load
  being refused ([Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu))
- **Speech runtime v0.9.2-jv.6 (2026-10-16)** — audio.cpp v0.9.2 with JustVoice's changes: its new
  models and renamed settings work in the installed app too (until now only `npm run dev` ran them),
  F5-TTS frees its memory on **Unload**, and F5-TTS and KittenTTS repeat a take for the same seed.
  The runtime row offers **Update to v0.9.2-jv.6**; jv.5 keeps working until you do
  ([Engines → The speech runtime](engines.md#the-speech-runtime))
- **Voices at phone width (2026-10-16)** — the filters fold behind one **Filters** button, which
  says how many are set, so the list keeps its room ([Voices](voices.md#finding-a-voice-in-the-library))
- **The title bar at phone width (2026-10-16)** — the server status shows only its dot (the word,
  *Operational*, is in its tooltip), so the page's name has room
  ([AI features → The AI tasks panel](ai-features.md#the-ai-tasks-panel))
- **New models that didn't work now do (2026-10-16)** — **QwenCleo-ASR** loads (its model and
  its word aligner come from two places, and the load looked for the model in the wrong folder);
  **Pocket TTS French** loads and clones (its load spoke a built-in voice it doesn't have); Pocket
  TTS's built-in voices list English, German, Italian, Portuguese and Spanish, not French, so a
  persona on one can't be saved in French and then stop at its first line; and a model that speaks
  only from a clip — Qwen3-TTS Base, Chatterbox Multilingual, Pocket TTS French — remembers how
  much memory it takes after its first line, even when a render moves straight on to another
  model, where it remembered nothing or far too little
  ([Engines](engines.md#how-fast-and-how-much-memory), [Personas](personas.md))
- **KittenTTS repeats a take with the same seed, and offers one (2026-10-16)** — a fix in
  JustVoice's copy of audio.cpp makes its take on the graphics card repeat as it did on the CPU,
  so it has a **Seed** like every engine. Every engine repeats on the CPU; on the graphics card
  every one but Pocket TTS and Qwen3-TTS, whose take can change slightly with the longest line
  spoken since the model loaded — the words stay the same ([Engines → The seed](engines.md#the-seed))
- **The Engines guide explains the list instead of copying it (2026-10-16)** — it now walks
  through AI Settings → Speech engines part by part: an engine's head and notes, a model's row
  and its chips, its downloads, built-in voices, cloning and design, direction, settings and
  load options, memory before a load, every reason Auto gives for where a model runs, the
  licence words, *Tested by JustVoice* and the recognisers. Each model's own facts are on its
  row, from audio.cpp's description of it; the guide keeps what JustVoice adds and measured
  ([Engines](engines.md))
- **Speech engines, small fixes (2026-10-16)** — a model whose estimate fits your card only without
  the 1 GB safety margin (Qwen3-TTS Base 1.7B on an 8 GB card) now says on its *Runs on* line that it
  tries the graphics card first, where it said nothing; a model too big by its files gives their
  size as the row does (*about 9.5 GB*, not *10*); **Unload model** names the engine it unloaded,
  not its id; Pocket TTS's description and the clone maker's note name French, cloning only; and
  a model's buttons wrap under its chips when the window is narrow, the whole tab stacking at
  phone width ([Engines](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu))
- **A line a speech model can't take is a request error, not a server error (2026-10-16)** — a voice
  it doesn't have or a language it doesn't speak answers 400 with the model's own words, as
  audio.cpp's own refusals already did; before, it answered 500 and was logged as an error
- **Kokoro, KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox, VoxCPM2 and Qwen3-ASR built like every
  other engine (2026-10-16)** — from audio.cpp's own description of their models: their downloads,
  voices and languages come from it. Your voices, personas, saved settings, takes and measured
  memory keep working as they were ([Speech engines](engines.md)).
  - Chatterbox Turbo and Nano also speak their own voice, with no clip: **Turbo (built-in)** and
    **Nano (built-in)** on the Voices page, gender *Not known*
  - New downloads: audio.cpp's own Chatterbox Turbo package (**Chatterbox Turbo (built-in voice
    only)**), Qwen3-TTS Base 1.7B and VoxCPM2 at their original precision, **Pocket TTS French**
    (cloning only — its one voice forbids commercial use), and **QwenCleo-ASR**, a recogniser for
    Egyptian Arabic and Arabic-English speech
  - Before their first load they show what audio.cpp says they need — Kokoro *needs about 1 GB* —
    instead of *memory not measured yet*, and Auto weighs them by it
  - Settings audio.cpp gives a wider range, or none, take audio.cpp's: Chatterbox's **Top p**,
    **Min p** and **Decoder CFG**, Turbo's and Nano's
    **Temperature**, **Repetition penalty** and **Top p**, Qwen3's **Detail temperature** and
    VoxCPM2's runaway settings are number boxes. Where audio.cpp's range is narrower, yours stays
- **Your answers to the review's questions, built (2026-10-15)** — the rest of what JustVoice had
  decided without asking, put right:
  - Script: a speaker you set before a chapter's first Analyze is yours — Analyze gives it to
    every line it marks as speech in that paragraph, and the narration to the narrator (before,
    the first Analyze replaced it); the **Check** column's tag names the kind of check — *No
    reply*, *Only line*, *Book and AI differ*, *From a nearby chapter* — instead of one *To
    check*; a line you set keeps the right paragraph after a re-analyze ([Studio](studio.md))
  - Overview: **Leave out dialogue tags** says it knows English dialogue tags only
  - Render: a render started in another window or app shows when you come back to the window; a
    render over several chapters reads *rendering…* on each, with one progress strip; the greyed
    **🎧 Run ACX QC** says why it waits ([Studio](studio.md))
  - Export: **⬇ Chapter WAVs** works without ffmpeg — the chapters only, and it says so; the
    strip says when **Cancel** stops; an export reads each take once; a check or export stopped
    by deleting its book answers *not found*; every file an export writes keeps the title as
    written — the M4B, the chapters inside **⬇ Chapter WAVs**, the voice-line zip, Overview's
    **📦 Export .justvoice.zip** and a chapter's **⬇ Download** on Render (*3 · The
    Keystone.wav*) — leaving out only the characters a Windows file name can't hold ([Import and
    export](import-and-export.md))
  - Cast: a book with no language offers no voices until you set one — *Set the book's language
    on its Overview first — Cast then offers the voices that speak it.* ([Studio](studio.md))
  - Persona page: when the Version you chose isn't downloaded, the downloaded one keeps speaking
    and the page says so beside **Load** — *Speaks with 0.6B until 1.7B is loaded*. Pocket TTS's
    Version lists only the persona's language ([Personas](personas.md))
  - Lexicons: an IPA symbol Kokoro lacks no longer stops the whole line. Kokoro reads that word
    the normal way, and Save says *Kokoro can't say “ʍ” — it will speak this word the normal
    way.* An entry with both IPA and a phonetic spelling keeps both. **Try a word** plays the new
    word after you change it ([Lexicons](lexicons.md))
  - Speech engines: Auto first checks what other programs hold on your graphics card. A model
    that doesn't fit beside them runs on the CPU and says *other programs are using about 6.3 GB
    of the graphics card — this may be slow on the CPU* (it used to pick the card and be refused
    there); one that fits says *it fits in the card's free memory*. On Windows the runtime row has
    **Card overflow limit (MB)**, 256 unless you change it. A model measured just under your card
    says *more than this card holds with the 1 GB safety margin*. dots.tts's *Source text* /
    *Target text* and Irodori TTS's *No ref* are no longer offered as settings. IndexTTS 2 says
    *Takes a line's direction in words*. A Kokoro blend reads a line in a language Kokoro lacks in
    its own language, as a preset does. **What for?** no longer names API routes
    ([Engines](engines.md))
  - Speech engines: every model listed since 2026-10-15, the speech-recognition models among
    them, now shows JustVoice's own reading of its licence in plain words instead of audio.cpp's
    table. Maya1 and Supertonic 3 are *Conditional*, sanoTTS and VibeVoice *Unclear*, so each now
    asks you to accept its licence before its first download; CrisperWhisper 2.0 and Hviske ASR
    are *Separate licence*; FireRedAudio's speech recognition is *Yes*. Chatterbox's plain words no longer claim a watermark the speech runtime
    doesn't add ([Commercial use, in plain words](engines.md#commercial-use-in-plain-words))
  - Speech engines: every load option audio.cpp lists for a model is on its row, folded under
    **Load options (N)**, each at audio.cpp's own default. Chatterbox Multilingual's
    **Checkpoint** sits on the row itself: *v3* switches its other languages to the newer
    checkpoint. Qwen3's **Attention** and **Decoder weights** stay on the row, 16-bit still the
    default. A model's measured memory is kept per set of load options. Every setting a model
    has is offered: a number audio.cpp gives no top or no bottom is a number box, and the ranges
    are audio.cpp's own — Chatterbox's **Exaggeration** and VoxCPM2's **CFG** start at 0, and
    Qwen3's **Top k**, Turbo's **Top k** and VoxCPM2's **Inference steps** have no top. The
    settings audio.cpp's own screen doesn't show fold under **Advanced (N)** on the persona page
    and in Render. The **Seed** box goes up to the model's own top (4,294,967,295 on most). A
    setting that's a dropdown, a switch or a text field no longer stops a persona from saving
    ([Engines](engines.md#what-each-engine-can-be-tuned-with), [Personas](personas.md#sampling))
  - The AI model: a refusal for lack of the computer's memory names the speech models running on
    the CPU. Claude Opus 5.5, Fable and Mythos can't stop thinking, so thinking **Off** asks them
    to think as little as they can, and the control says *This model always thinks — Off makes
    it think less.* ([GPU](gpu.md))
  - Speech engines: VibeVoice copies a voice from a clip — each line goes as *Speaker 1: …* in
    the voice's clip — and no longer lists a voice of its own, which failed to load; MOSS-TTSD's
    text and clip words are tagged *[S1]*. VieNeu-TTS v3 Turbo is off the list again (it reads
    phonemes from a library the speech runtime doesn't carry, and won't speak without a voice),
    and so is Index-Echo, a Chinese speech translator rather than a recogniser.
    MOSS-Transcribe-Diarize and VibeVoice-ASR Streaming give the words alone, without their times
    and speaker labels. A model that speaks fewer languages than its family lists only its own —
    LFM2.5-Audio's English and Japanese models, GigaAM v3, Kroko, IndexTTS2, each Habibi-TTS
    model's Arabic, VoiceTut-TTS — and each sanoTTS download its one language, picked by the
    persona's as Pocket TTS's is. MOSS-TTS v1.5, MOSS-TTSD, MOSS-VoiceGenerator and IndexTTS2
    now get the line's language; before, it never reached them. A speech-recognition model that
    can't take a recording's language says so in its own words — *this LFM2-Audio checkpoint
    transcribes ja, not en* — where dictation showed it wrapped in code ([Engines](engines.md#languages),
    [Personas](personas.md))
  - Sync: when another computer's changes arrive, the window waits to reload while a dialog is
    open or the cursor is in a text box. Restoring a backup keeps your other computers' newer
    work: a restore used to send the backup's old projects to every paired or cloud-folder
    computer as the newest edits; now the backup keeps its age, the next sync brings the newer
    work back on every computer, and this computer carries on as a new device in sync (a new
    entry in Devices; its old cloud-folder files stay — in its own Devices list the old entry
    reads *‹name› (before the restore on ‹date›)*). It keeps its own sync settings, and while it
    syncs it refuses a backup from another sync library ([Sync](sync.md#good-to-know))
  - Desktop app: one JustVoice server per data folder — a second one says *Another JustVoice
    server is using this data folder (‹path›) — stop it first.* When another program holds the
    port, the can't-reach page says *Port N is in use by another program — close that
    program, then press Retry.*, and **Retry** starts the server again. A
    JustVoice server left on the port is asked to shut down before it is stopped ([Run
    modes](run-modes.md), [Troubleshooting](troubleshooting.md))
  - New project: the table of sources says plainly what each brings in — its file endings under
    its name, **What lands**, and **Says who speaks?** (yes or no) — with no internal field names
    ([Projects](projects.md))
  - Lexicons: the note that only Kokoro speaks IPA is an amber warning under the entries, and how
    many lines the lexicon touches is its own **Affects** card ([Lexicons](lexicons.md))
  - Effects: **Add effect** offers **Chorus**, with Rate (Hz), Depth, Centre delay (ms),
    Feedback and Mix; the Effects page names it in Robotic's chain, where it showed "chorus"
    ([Effects](effects.md))
  - On a phone (a window under 600 px) the title bar is one row: ☰, Back, the page name, the
    status, ✨ and Help; the project's chips, the model pills, the server address and Forward wait
    for a wider window ([Run modes](run-modes.md))
  - Settings → Channels is hidden: routing a persona's audio to an output device of your
    computer isn't built, and nothing used a channel.
    Settings → Limits loses *Request body max bytes*, which nothing used. Re-import's **What is
    this format?** opens the format's help again
  - After your next data reset: personas lose the picture field no screen could set, and lexicon
    entries can store both IPA and a phonetic spelling. Until the reset, saving an entry that has
    both fails.
- **Choices JustVoice made without asking, put right (2026-10-13)** — a review of every rule,
  number and label the app had taken on without your say:
  - Script: the second look keeps a name the AI gave even when it wasn't sure, sends each
    speaker's whole description, and no longer marks the lines it fills as changed by Analyze;
    **Review** opens a chapter before Analyze; a pasted chapter's paragraph lines join at the
    shorter pause within a paragraph ([Studio](studio.md))
  - Render: **Rewrite as** and **Cast** show the speaker's full name; the chapter page and list
    pick up a render started in another window when they next load it; **Cancel** reaches the
    server
  - Export: **Cancel** stops the rendering phase too, a book's title is the file name as written,
    and deleting a book stops its exports and checks ([Import and export](import-and-export.md))
  - Cast: Smart-assign includes a narrator with no persona; **Models to choose from** lists each
    model; voice lists say *Not known* for an unknown gender ([Studio](studio.md))
  - Personas: the persona page offers **Load** whenever the version you chose isn't the one
    speaking; a new voice brings its own language ([Personas](personas.md))
  - Lexicons: ▶ plays an entry with the book's lexicon as a render would, before you save
    ([Lexicons](lexicons.md))
  - Speech engines: a model remembered as not fitting the card can **Try the card again**; the
    clone maker asks for the clip's words for every model that takes them; a setting with no
    default starts empty (a number box), so the model's own default applies ([Engines](engines.md))
  - Settings: the desktop app uses the **Port** you set; the API-docs switch and two tray items
    that did nothing are gone ([Run modes](run-modes.md), [System tray](system-tray.md))
- **One runaway line no longer keeps a voice model from loading (2026-10-11)** — a line that ran on
  far past its text left the speech process holding much more memory than normal, and the app took
  that as what the model needs, so it could refuse to load the model again on your graphics card.
  Such a reading still counts while that process runs, but it is never saved as the model's size
- **A Qwen3-TTS clone with silent gaps in its clip no longer runs on (2026-10-11)** — a clip with
  stretches of pure digital silence (clips joined together, or an edited or gated recording) made
  Qwen3-TTS Base keep talking for minutes and held up every other line. The app now fills those
  stretches with noise too quiet to hear before the clip reaches the model; your clip is kept as it
  is, and nothing changes on the clone screen
- **Speech runtime v0.9.0-jv.5 (2026-10-10)** — speaks exactly as v0.9.0-jv.4; it adds the program
  that does the app's own audio work (effects, speed, gain, pitch, the joins between pieces), so
  the installed app carries it. The runtime row on AI Settings → Speech engines offers **Update to
  v0.9.0-jv.5**; jv.4 keeps working until you update ([Engines → The speech
  runtime](engines.md#the-speech-runtime))
- **The desktop app updates itself (2026-10-09)** — it checks for a new version when it starts;
  **Settings → Updates** says when one is out, **Download** fetches it, and it installs when you
  quit the app (or at once with **Restart now**). On a Mac it opens the release page instead
  ([Run modes](run-modes.md#updates))
- **Speech engines: what each model gives and what it gives up (2026-10-09)** — the tab opens with a
  table from what you want to the engine to use and what it costs you; every model row says how it
  is directed (*written direction*, *tags* or *sliders only*); **What for?** says what speech
  recognition serves ([Engines](engines.md#picking-an-engine-is-picking-what-a-voice-can-do))
- **Effects: drag a chain into order, hear it dry and wet (2026-10-09)** — a persona's effects
  editor moves a step by dragging it; **A / B it** plays one take without the chain and with it, so
  the only difference is the chain ([Effects](effects.md#edit-a-chain))
- **Lexicons: hear an entry, try a word, see what it affects (2026-10-09)** — ▶ beside an entry
  plays it as it will be said; **Try a word** plays a word before and after, in the voice of a
  persona that reads the lexicon; **Affects** counts the lines it changes
  ([Lexicons](lexicons.md#hear-it-before-you-render))
- **New project takes a file (2026-10-09)** — drop a manuscript, an EPUB or a JustWrite book into
  the New project dialog; its name and kind fill in, and Create opens the import review
  ([Projects](projects.md#starting-from-a-file))

- **Sync (2026-10-08)** — your projects, personas and lexicons on every computer: through a
  cloud folder (Dropbox, OneDrive…), by pairing two computers, or with a file carried by hand.
  Every computer works offline and catches up when it can; the audio and the voices stay on each
  computer, and a voice exported and imported keeps its identity, so a synced persona finds it.
  In **Settings → Sync** ([Sync](sync.md))
- **A file that can't be imported says why (2026-10-08)** — a damaged zip, an `.epub`
  missing its parts, or a JustWrite file whose fields have the wrong type was refused with a
  bare server error; each now says what is wrong (*zip file is damaged*, *EPUB has no
  META-INF/container.xml*, *book.json is malformed — 'characters' must be a list*). A CSV
  saved with old Mac line ends (a carriage return alone) now imports instead of failing
  ([Import and export](import-and-export.md))
- **The audio processing moved into our speech runtime's own program (2026-10-07)** — effects,
  a line's speed, gain and pitch, the joins between pieces, trimming and the analyzer now run in
  a small program built from our audio.cpp copy, ready for the app to leave Python. Everything
  sounds the same, sample for sample, except speed and pitch, which use the newest version of
  their library: lines with a pitch, a server-side speed or a pitch-shifting effect render again
  the next time they're rendered; every other rendered line is kept
  ([Effects](effects.md))
- **Small fixes on Render and Studio's steps (2026-10-07)** — a waiting render counts what
  else is ahead (*…on Kokoro, and 12 more lines*); the Render step says how many lines can't
  render (*0 of 4 lines rendered · 8 can't render*); a game's Lines step says *Checking the
  lines…* while it reads them, instead of *No lines yet* ([Studio](studio.md))
- **Render says when a model is loading, and stops for deleted books (2026-10-07)** —
  while a line's model loads, the strip says *loading Qwen3-TTS CustomVoice — 8 s*
  instead of the line rendering for 10–20 s with no reason given. Deleting a book (or a
  chapter, or a line) no longer leaves its lines rendering in the background, each failing
  to save. And a chapter's buttons wait only for that chapter's render — another
  chapter's run no longer greys them out ([Studio → A render's progress](studio.md#a-renders-progress))
- **A waiting render says what it is waiting for (2026-10-07)** — a render held
  behind other work showed every line *queued* and nothing else; its strip now
  says what is ahead: *waiting — 2 · Bigger Inside is ahead: 40 lines on
  Chatterbox Turbo*, or *waiting — the M4B export is rendering 12 lines first*
  ([Studio → A render's progress](studio.md#a-renders-progress))
- **Render's chapter list pauses and plays on (2026-10-07)** — a finished chapter's
  **▶ Play** becomes **⏸ Pause**, with a seek bar in its row, like a take's on the
  chapter's page; it had a player of its own before. The project export (Overview) no
  longer takes an *include masters* option, which wrote nothing — mastered chapters are
  Export's **⬇ Chapter WAVs (zip)** ([Studio → Render](studio.md#render))
- **⬇ Chapter WAVs (zip) holds chapter WAVs, and voice previews stop pausing a second
  between sentences (2026-10-07)** — the button saved the project package; it now makes
  each chapter's WAV and its mastered WAV, with the same progress strip and Save dialog as
  the M4B. Voice auditions join their pieces at a natural pause, like a line does
  ([Import & export](import-and-export.md#audiobook--m4b))
- **Export asks where to save, and shows its progress (2026-10-07)** — **⬇ Export M4B**
  now shows each chapter as it is mastered, then the encode, with Cancel; and both exports
  open a **Save** dialog for the folder and file name and say where the file went, with
  **Open folder**. Before, the desktop window saved nothing and said "exported" anyway.
  Long lines' pieces also join at a natural sentence pause now (about a quarter second,
  where a line over 240 characters used to hold a second of silence); lines already
  rendered keep theirs until **↻ Re-render all** ([Import & export](import-and-export.md#audiobook--m4b))
- **The pause between lines is the pause you hear, and a paragraph's lines join
  closer (2026-10-07)** — each take's own silence (Kokoro pads about a second per
  line) is trimmed as a chapter is joined, so 600 ms between lines plays as 600 ms,
  not about 1.6 s; and the lines Analyze cuts from one paragraph — a quote, its
  *she said*, the rest — are joined with the new **Pause within a paragraph**
  (Settings → Generation, 250 ms). Every chapter joins this way at once; nothing
  renders again ([Studio → Render](studio.md#render))
- **Render shows its progress, and mastering works again (2026-10-07)** — while
  a chapter renders, its strip names the line rendering now and shows the audio
  made, its speed against real time and the time left; on the chapter's page
  that line is lit and the rest of the run reads *queued*, and the counts and
  chips fill in as each line lands, wherever the render was started. The chapter
  list shows the same strip. Mastering no longer fails with *ffmpeg failed (exit
  3221225794)*, and a failure says that every line's take is kept
  ([Studio → Render](studio.md#a-renders-progress))
- **Render plays a take every time you press ▶, and the take in use can be
  deleted (2026-10-07)** — a take's ▶ worked only the first time; now each ▶
  on Render (a line's, a take's, Compare's) turns into ⏸ while it plays, with a
  seek bar in its own row instead of a second player under the takes, and one
  thing plays at a time. Play chapter's controls show under its button. **🗑**
  on the take in use asks first and puts the newest take left in use — or, for
  a line's only take, sends the line back to Ready. Voices plays through the
  same player ([Studio → Render](studio.md#takes))
- **Cast's ＋ New persona shows who it left out (2026-10-06)** — the speakers
  your language model matched no voice to come first in the list, tagged **No
  voice yet**, with a line naming them; after **Create**, the message names
  anyone still without a persona ([Studio → Cast](studio.md#cast))
- **Cast chooses from the models you tick (2026-10-06)** — beside Smart-assign
  and ＋ New persona, **Models to choose from** lists the models with voices in
  the book's language; both buttons offer only voices on the ticked ones, so a
  cast stays on one model unless you tick more. It starts on the narrator's
  model, and is saved per book ([Studio → Cast](studio.md#cast))
- **Script never adds speakers, and speakers say where they came from
  (2026-10-06)** — Script no longer adds a speaker. When its second look hears
  someone who isn't in the book, the chapter's banner says *Sedge may speak here
  but isn't in this book — scan Bigger Inside on Discover to add them ➜*, and
  Discover opens with that chapter ticked to scan. Discover's **The book's
  speakers** is in two groups, **From the book** (the import's characters) and
  **Added here**, and Cast's cards carry the same label
  ([Studio → Discover](studio.md#discover))
- **Analyze leaves the second look to you (2026-10-06)** — Analyze now does its
  main pass only; a spoken line it can't place says *No speaker — a candidate
  for 🔎 Second look* in Script's Check column, and the chapter's 🔎 Second look
  asks about those lines when you choose. A line it asked about and still
  couldn't place says *Second look found no one*. Analyze's own second look is
  a switch on Speaker attribution's Auto page, now off
  ([Studio → The second look](studio.md#the-second-look))
- **The AI strip shows a model thinking (2026-10-06)** — Analyze's model reasons
  before it answers; the strip now says **thinking…** with its tokens, and *first
  token* is its first thought — about 7 s on The Keystone, where it had read 27 s
  ([AI features](ai-features.md#ai-tasks--where-they-show-and-the-panel))
- **Script's Check column leads with a tag (2026-10-06)** — red **⚠ No
  speaker** where a line can't render, amber **To check** where it is only worth
  a look; the question follows in smaller text ([Studio → Script](studio.md))
- **The setup and the AI strip stop overstating (2026-10-06)** — the LLM engine
  setup's Apply says *Setting up your model* for one model, says *both download
  at once* only when two models both download, and drops *A model is several
  gigabytes…* when nothing downloads. An AI task's tokens per second shows once a
  second of output has arrived — the first tokens had read as *3000.0 tok/s*
  ([AI features](ai-features.md#ai-tasks--where-they-show-and-the-panel))
- **A reset no longer re-downloads the AI model (2026-10-06)** — when no choice
  is saved (a new install, or after a reset) and JustVoice's own AI-files folder
  holds no finished model, it starts on the files JustWrite already holds by
  itself and remembers that; the LLM engine setup shows that choice with **Keep
  a separate copy** beside it. The setup only ever offers another app's files,
  and counts a model only once its download finished — a half-finished download
  had made JustVoice's own empty folder look like the copy to share. Cancelling
  every download now says *Setup stopped* with Back and Close, instead of an
  empty box ([AI features](ai-features.md))
- **🔎 Second look at just the blank lines (2026-10-06)** — on a chapter in
  Script, the *lines have no speaker* banner can ask the AI again about just
  those lines, with the chapters either side, instead of re-analyzing the whole
  chapter: after you ＋ Add someone who was missing, or for a speaker the book
  names in another chapter. Nothing else in the chapter changes
  ([Studio → Second look](studio.md#-second-look--just-the-blank-lines))
- **Analyze says when it's on its second look (2026-10-06)** — the strip of a
  chapter's Analyze shows **second look · 2 of 6 lines** with a bar while it asks
  again about the lines the main pass left blank, keeps counting tokens, and no
  longer says *stuck* while that runs; hover the count for what the second look
  is. Cancelling during the second look now keeps the main pass's speakers
  instead of throwing the run away ([Studio → The second look](studio.md#the-second-look))
- **A pause at a scene break, and a Lexicons editor that says what it needs
  (2026-10-06)** — a book from JustWrite pauses longer where one of its scenes
  ends inside a chapter: **Pause at a scene break** in Settings → Generation
  pipeline, 2 seconds by default, in Render, the export and ACX QC alike
  ([Studio → Render](studio.md#render)). The Lexicons editor marks what is
  required, says under each box what it is for, and **Save** takes along an entry
  still typed in the form — one typed halfway stops Save and the footer says what
  it lacks (it used to say *saved* and drop it) —
  [Lexicons](lexicons.md#make-a-lexicon-and-add-entries). Smaller: Compare shows
  take A and take B side by side, the same width each; the Stories tab is gone (a
  placeholder for a timeline that isn't built); the YouTube target says MP3, which
  is what it always encoded; the voice engine setup wizard adds up its download
  size from the engine catalog; and the Effects page's description no longer
  names a library that was removed in July
- **Home and the Cache page say what they mean (2026-10-06)** — Home's
  *Load your first voice model* banner shows only on a first run, not whenever
  no model is loaded; each recent generation names the persona that spoke it
  instead of *?*; and the Cache page's **Engine** and **Model** columns name
  the engine and model that rendered each line (every render was saved as
  *managed*; older ones read *not recorded*)
- **Home's memory reads like AI Settings (2026-10-06)** — Home's model
  card showed *VRAM NaN / 8 GB*, a none/loaded tag, the voice model a second
  time, *no external providers* and Unload / Switch buttons; it now shows AI
  Settings' memory cells and nothing else — **VRAM used**, **Free**, **LLM**,
  **TTS** and **STT**, each with the model it holds — kept up to date while Home
  is open ([GPU](gpu.md)). On Speech engines, **Set as default** on a
  model's row now calls it the engine's default *version* — the persona page's
  word for the same choice
- **Languages by name, one name per kind, one name per mastering target
  (2026-10-06)** — every language filter lists a language once (*English*, not
  American and British apart); Voices' column is **Voice's language**; Speech
  engines and the capture language say names, not codes, and Captures shows the
  capture language Settings holds. A project's kind reads **Audiobook**,
  **Game**, **Podcast** or **Text** everywhere, and Projects counts each row's
  chapters in its own kind's word. The mastering target is named the same on
  Overview, the top bar, Render and Export (Export showed *acx*), and Export's
  package says **✓ ACX pass** or **✗ out of spec** after a check. Smaller words
  line up too: *no voice yet*, *— no speaker —*, *not analyzed yet*
- **The take in use, and one set of words for a line's state (2026-10-06)** —
  on Render a line's takes show **★ In use** on the one the chapter plays, and
  **★ Use this take** on the others; Compare offers **★ Use take B**.
  **Rendered** now always means a take made from what the line is now — stale
  lines are counted apart everywhere — and every count names its unit
  (*412 of 2,140 lines rendered*, *9 of 10 speakers cast*). Lines that can't
  render say **can't render** on Cast and the Overview too, and a speaker with
  no persona reads **needs a persona**. Studio's step cards say what the
  Overview's rows say ([Studio → Render](studio.md#render))
- **One wording per fact: how a voice is directed, its type, its model and
  gender (2026-10-06)** — the persona page says how a model can be directed in
  the Voices list's words (**✓ written direction**, **✓ 7 tags**, **sliders
  only**), its This model card shows that one tag, and the clone and design
  makers' notes match; *preset* is **Built-in** everywhere; Voices filters by
  **Model** name, not engine id; the top bar and Home's **Loaded model** card
  name the loaded model (*Kokoro 82M*); a voice whose gender isn't known says
  **Not known** on every screen
- **Speaker, persona and Cast each mean one thing (2026-10-06)** — a
  **speaker** is a person in the book, a **persona** is a voice from your
  library (written *persona June* beside a speaker), and **Cast** is the step
  that gives a speaker a persona. Discover's *In the cast* is **In this book**,
  its card **The book's speakers**, **Remove from cast** is **Remove from
  book**; Cast's card reads *persona June · Qwen3 · 61 lines* and **✕ Clear
  cast** is **✕ Clear personas**; Render's line reads **Speaker** [Nettle ▾] ·
  **Cast:** persona June; *Rewrite in character* is **Rewrite as the speaker**;
  Qwen3's *nine speakers* are its nine built-in voices. Cast's narrator note now
  says the narrator reads the prose *outside* quote marks, and Import review
  names Discover as the step that finds speakers
- **Render's grid shows the model (2026-10-06)** — a **Model** column, and
  **Can be directed** in the Personas and Voices lists' own words (*sliders
  only*, *✓ written direction*, *✓ 7 tags*) instead of *Kokoro takes no
  direction* ([Studio → A chapter's lines](studio.md#a-chapters-lines))
- **Render: Rewrite for the narrator, the line's Style Instructions, ✎ Edit
  words (2026-10-06)** — **✏️ Rewrite** works on narration as the narrator
  would tell it; a line's own direction is the persona page's **Style
  Instructions** field, in the open line, with a **↺**; and **✎ Edit words**
  changes a line's text right on Render ([Studio → Pronunciation and Rewrite in
  character](studio.md#pronunciation-and-rewrite-as-the-speaker))
- **Render overrides (2026-10-06)** — an open line has a box with the persona
  page's controls for its model, and only those: pace, pitch, gain and pause on
  every model, Style Instructions, Emotion (and a tag model's Register) and the
  model's own Sampling settings where the model has them. Each starts as the
  persona's, has a **↺**, and **↺ Reset to default** clears them all. It
  replaces the closed **⚙ Override the numbers** toggle
  ([Studio → Render overrides](studio.md#render-overrides))
- **Cast shows who still needs a persona; Script's checks in amber
  (2026-10-06)** — the Speakers head has **All** and **No persona** chips:
  click **No persona** to see only the speakers left to cast
  ([Studio → Cast](studio.md#cast)). On Script, the **Check** column's
  questions read in amber, so a line waiting on you stands out
  ([Studio → The marks](studio.md#the-marks-where-to-read-closely))
- **Cast's ＋ New persona lets you pick a voice it couldn't match, and three
  fixes (2026-10-06)** — a speaker the language model matched to no voice gets
  a **Voice** list in the proposals instead of "cast them yourself"
  ([Studio → Cast](studio.md#cast)); the "Can't reach the server" page now opens the
  app on its own once the server answers ([Troubleshooting](troubleshooting.md));
  Settings → Logs names the folder the log is really in; and Settings → Updates
  shows the version and release notes only — its update check, which always
  answered "latest", is gone until JustVoice has a real updater
- **Analyze takes a second look at lines it leaves with no speaker
  (2026-10-05)** — each one is asked about again with the chapters either side,
  where a speaker unseen in one chapter is often named. What it finds is marked
  to check (*Found in a nearby chapter — is it Odeline Marran?*), and someone it
  finds who isn't in the cast is offered on the chapter's banner: **＋ Add Old
  Sedge**. Only blank lines cost time, about 5–15 seconds each ([Studio → The
  second look](studio.md#the-second-look))
- **The title bar gives way in order, the project export works, and Personas
  sorts by any column (2026-10-05)** — short of room, the server address goes
  first, then the project's name in its chip ends in "…", then the two model
  pills, the page name last (at 1280 px nothing spills off any more); **📦
  Export .justvoice.zip** no longer fails on a book whose personas were made by
  Cast's **＋ New persona for the N with none**; and every Personas column sorts
  when you click its label ([Personas → The list](personas.md#the-list))
- **Five small fixes (2026-10-05)** —
  - the title bar keeps the page's name (about 16 characters) and shortens the
    voice-engine and AI-model pills first, with the full name on hover;
  - Settings → Capture saves: **Capture language** and the three **Cleanup**
    switches go to the server; the controls that saved nothing (Refinement mode,
    auto-paste, playback voice, the Hotkeys card) are gone
    ([Dictation](dictation.md));
  - IPA in lexicons says who speaks it — *IPA · Kokoro only* on Lexicons, and a
    persona's word-replacement count skips IPA-only entries its model can't take
    ([Lexicons](lexicons.md));
  - the project export saves as `<name>.justvoice.zip`, and the docs no longer
    promise an import;
  - Voices gains **⋯ → ⤓ Export…** and **⤒ Import voice…**, and a voice file now
    carries its model ([Voices](voices.md#the--menu))
- **Edit a chapter's text from Script's grid (2026-10-05)** — **⋯ → ✎ Edit
  text** reopens the text you pasted or imported, before or after Analyze: lines
  you leave as they are keep their speaker and takes, changed paragraphs become
  new lines and the row offers **Re-analyze**. A chapter now opens before
  Analyze, so you can read it and fix its words first ([Studio → Adding and
  arranging chapters](studio.md#adding-and-arranging-chapters))
- **Leaving Tags puts a persona's Type back (2026-10-05)** — Tags moves *Type*
  to *Cloned* (no built-in voice takes tags); going back to Any or Sliders only
  now returns it to *Built-in* instead of leaving an empty list
  ([Personas → Voice](personas.md#voice))
- **A persona's Voice box empties when a filter leaves its voice out
  (2026-10-05)** — pick a Kokoro voice, set *Model* to KittenTTS, and the box
  goes back to *Pick a voice* instead of keeping the Kokoro voice; **↺ Revert**
  brings the saved voice back. Every language filter now starts on **Any
  language** ([Personas → Voice](personas.md#voice))
- **A persona's "Made by" is now "Type" (2026-10-05)** — the word Voices uses —
  with **Trained** beside Built-in, Cloned, Designed and Blended (off until voice
  training is rebuilt), and **🧪 Train a LoRA** gone from Save
  ([Personas → Voice](personas.md#voice))
- **One set of words for a voice's type (2026-10-05).** **Built-in · Cloned ·
  Designed · Blended** on every screen — Voices' chips and Type column, a
  persona's **Made by**, Speech engines, Quick setup. Voices said *Preset* and
  listed *Imported* apart (an imported voice is a clone); the persona page said
  *Clone from audio*, *Design from words* and *Blend* ([Voices](voices.md))
- **A persona shows which version of its model speaks it (2026-10-05).**
  **Version** beside the voice — *1.7B*, *0.6B (16-bit)* — with *Speaks with
  Qwen3-TTS CustomVoice 1.7B · loaded* under it. Changing it sets that model's
  default for every persona on it, and **Load** swaps the loaded version
  ([Personas → Voice](personas.md#voice))
- **Filters narrow each other (2026-10-05).** On Voices, Cast's persona list,
  the Personas list, the blend maker, a persona's Voice card, and Script's and
  Render's chapter pages, each filter lists only what the others leave, with
  counts that match the list — *kokoro (54)* + Written direction, or *No speaker*
  + a speaker, no longer give an empty list. A choice nothing fits stays with
  **(0)**. A persona's Voice card keeps its layout, and each part now carries a
  line saying what it means ([Personas → Voice](personas.md#voice))
- **Picking a voice on a persona's page sets what it speaks (2026-10-05).**
  **Speaks** becomes the new voice's own language — it used to keep the old one
  whenever the model could speak it, so an English voice left a persona speaking
  Chinese. The voice filters only narrow the list: the persona's own voice stays
  in the box when they hide it, and the filter is now **Voice's language**, so
  it can't be mistaken for Speaks ([Personas → Voice](personas.md#voice))
- **The persona page: Style Instructions, and Hear it above Save (2026-10-05).**
  *Standing delivery* is now **Style Instructions**, marked *(optional)* where
  the voice's model takes written direction. **Hear it** moved down to just
  above **Save**, so everything that shapes the sound is above the box you hear
  it in ([Personas → Style Instructions](personas.md#style-instructions-the-words-that-change-the-performance))
- **Generate is gone (2026-10-05).** Everything it did lives elsewhere: a
  persona's **Hear it** speaks a typed line with its pace, pitch, gain, tags and
  lexicon, and has **✏️ Rewrite** and **🎲 Compose**; Voices' test line plays any
  voice. Captures' **Speak again** opens Voices with the transcript in that test
  line. Its History went too, with the ★ favorite (and Cache's *Prune
  unfavorited*); Home's **Recent generations** stays. The server's `/v1/generate`
  is unchanged ([Import and export → Single render](import-and-export.md#single-render--wav))
- **New personas for a whole cast, and Rewrite and Compose on the persona page
  (2026-10-05).** Cast's **＋ New persona for the N with none** proposes a voice
  for each speaker with no persona — you see the list, hear each voice, untick
  any — then makes and casts a persona per speaker, named after them
  ([Studio → Cast](studio.md#cast)). The persona page's **Hear it** gained **✏️
  Rewrite** and **🎲 Compose**, and its Lexicon field counts the words it would
  replace in the typed line ([Personas → Hear it](personas.md#hear-it))
- **Render changes a line's speaker; a persona shows its gender (2026-10-05).**
  Render's **Spoken by** is Script's speaker list; the persona page shows the
  gender it gets from its voice and warns when that isn't known (Smart-assign
  can't match it); Cast's **＋ Add** says it's for someone Discover missed
- **A page shows only its own AI tasks (2026-10-05).** Discover shows only its
  scan and Script only its Analyze — banner, strip, rows and counts — so
  Discover no longer looks busy while Script runs; a step queued behind the
  other says *waiting for Script to finish* (or Discover), and its **Cancel**
  stops only that step. A chapter Script is analyzing can be ticked on Discover.
  The banner is the batch (*🔍 Discover · scanning 4 chapters · 1 of 4 done*),
  the strip under it the chapter being read now (*Discover · scan · The
  Keystone*). The strip that sat at the top of every page is gone: each task
  shows on the page that started it, and the ✨ button in the title bar counts
  everything ([AI features → AI tasks](ai-features.md#ai-tasks--where-they-show-and-the-panel))
- **A demo project opens like any new project (2026-10-05).** **＋ New project →
  a demo project** now opens the demo in Studio on its Overview, and the sidebar
  switches to its kind. Before, after a reset, the app stayed on Projects and
  the sidebar kept every kind's tabs — Lines and Stories beside an audiobook
  ([Projects → Demo projects](projects.md#demo-projects))
- **A book with narration gets a narrator (2026-10-05).** Discover lists
  **Narrator** first among the speakers found, ticked, while the book has none;
  Script's **Analyze** asks for one before it runs (**＋ Add Narrator and
  analyze**); and a book analyzed without one shows a single banner with **＋ Add
  Narrator** instead of a red *No speaker* on every line of narration
  ([Studio → Script](studio.md#script))
- **Discover shows its run (2026-10-05).** The run banner — which run, the chapter
  it is on, done of total, time left, Cancel — shows on Discover as on Script, the
  strip follows the chapter running now, and a chapter Script's Analyze has says
  *analyzing…*, not *scanning…* ([Studio → Discover](studio.md#discover))
- **The header and Script see a language model the moment it loads (2026-10-05).** After the
  LLM engine setup or AI Settings loaded a model, the header kept saying *No language model*
  and Script kept saying *Analyze needs a language model* until a restart. Both now follow
  AI Settings' own list of models — loading or unloading anywhere shows at once
- **Render works line by line, and keeps every take (2026-10-04).** Studio ·
  Render is a chapter grid that opens a chapter's lines. Each line shows its
  state — *needs a speaker*, *needs a voice*, *ready*, *rendered* or *stale* —
  and how it is said: written direction on Qwen3-TTS and VoxCPM2, the persona's
  tags on Chatterbox Turbo and Nano. Every render is a kept take with its audio;
  the ★ take is what the chapter plays and the book ships. **↻ New take** reads
  a line with a new seed, **⚖️ Compare two** plays two takes, and **⚙ Override the
  numbers for this line** sets its own pace, pitch, gain and pause. A changed
  line, persona or lexicon entry makes a line *stale* — it keeps its take until
  you render it again, and Export says how many are stale. **📕 Pronunciation**
  opens the book's lexicon (making one if the book has none), and **Rewrite in
  character** moved here from Script's right-click
  ([Studio → Render](studio.md#render))
- **Chapters are added and arranged in Script (2026-10-04).** **＋ Add chapter**,
  and **Rename · Move up · Move down · Delete** in each row's ⋯ menu; **＋ Add text**
  pastes a new chapter's text. The Chapters page and its sidebar item are gone
  ([Studio → Adding and arranging chapters](studio.md#adding-and-arranging-chapters))
- **Qwen3-TTS uses 16-bit decoder weights by default (2026-10-04).** About 0.5 GB
  less while it speaks; in a listening test at the same seed no difference could be
  heard. Choose 32-bit under **Decoder weights** on a model's row to go back
  ([Engines → Options on a model's row](engines.md#what-each-engine-can-be-tuned-with))
- **Speakers have pronouns (2026-10-04).** The selected speaker's card on Studio ·
  Cast has **Pronouns** — he/him, she/her, they/them, it/its or not set. Script's
  Analyze is told each speaker's pronouns, so *"she said"* can only be someone who
  is *she*, and Smart-assign reads them too; they are never heard. A JustWrite
  import fills them from the character sheet, which until now dropped them
  ([Studio → The selected speaker](studio.md#the-selected-speaker))
- **Speech runtime v0.9.0-jv.4: everything built since the switch (2026-10-04).**
  Chatterbox Turbo and Nano clone voices again and read their 19 inline tags;
  Chatterbox speaks Hebrew, Russian, Chinese and Japanese (23 languages); Kokoro
  gets its five Japanese voices (with the optional Japanese dictionary, on its own
  row under the runtime row); Kokoro blends play; a lexicon's IPA reaches Kokoro as
  the word's own pronunciation; Qwen3-TTS's memory fixes reach the packaged app;
  and a newly downloaded model joins its process without restarting it. On macOS
  and Linux, Japanese no longer needs MeCab installed on the computer — it comes
  inside the runtime. An installed runtime keeps working; the runtime row offers
  **Update to v0.9.0-jv.4** ([Engines → The speech runtime](engines.md#the-speech-runtime))
- **Voice engine setup has two tiers (2026-10-04).** *CPU / low VRAM* and
  *8 GB+*: Qwen3-TTS moves into the 8 GB+ tier beside Chatterbox — given lines in
  200-character pieces it fits an 8 GB card, where it and the AI model take turns.
  It started a 12 GB tier of its own before, from a peak measured with whole
  lines ([Voice engine setup](quick-setup.md#hardware-tiers))
- **More of each speech model's settings (2026-10-04).** New advanced knobs:
  Chatterbox's **Min p** and **Decoder CFG**, Qwen3's three **Detail** settings
  for the part of the model that fills in each frame's finer audio, and
  VoxCPM2's **Tries on a runaway** and **Runaway limit**. Each starts at the
  runtime's own default. Qwen3-TTS models also get **Options** on their row on
  Speech engines — **Attention** (flash attention: about 9 % faster and 0.2 GB
  less, 8-bit models only) and **Decoder weights** (16-bit: about 0.5 GB less)
  ([Engines → What each engine can be tuned with](engines.md#what-each-engine-can-be-tuned-with))
- **Takes, seeds and settings say what they do (2026-10-04).** An empty seed is a
  new take on every engine — Kokoro used to repeat its last one, VoxCPM2 and
  Chatterbox Turbo a fixed one. Generate's **Temperature** starts at the loaded
  model's own default and never reaches 0, which Qwen3 refused and Chatterbox
  broke on; Chatterbox's **Repetition penalty** shows the 1.2 it uses, not 2.0. A
  Qwen3 line with no language, or one it doesn't speak, lets the model pick
  instead of reading it as English, and speech recognition gets each language's
  name and gives a long recording the time it needs
- **The speech runtime installs and recovers more safely (2026-10-04).** Every
  runtime file is checked against its published checksum before it is unpacked,
  a stopped download resumes, and **Reinstall** on the runtime row fetches it
  again for a runtime that won't start. Each model file is checked against its
  repository's checksum. The CPU build is the portable one, for older
  processors. A line that needs a newer runtime says what it needs and whether an
  update brings it; the persona page's **Blend** is off until the runtime can
  play a blend (before, one saved and never played). Errors keep their kind — a
  busy or out-of-memory runtime is not reported as a broken request — and a
  runtime that stops mid-line says so with the end of its log
  ([Engines → The speech runtime](engines.md#the-speech-runtime),
  [Troubleshooting](troubleshooting.md))
- **Where a model runs, and what it leaves behind (2026-10-04).** Auto's CPU
  check uses the best of a model's last five speeds at the current thread count,
  so one slow line no longer keeps it off the CPU for good; the 16-bit Kokoro and
  Pocket TTS rows have CPU speeds of their own; on a Mac, models stay on the
  graphics and the row says why. A clone's preview clip, an oversized upload and
  old blend files no longer pile up in temporary folders, and the runtime's logs
  roll over at 10 MB. The runtime's start and request time limits and its
  graphics process's threads are settings now
  ([Settings reference](settings-reference.md))
- **Qwen3-TTS needs gigabytes less while it speaks (2026-10-04).** Three fixes
  in our copy of the speech runtime: it no longer holds two copies of its audio
  decoder's work while switching line lengths, its first pass over a line reuses
  memory instead of holding every step at once, and a cloned voice no longer
  decodes its whole reference clip again with every line. The same audio
  (a clone's changes imperceptibly), the same speed, and up to 2.3 GB less at
  the peak — a cloned voice's line now needs about 1.7 GB beyond the model
  itself. In the version `npm run dev` builds now; in a packaged app with the
  speech runtime's next release ([Engines → Long lines](engines.md#long-lines-and-what-a-model-costs))
- **Qwen3-TTS fits an 8 GB card (2026-10-04).** A model's memory grows with the
  length of what it is given, and long lines went to it whole: a 752-character
  line peaked at about 7 GB. Each model now gets lines in pieces of its own
  length — 200 characters for Qwen3-TTS CustomVoice and Base and VoxCPM2, 240
  for Kokoro — joined with a crossfade, at the same speed. What a model costs is
  measured for exactly that model at that length (its first load on the card
  speaks one full-length warm-up piece), and a load is checked against it before
  anything happens: a load that can't fit no longer downloads the model or
  unloads the AI model first. A voice made from words now keeps one voice — the
  same seed on every piece and line ([Engines → Long lines](engines.md#long-lines-and-what-a-model-costs))
- **Downloading a model no longer stops the other one (2026-10-04).** Speech
  and speech recognition each run in a process of their own, so downloading or
  deleting a model never touches the other's — before, the first download of
  any model restarted the runtime and silently unloaded the speech-recognition
  model, which then couldn't load again until the app restarted ("not enough
  memory … Resident: stt:asr"). A model whose process stops is no longer left
  holding memory it doesn't use. **Cancel** on a model load now answers at
  once, even mid-load, and the app stays responsive while a model loads. From
  the speech runtime's next release (the build `npm run dev` makes has it
  already), a newly downloaded model also joins its own process without
  restarting it ([Speech engines](engines.md))
- **Kokoro and KittenTTS use the eSpeak NG the app installs (2026-10-04).**
  They read text through eSpeak NG, which installing the speech runtime
  downloads — but they were never told where it was, so they used another
  copy installed on the computer, and failed on a computer without one. They
  now use the app's own copy. On Linux (x86_64) installing the runtime now
  finishes; it stopped at eSpeak NG before ([Speech engines](engines.md))
- **A book has a language, and Cast checks it (2026-10-03).** Set it on New
  project or Studio · Overview; a speaker whose persona speaks another language
  shows **⚠ speaks Korean — the book is English** on their card. Cast's persona
  list reads each persona's model, language and how it can be directed (the
  Personas page's words), filters by all three, and **▶ plays the persona**,
  not just its voice. **＋ New persona** on Cast opens a blank persona and,
  on Save, comes back with it given to the selected speaker
  ([Studio → Cast](studio.md#cast))
- **Voices shows what each voice can do (2026-10-03).** New columns: **Model**
  (the model that speaks it, not just its engine), **Speaks** (its language,
  with **+N** when its model speaks more), **Can be directed** and **Used by**
  (the personas built on it), and a **Can be directed** filter. Each row's
  **⋯** has **New persona from this voice**, **Copy to another model…** (the
  same clip as a second voice on another model, checked first for what that
  model needs) and Delete, which now names the personas that lose their voice.
  Every voice dropdown in the app reads *Sohee · Female · Korean · Qwen3-TTS
  CustomVoice* ([Voices → Finding a voice](voices.md#finding-a-voice-in-the-library))
- **The Personas list shows how each persona sounds (2026-10-03).** New
  columns: **Built on** (the voice and how it was made), **Model**, **Can be
  directed** (written direction, the model's tags, or sliders only), **Speaks**
  and **Shaped** (`1.05× · −1.0 dB · 2 effects`). **▶** plays the persona
  itself — not just its voice — asking before it loads a model. Filters for
  model, direction, language and use (All · In use · Unused · each book)
  replace the All / Used / Unused / By project chips. Each row's **⋯** has
  Edit, Rename, **Merge into…** (fold one persona into another — its speakers,
  lexicons and takes move) and Delete
  ([Personas → The list](personas.md#the-list))
- **Each persona has its own page (2026-10-03).** A row on the Personas list,
  **＋ New persona** and Cast's **Edit their persona →** open *Personas ›
  June*: pick the kind of voice (Built-in · Clone from audio · Design from
  words · Blend), filter the voices by how they **can be directed** (written
  direction, tags, or sliders only), by model and by gender, and see each one
  as *Sohee · Female · Korean · Qwen3-TTS CustomVoice*. **▶ Listen** plays your
  unsaved changes through the same path a chapter renders; **⚖️ Compare
  settings…** hears one line three ways. Pace, pitch, gain and pauses are on
  every persona; written direction and emotion, or Chatterbox Turbo's emotion
  and register tags, show only where the voice's model takes them; the
  **Sampling** card shows exactly the model's own settings and seed, kept per
  model. **Spoken delivery** is now called **Standing delivery**. The dialog
  editor on the Personas list is gone
  ([Personas → The persona's page](personas.md#the-personas-page))
- **A persona sounds the same everywhere, in its own language (2026-10-03).**
  A line's ↻ re-render, a take and the game voice-line export now send the
  persona's spoken delivery and the line's own direction, as a chapter render
  does; every render sends the persona's language and seed; picking a persona
  on Generate switches to its voice. A persona's language starts as its voice's
  own and can be any language the voice's model speaks — one it can't speak is
  refused on Save. Clearing a persona field and saving now clears it. The
  persona's *Engine override* field is gone: nothing read it, and the model
  comes from the voice
  ([Personas → One persona, one sound, everywhere](personas.md#one-persona-one-sound-everywhere))
- **Render presets are gone (2026-10-03).** The Presets page, the Render step's
  per-chapter **Render preset** column and its **💡 Suggest** button are removed
  ("presets die", decided 2026-09-27). A preset was laid over every persona in a
  chapter and silently beat the persona's own pace, pitch and gain; now every line
  sounds the way its persona is set up, and the mastering target is the
  project's (Studio · Overview). Presets saved before stay in your data file,
  unused, until your next reset. A chapter's own sound — a flashback's reverb —
  comes back with Studio's scene layer
  ([Studio → Render](studio.md#render))
- **Every voice knows its model, and a mixed cast renders (2026-10-03).** A
  voice now remembers the model it was made for — a Qwen3 speaker is
  CustomVoice, a clone is the model you picked when you cloned it — and every
  render loads that model, in the size you chose on AI Settings. A chapter whose
  voices need different models renders model by model instead of being refused
  (the mixed-Qwen3 refusal is gone). Import's **Model that speaks as this clip**
  lists models rather than engines
  ([Voices → Every voice knows the model that speaks it](voices.md#every-voice-knows-the-model-that-speaks-it),
  [Studio → One speech model at a time](studio.md#one-speech-model-at-a-time--personas-on-several-models-render-model-by-model))
- **An empty transcript stays empty (2026-10-03).** Auditioning a cloned voice
  without typing what the clip says sent a dash as its transcript, and saving the
  audition kept it, so Qwen3 Base read the clip as saying "—". Now an empty box
  is no transcript: VoxCPM2 and Chatterbox clone from the sound alone, and Qwen3
  Base asks for the transcript or **Skip the words**, by name. **Skip the words**
  works again on Qwen3 Base — it had not reached the speech runtime since the
  2026-10-01 switch — and a voice saved with it keeps it for its renders
  ([Personas → New clone](personas.md#new-clone))
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
  ([Engines → VoxCPM2](engines.md#voxcpm2))
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
  ([Engines → Qwen3-TTS](engines.md#qwen3-tts))
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
  you to accept Kyutai's terms ([Engines → Pocket TTS](engines.md#pocket-tts))
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
  ([Personas → New design](personas.md#new-design))
- A designed voice you have not kept a clip for now actually reaches the
  model — its description is spoken on every line, with your direction added
  after it ([Personas → New design](personas.md#new-design))
- A table of **which voice types take written direction**, because it depends
  on how the voice was made, not just which engine you picked
  ([Voices](voices.md#which-of-them-take-written-direction))
- A cast that mixes Qwen3 checkpoints is refused **before** the render starts,
  naming every voice and the model it needs, instead of failing partway
  through ([Studio](studio.md#one-speech-model-at-a-time--personas-on-several-models-render-model-by-model))
- Bracketed tags typed into Qwen3 text are removed rather than read aloud —
  Qwen3 takes direction as words, not markup ([Engines](engines.md))
- Four ways to blend a Kokoro voice — mix, exaggerate, add and subtract, or
  splice one voice's sound onto another's delivery
  ([Personas → New blend](personas.md#new-blend))
- Voices library filters by language and gender, and shows language as a name
  rather than a code ([Voices](voices.md#finding-a-voice-in-the-library))
- **Any column heading sorts, on every list in the app**
  ([Core concepts](core-concepts.md#lists))
- Loading a model from the Voices page shows the same progress bar, Cancel and
  error as the Speech engines page — and the **Size** dropdown now decides
  which weights are fetched ([Voices](voices.md#finding-a-voice-in-the-library))
- Every slider says what its ends MEAN — *slower · as written · faster* — and
  its number box can be typed into
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
