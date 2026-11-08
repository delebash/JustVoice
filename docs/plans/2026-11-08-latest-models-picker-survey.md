# Where a speech model is picked, and where its licence shows (survey, 2026-11-08)

A read-only survey for `2026-11-08-latest-models.md` item 4 (an Explore agent's report, checked
where it is used). The real app only; mocks and tests left out.

**Main finding:** only the one-click card (BookRunCard) and AI Settings → Speech show a licence
word. No other model picker or filter shows a licence or a "best" mark. The shared option builder
`rowOptions` (src/services/capabilities.js:64-73) reads only the capability rows, which carry no
licence; it resolves each option's engine (`b.engine`, GET /v1/engines, which has
`licence.commercial`) and drops it.

The kit: `UiSelect` takes `{label, value, hint?}` and groups `{label, options:[…]}` (kit
common/components/UiSelect.vue:5-14, 53-58; per-option `disabled` not passed); `UiMultiSelect`
takes `{label, value}` only.

## Data sources

- **Capability rows — GET /v1/engines/capabilities** (server/src/api/engines_api.js:190-204), rows
  from server/src/engines/capability_details.js `CAPABILITY_DETAILS` (hand-written rows kokoro
  :181, Qwen3 :356-408, VoxCPM2 :425-428, chatterbox-nano :479; "like" rows :496-497; every
  generated model :522-527 — `display_name: modelName(m)`, `supports_voice_cloning: m.clone`,
  `supports_voice_design: m.design`). Schema `EngineCapabilityDetail` (models.js:1109-1134): no
  licence, no recommended field.
- **Engines — GET /v1/engines** (engines_api.js:149, `_infoFromManifest` :52-93 → `weights_license`,
  `terms`, `engineFacts` → `licence {name, commercial, table, summary, url, checked}`, `tested`,
  `best_for`); read by src/stores/engines.js:39-45.
- **Model versions — GET /v1/engines/{id}/models** (models_api.js:27-55): `ModelVariant` has
  `weights_license`, no commercial word.
- **Voices — GET /v1/voices** (voices_api.js:295): each voice has `model`, `model_name`, `licence
  {commercial, summary, url}` (`_facts` :45-47, `modelLicence` :52-58). The renderer never reads
  `voice.licence`.
- **Personas — GET /v1/personas** (personas_api.js:52-73 `_view`): `model`, `model_name`, no licence.
- **Settings:** GET/PUT/PATCH /v1/settings (settings_api.js:39-51). No renderer screen reads or
  edits `book_voices`; the renderer sees it only through the book run's plan and writes it only
  through `bookRun.setVoiceSet` (src/services/bookRun.js:338-344).

## The pickers and filters

| Screen | Control | What it picks | Options built by | Licence / mark today |
|---|---|---|---|---|
| Persona → New clone | PersonaCloneMaker.vue:319 | the model a cloned voice speaks on | `makerModelOptions` (voiceMakers.js:34) → `rowOptions` | none |
| Persona → New design | PersonaDesignMaker.vue:176 | the design model | same, `supports_voice_design` | none |
| Persona → New design → Keep a take | PersonaDesignMaker.vue:228 | the model the take is kept on | same, `supports_voice_cloning` | none |
| Persona editor | PersonaEditorPage.vue:1066 | filter voices by model | `facetOptions` over voices | none |
| Persona editor | PersonaEditorPage.vue:1085 | a model version (size) | GET /v1/voices/{id}/model-version | none |
| Personas | PersonasPage.vue:401 | filter personas by model | `facetOptions` over personas | none |
| Voices | VoicesPage.vue:644 | filter voices by model | `facetOptions` over voices | none |
| Voices → Copy to another model… | VoicesPage.vue:482-493 | the model a copy goes on | `rowOptions(…, "supports_voice_cloning")` | none |
| Studio → Cast | StudioCast.vue:745 (UiMultiSelect) | models Smart-assign and New persona may use | `castModelChoices` (newPersonas.js:43-53) over the book's voices | none |
| Studio → Cast | StudioCast.vue:869 | filter the persona library by model | `facetOptions` over personas | none |
| Studio → Overview → one-click card | BookRunCard.vue:201 | the voice set | the plan's `voice_sets` | licence chip :203; marks in the set labels |
| AI Settings → Speech | the kit's runtime tab + SpeechEngineHead.vue:49, :66-68; SpeechFilters.vue:38 | engines and their versions; filter and sort by commercial use | speechTab.js, engineFacts.js | licence chip and words; no mark |
| AI Settings → Speech | SpeechPickingCard.vue:12-27 | a hand-written "If you want… / Use…" table | fixed text | no licence words |
| Quick setup | QuickSetup.vue:300-324 | a tier and its engines (`TIER_RECIPES` :69-82) | fixed | none |

Not pickers: the transcription model is the kit's preset (AI Settings → Routing); Settings,
Discover, Script, Render, Lines and Import have no speech-model picker.

## The standard each piece follows

| Piece | Standard | Kit code |
|---|---|---|
| A model picker | the kit's select (options, hints, groups) | `UiSelect` |
| Studio → Cast's model list | the kit's multi-select (labels only) | `UiMultiSelect` |
| Copy to another model | the kit's prompt dialog's select field | `promptDialog` |
| The licence chip | JustVoice's commercial-use words | app — `src/services/engineFacts.js`, the app's own catalog of voices |

## The licence chip as built

`span.ev-lic` + `licClass(word)` (src/services/engineFacts.js:36-37; classes src/css/app.scss
:2003-2012 — `--warn` Conditional, `--separate`, `--no`, `--unclear`, none for Yes), text
"Commercial use: <word>", hover `licTitle` (engineFacts.js:45). Used in BookRunCard.vue
:176-177, :188-189, :203 and SpeechEngineHead.vue:49.
