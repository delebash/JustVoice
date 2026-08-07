# Unreal Engine integration — design options

## Status

Research doc for #49 (UE integration design) + #68 (deep dive). Locks the **recommended** option but reserves implementation for post-v1.

## Recommendation

**Phase 1: WAV+JSON sidecar export (ships as part of Studio Render's game project_type path).**
**Phase 2: UE5 .uplugin that consumes the sidecar (separate repo, post-v1 product surface).**

## The four options

### Option A — WAV-per-line + JSON sidecar

Each rendered NPC line writes:
- `Audio/NPC/<persona_id>/<scene_id>_<block_id>.wav` (or any path the user configures)
- `Audio/NPC/<persona_id>/<scene_id>_<block_id>.json` carrying `{ persona_id, persona_name, line_text, delivery_hint, scene, take, source }`

UE's importer auto-creates `USoundWave` assets from the WAVs; an editor utility script reads the JSON sidecars and populates Sound Cue / Quartz metadata.

**Pros:**
- Zero UE-side runtime dependency. Works with vanilla UE 5.x out of the box.
- Asset-pipeline friendly — version control, delta sync, regenerate-on-demand all behave like normal asset workflows.
- Works for any engine (Unity, Godot, custom) — the JSON sidecar is the contract.
- JustVoice ships this with **minimum new code**: extend Studio Render's batch-render path to write JSON next to each WAV when `project.project_type === 'game_voicelines'`.

**Cons:**
- No live in-editor preview. User has to render → import → audition in UE.
- No structured speaker/cue metadata in the engine — sits in JSON, not as UE asset properties.

### Option B — UE5 .uplugin calling JustVoice REST

A C++ `.uplugin` for UE5 that calls JustVoice's `/v1/generate` or `/v1/scenes/{id}/analyze` directly. Renders happen on-demand from the UE editor; results land as USoundWave assets in real time.

**Pros:**
- Live preview in the editor — pick a voice, type a line, hear it without leaving UE.
- Tight integration: speaker metadata maps directly to UE asset properties.
- Could expose JustVoice's Persona library as a UE-side dropdown.

**Cons:**
- UE5 plugin = C++ + UE-specific tooling. Larger build/test/release surface than JustVoice itself.
- Requires a running JustVoice server. The user's UE workstation has to either run JustVoice locally or hit a shared instance.
- License complexity — UE plugins ship under the Marketplace EULA. This was a hard blocker while JustVoice was GPL-3.0-or-later; since the 2026-07-29 MIT relicense it is no longer one, and MIT is Marketplace-compatible. A separate repo is still preferable, but for build-surface reasons rather than licensing.

### Option C — Wwise SoundBank export

Render every line, package the WAVs into a Wwise SoundBank, ship the SoundBank to the game.

**Pros:**
- Native to studios already on Wwise. Sits in their existing audio pipeline.
- Wwise itself handles in-game playback, mixing, routing.

**Cons:**
- Wwise authoring tools required (licensed product). Most indie studios don't use them.
- SoundBank packaging is a heavy step compared to dropping WAVs into a folder.
- Wwise integration locks users out if they later want a non-Wwise pipeline.

### Option D — FMOD project export

Same idea as C but FMOD instead of Wwise.

**Pros / cons:** mirror Option C — native to FMOD shops, locked out of non-FMOD pipelines.

## Comparison

| Aspect | A (sidecar) | B (.uplugin) | C (Wwise) | D (FMOD) |
|---|---|---|---|---|
| JustVoice-side scope | Small (extend Render path) | Medium (REST is there; need spec writeup) | Small | Small |
| UE-side scope | Zero (vanilla import) | Large (C++ plugin) | Medium (Wwise project setup) | Medium (FMOD project setup) |
| Editor preview | No | Yes | No (Wwise external) | No (FMOD external) |
| Audience reach | Universal | UE5 only | Wwise shops | FMOD shops |
| License complexity | Low | Medium-high | High (Wwise EULA) | High (FMOD EULA) |
| v1 fit | **Yes** | Post-v1 | Post-v2 | Post-v2 |

## The plan

**v1 ships Option A.** Studio Render's batch path for `project_type='game_voicelines'` writes the WAV+JSON pair. Document the sidecar JSON schema in `docs/dev/design-decisions.md` §3 when it ships (the original CONTRACT.md is archived). Users who need anything more sophisticated (in-editor preview, native Wwise routing) follow the post-v1 plugin path.

**Post-v1 considers Option B.** A `.uplugin` in a separate repo at `delebash/justvoice-ue5-plugin`, MIT-licensed, that hits the JustVoice REST API. A separate repo keeps the UE build surface out of this one; note that the original reason given here — escaping a GPL-licensed JustVoice codebase — no longer applies, since JustVoice itself is MIT as of 2026-07-29.

**Options C and D stay on the roadmap.** Studios on Wwise or FMOD can write their own SoundBank/project exporters that consume the JSON sidecars from Option A — the sidecar contract makes both downstream paths possible without bespoke JustVoice code.

## Sidecar JSON schema (Option A draft)

```json
{
  "persona_id": "p_mara_77f3",
  "persona_name": "Mara",
  "project_id": "proj_dark_alley_2026",
  "project_name": "Dark Alley 2026",
  "scene_id": "scene_quest_03",
  "scene_title": "Quest 03 — The Cellar",
  "block_id": "blk_abc123",
  "block_position": 5,
  "line_text": "Down. There's something in the cellar.",
  "delivery_hint": "warily, half-whispered",
  "language": "en",
  "engine": "chatterbox",
  "voice_id": "chatterbox-female-3",
  "render_preset_id": "preset_noir",
  "render_preset_name": "Noir",
  "extraction_confidence": 1.0,
  "extraction_source": "tag",
  "produced_by": "justvoice@<version>",
  "produced_at": "2026-06-10T03:14:00Z"
}
```

Stable fields: `persona_id`, `persona_name`, `block_id`, `line_text`. Everything else may be omitted; downstream consumers ignore unknown keys.

## When to revisit

- A studio signs up as a JustVoice early adopter for game voicelines specifically: validate the sidecar contract against their pipeline before locking it.
- UE 6 ships: the .uplugin C++ surface changes; revisit Option B based on what's stable.
- Wwise or FMOD adds a JSON-sidecar importer of their own: collapse Options C/D into "JustVoice writes sidecars; engine reads them."

## Links

- Plan: `docs/plans/archive/persona-voiceprofile-multiuse-design.md` (executed history)
- Game-flow walkthrough: plan Q2 walkthrough section
- Studio Render Tab: `src/views/StudioView.vue` Render tab
- The external boundary rules: `docs/dev/design-decisions.md` §3 (the original CONTRACT.md is archived)
