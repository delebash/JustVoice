# What's new

## v0.1.0

- **"Next to check" always finds the line.** It used to look only below the line you
  had selected, so a chapter's one line to check — selected, or above it — got
  "Nothing more to check below". It now wraps around to the top (`Shift+N` to the
  bottom) ([Studio → Script](studio.md))
- **Discover keeps a record of everyone each chapter names.** A scan saves the cast
  members the chapter names (found by name, without the model), people in your
  library, and new names — one list, each person once, with a status: **In the
  cast**, **In your library**, **New** or **Ignored**, and chips to filter by it.
  Add and Ignore change the status instead of removing the row, so rescanning a
  finished chapter no longer comes back empty. The chapter grid's **Proposed**
  column is now **Found** ([Studio → Discover](studio.md#discover))
- **No book gets a narrator on its own.** Creating or importing a book no longer
  makes a Narrator persona — every import made a new one, and deleting the book left
  it in your library. Tick **Narrator** on anyone in the cast, or use **Add
  Narrator**, which uses a Narrator from your library that isn't in any book before
  making one, and moves the narration with no speaker to it ([Personas → The
  Narrator](personas.md#the-narrator))
- **Names are unique within a book.** One cast can't hold two people with the same
  name; adding or renaming into a clash is refused and says so. Different books,
  and personas in no book, can share a name — the persona list now names the books
  each persona is in ([Personas → Names](personas.md#names))
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
  find every character they did
- **Anyone in the cast can be the narrator.** A first-person narrator also speaks —
  Watson tells *The Speckled Band* and talks in it — so tick **Narrator** on their
  card in Studio's Cast step and their narration and lines share one voice. The persona
  who had the role stays in the cast; the narration Analyze decided moves with the
  role, and lines you set stay ([Personas → The Narrator](personas.md#the-narrator))
- **Cancelling a voice-model download cleans up before it says "cancelled".** The
  half-downloaded files used to be removed just after, so a download started right
  away could lose its first files
- **The Narrator can be deleted like any other persona.** Deleting it used to fail
  with "persona … is built-in". There are no built-in personas now: the Narrator a
  new audiobook or podcast gets is an ordinary persona, and it can leave the cast
  in Studio too. A deleted Narrator stays deleted — restarting the app no longer
  brings one back — until **Add Narrator** in Studio's Cast step makes a new one
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
  question: one person speaking three times with no reply, a persona's only line,
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
  ([Engines](engines.md#where-the-python-environments-live))
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
