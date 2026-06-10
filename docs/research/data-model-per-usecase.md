# Data model — per use case

## Decision

**JustVoice keeps a single Project → Scene → Block schema across all five use cases.** No forks, no per-use-case subtypes.

The data model that originated for audiobook production already generalizes cleanly to game voicelines, podcasts, dictation, and accessibility. Use-case-specific behavior layers on top through:

- `Project.project_type` — discriminator (`audiobook` | `game_voicelines` | `podcast` | `custom`)
- `useCopy()` — terminology mapping (audiobook says "Chapter / Line", game says "Quest / Voiceline", podcast says "Segment / Block", etc.)
- Per-use-case sidebar filtering (Phase 1 / Slice 5)
- Per-use-case view gating (Studio for audiobook + game + podcast; hidden for dictation + accessibility)
- Per-use-case empty states + first-action prompts

## Background

This decision lives in plan task #75 (research). The plan synthesis already flagged: *"keep ONE schema (Project → Scene → Block already generic), differentiate via project_type + useCopy() terminology"*. This doc records the rationale so future contributors don't re-litigate it.

## Schema as it stands (post-Phase 1 Profile-kill)

```
Project        — top-level container. Discriminated by project_type.
  Scene        — paragraph / scene / segment / session container.
    Block      — atomic render unit. Persona FK + text + direction + extraction telemetry.
      Take     — versioned render of a Block.
      Generation — actual TTS render with audio file.

Persona        — character identity (cross-project). Voice + delivery + effects + lexicon.
ProjectPersona — m2m: which personas does each project use.
```

## Schema fit per use case

### Audiobook

- Project = the book. `metadata_json` holds {title, author, isbn}.
- Scene = chapter.
- Block = paragraph or dialogue line. `persona_id` = which character speaks.
- Persona = audiobook cast (narrator + characters).
- Take = re-renders of a block. Default take per block per the take-versioning system.
- **Fit: native. The schema was designed for this case.**

### Game (Unreal voicelines)

- Project = a game's voicelines set. `metadata_json` holds {studio, engine, version}.
- Scene = quest, scene, dialogue tree, or arbitrary grouping. Game devs often use one Scene per quest or per NPC.
- Block = one NPC voiceline.
- Persona = NPC roster. Personas are cross-project — one NPC_Mara across many quests across sequels (Phase 1 Slice 2's "Used in N projects" badge surfaces this).
- Take = NPC variants ("normal" / "wounded" / "in-combat" — engineers often record multiple deliveries of the same line). Maps onto take-versioning cleanly.
- **Fit: good. The only friction is naming — "Scene/Block" terminology in raw schema reads as audiobook-shaped; `useCopy()` swaps to "Quest/Voiceline" in the UI.**

### Podcast

- Project = a podcast season or single episode. `metadata_json` holds {feed_url, season, episode_number}.
- Scene = segment within an episode (intro / interview / outro). Podcasters who write tightly scripted shows use Scenes; ad-lib hosts use just one Scene per episode.
- Block = a host or guest line, or a beat in the script.
- Persona = hosts + recurring guests.
- Take = re-records when the host wants a different take of a line.
- **Fit: good. Multi-host episodes use Persona attribution; solo podcasts can leave persona_id null on Blocks.**

### Dictation

- Project = optional. Dictation is single-line-render-and-paste; users don't usually save a project file. When they do, it's a notepad-style collection.
- Scene = optional grouping (a meeting's worth of notes, a single dictation session).
- Block = one dictated paragraph. `persona_id` always = the user's own Persona (or null for accessibility).
- Take = one per block (no re-rolls; dictation is single-shot).
- **Fit: schema is overkill for the common case. The dictation flow primarily lives in CapturesView (Phase 1 / Slice 5 hides Studio + Projects for dictation use cases) — the schema is there if a user wants to organize captures into projects, but the workflow doesn't require it.**

### Accessibility

- Project = optional. Similar to dictation — single-line TTS is the primary flow.
- Scene = optional.
- Block = a line being read aloud.
- Persona = the user's accessibility voice (one persona, persistent).
- **Fit: same as dictation. Schema is overkill but doesn't impose cost — the accessibility flow doesn't surface Projects.**

## Why not fork the schema

Three real options were considered:

1. **One generic schema (this decision).** Single Project / Scene / Block hierarchy. `project_type` discriminator + UI terminology layer.
2. **Per-use-case forks.** AudiobookProject + GameProject + PodcastProject + DictationProject + AccessibilityProject as distinct ORM models with different fields and FKs.
3. **Hybrid — common base + use-case mixins.** Project has common fields; mixin tables add audiobook_metadata, game_metadata, etc.

The fork option was rejected because:

- **Joins explode.** A "list all projects" query becomes a UNION across 5 tables, or 5 separate queries. The current `db.query(Project)` is one query.
- **Cross-use-case operations stop working.** The cross-project Persona feature (one Mara across 12 quests AND her cameo in a sequel game AND a podcast guest spot) requires a single Project table to join against.
- **Studio shell duplicates.** A unified `StudioView.vue` (Phase 4) renders Cast / Script / Render against any project. Per-use-case Project models would force per-use-case Studio variants.
- **Future use cases add work.** When a sixth use case shows up (live performance? educational? voice-over-internet?), the fork approach demands a new ORM table; the generic schema requires only a new project_type value + a useCopy entry.

The hybrid option was rejected because the per-use-case fields turn out to be small enough to live in `Project.metadata_json` (free-form JSON dict). Audiobooks need ISBN + title + author; games need studio + engine version; podcasts need feed URL + season/episode. Three fields × five use cases = 15 fields total, all naturally JSON-shaped. Not worth a mixin table.

## When this decision should be revisited

If any of these change, re-open #75:

1. A use case demands a strictly typed field that can't fit in metadata_json without breaking JSON tooling (unlikely — schemas already permit arbitrary JSON depth).
2. The Scene → Block relationship breaks for a use case. Today every use case fits "container → ordered sequence of render units." If a new use case has parallel render units (multi-track audio with simultaneous channels) the relationship may not generalize — but that's StoriesView's domain today, not Block's.
3. Per-use-case queries materially diverge in performance. The current single-Project table indexes well for the existing filter patterns; if a future cross-project NPC-line aggregation query (Phase 7 / Slice 1) shows up as a hotspot, sharding may help.

None of these are on the v1 horizon.

## Links

- Plan: `~/.claude/plans/1-what-are-the-magical-scone.md` (locked decisions section)
- Block schema: `server/justvoice/database/models.py` (around line 206)
- project_type enum: `server/justvoice/database/models.py` `Project.project_type` column
- `useCopy()` mapping: `src/renderer/src/services/copy.js`
- Sidebar gating (Phase 1 / Slice 5): `src/renderer/src/App.vue` `visibleFor` per-tab
