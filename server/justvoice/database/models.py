# SPDX-License-Identifier: GPL-3.0-or-later
#
# Several tables (Generation, GenerationVersion, Story, StoryItem,
# EffectPreset, Capture, MCPBinding, Channel) adapt voicebox's schema (MIT)
# — backend/database/models.py at the commit pinned in voicebox-pin.txt.
# Original copyright (c) the voicebox authors.
"""ORM model definitions for the JustVoice SQLite database.

Schema is the implementation of DESIGN_FREEZE.md §4. Every entity except
user-editable preferences (settings.json) lives here.

Convention:
- Primary keys are UUID4 strings — easier to debug than autoincrement
  integers, no risk of leaking sequence size in logs.
- Foreign keys use ON DELETE CASCADE where the child has no meaning without
  its parent (e.g. samples for a deleted voice). RESTRICT where the child
  references a long-lived parent that shouldn't be silently nulled
  (e.g. a render preset's voice_id).
- JSON-shaped columns store a serialized payload as TEXT. SQLite has a
  native JSON1 extension but we don't depend on it for portability.
- All datetimes are stored in UTC.

Migration pattern: see migrations.py — idempotent column-existence
checks, no Alembic. (Pattern lifted under MIT; attribution in
migrations.py SPDX header.)
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Index,
)
from sqlalchemy.orm import declarative_base


Base = declarative_base()


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.utcnow()


# ── Voice + engine layer ──────────────────────────────────────────────────


# VoiceProfile / ProfileSample / ProfileChannel removed in Slice 4 of the
# Profile-kill rollout (see plan locked decision #1). Persona now carries
# voice_id + delivery + effects + personality + lexicon directly.
# Audio-channel routing per character lives on PersonaChannel below.


class PersonaChannel(Base):
    """Many-to-many: which audio output channels does this persona play through.

    A persona with channel routing assigned overrides the global AudioPlayer
    device choice for its playback. Replaces ProfileChannel (Slice 4).
    """

    __tablename__ = "persona_channels"

    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), primary_key=True)
    channel_id = Column(String, ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True)


# ── Persona layer (character bios — separate from VoiceProfile) ──


class Persona(Base):
    """Character — the sole identity layer after the Profile-kill (plan Q1).

    All voice-styling fields live directly on the persona, not behind a
    Profile FK. `personality` is a TTS delivery instruction (engines that
    accept `supports_instruct_freeform` consume it; others ignore it).
    Rewrite is a separate explicit LLM tool, not a render-time hook on
    this row.

    Imported from JustWrite character roster, voice-profile migration, or
    created manually inside JustVoice.
    """

    __tablename__ = "personas"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    language = Column(String, default="en")
    avatar_path = Column(String, nullable=True)
    bio = Column(Text, nullable=True)  # max 2000 chars enforced at the API layer
    # Direct FK to a Voice (TTS artifact) — Voices live as JSON manifests
    # today (storage/voices.py); this column carries the voice id verbatim
    # and is not a foreign key constraint.
    voice_id = Column(String, nullable=True)
    # TTS delivery instruction (Qwen3 `instruct`, LuxTTS style-prompt).
    personality = Column(Text, nullable=True)
    # Tier-2 delivery overlay (JSON-serialized Delivery shape).
    default_delivery = Column(Text, nullable=True)
    # Pedalboard effects chain (JSON array of {type, params}). Cascade order:
    # persona → render preset (overlay) → per-block override. Wired in Slice 6.
    effects_chain = Column(Text, nullable=True)
    engine_override = Column(String, nullable=True)
    lexicon_id = Column(String, ForeignKey("lexicons.id", ondelete="SET NULL"), nullable=True)
    # Provenance — where did this persona come from?
    imported_from = Column(String, nullable=True)  # "justwrite" | "manual" | "unreal" | "voice_profile"
    imported_id = Column(String, nullable=True)  # foreign id in the source system
    # Soft sentinel — auto-created by the project lifecycle (Narrator on
    # audiobook + podcast). The personas API refuses DELETE on builtins;
    # rename + voice reassignment still work.
    is_builtin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


# ── Lexicon layer (pronunciation dictionaries) ────────────────────────────


class Lexicon(Base):
    """Pronunciation dictionary. Scoped global / project / persona."""

    __tablename__ = "lexicons"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    scope = Column(String, nullable=False, default="global")  # "global" | "project" | "persona"
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class LexiconEntry(Base):
    """One word + pronunciation pair inside a lexicon."""

    __tablename__ = "lexicon_entries"

    id = Column(String, primary_key=True, default=_uuid)
    lexicon_id = Column(String, ForeignKey("lexicons.id", ondelete="CASCADE"), nullable=False)
    word = Column(String, nullable=False)
    pronunciation = Column(Text, nullable=False)
    # "ipa" | "phonetic" (ASCII-phonetic)
    notation = Column(String, nullable=False, default="phonetic")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


# ── Project layer (use-case generalized) ──────────────────────────────────


class Project(Base):
    """Top-level container for an audiobook, game voicelines set, podcast,
    or custom voice project. The `project_type` discriminator drives which
    export pipeline and which UI surface applies.
    """

    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    # "audiobook" | "game_voicelines" | "podcast" | "custom"
    project_type = Column(String, nullable=False)
    # JSON-shaped per-type metadata (title/author for audiobook;
    # studio/engine for game; episode_number for podcast).
    metadata_json = Column(Text, nullable=True)
    default_lexicon_id = Column(String, ForeignKey("lexicons.id", ondelete="SET NULL"), nullable=True)
    # "acx" | "inaudio" | "podcast" | "youtube" | "custom"
    mastering_preset = Column(String, nullable=True)
    imported_from = Column(String, nullable=True)
    imported_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class ProjectPersona(Base):
    """Cast assignment: which personas appear in this project, in what role."""

    __tablename__ = "project_personas"

    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), primary_key=True)
    role_label = Column(String, nullable=True)  # "narrator" / "protagonist" / "NPC" / etc.


class Scene(Base):
    """A chapter (audiobook), dialogue tree / quest (game), or episode
    segment (podcast). Contains an ordered list of Blocks.
    """

    __tablename__ = "scenes"

    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    title = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class Block(Base):
    """A paragraph (audiobook), NPC line (game), or take/segment (podcast).
    The atomic unit of render and take-versioning.
    """

    __tablename__ = "blocks"

    id = Column(String, primary_key=True, default=_uuid)
    scene_id = Column(String, ForeignKey("scenes.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True)
    # Emotion/style hint passed through to the engine's instruct field
    direction = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    # Phase 3 / Slice 2 — extraction telemetry. Populated when blocks
    # land via POST /v1/scenes/{id}/analyze; the Studio Script tab
    # reads these to render audit chips ("floored from <X>", "anchor: said")
    # and the Speaker Lab uses them for disagreement badges.
    extraction_confidence = Column(Float, nullable=True)
    # "tag" | "propagated" | "llm" | "floored" | "narration" | "manual"
    source = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


Index("ix_blocks_scene_position", Block.scene_id, Block.position)


# ── Generation + take layer ───────────────────────────────────────────────


class Generation(Base):
    """A single TTS render of a block or ad-hoc text."""

    __tablename__ = "generations"

    id = Column(String, primary_key=True, default=_uuid)
    block_id = Column(String, ForeignKey("blocks.id", ondelete="SET NULL"), nullable=True)
    persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True)
    # `profile_id` column retained as a plain string for backward DB compat
    # with rows written before Slice 4 of the Profile-kill rollout. New
    # writes leave it null and use persona_id instead. The FK to
    # voice_profiles is gone because the table is dropped.
    profile_id = Column(String, nullable=True)
    # Denormalized so generations survive their project being deleted.
    # Useful for the cache layer + bulk-delete by project / chapter.
    project_id = Column(String, nullable=True)
    chapter_id = Column(String, nullable=True)
    text = Column(Text, nullable=False)
    language = Column(String, default="en")
    engine = Column(String, nullable=False)
    seed = Column(Integer, nullable=True)
    instruct = Column(Text, nullable=True)
    audio_path = Column(String, nullable=True)
    duration_sec = Column(Float, nullable=True)
    # "queued" | "loading_model" | "generating" | "completed" | "failed" | "cancelled"
    status = Column(String, nullable=False, default="queued")
    # ok / failed — required by bulk-delete status filter (per DESIGN_FREEZE §4.14)
    ok_status = Column(String, nullable=False, default="ok")
    error = Column(Text, nullable=True)
    is_favorited = Column(Boolean, default=False, nullable=False)
    # "manual" | "chapter_render" | "mcp_speak" | "dictate_replay"
    source = Column(String, nullable=False, default="manual")
    # Which render preset (if any) produced this generation; null for ad-hoc
    preset_id = Column(String, ForeignKey("render_presets.id", ondelete="SET NULL"), nullable=True)
    effects_chain = Column(Text, nullable=True)
    cache_key = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


Index("ix_generations_voice_status_created", Generation.profile_id, Generation.ok_status, Generation.created_at)
Index("ix_generations_project_chapter", Generation.project_id, Generation.chapter_id)


class Take(Base):
    """Per-block take versioning — JustVoice addition for re-roll workflow.
    Voicebox versions whole generations; we version per-block so re-rendering
    paragraph 47 doesn't invalidate paragraph 48.
    """

    __tablename__ = "takes"

    id = Column(String, primary_key=True, default=_uuid)
    block_id = Column(String, ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False)
    generation_id = Column(String, ForeignKey("generations.id", ondelete="CASCADE"), nullable=False)
    # Lineage — chain through re-takes. null = original take.
    source_take_id = Column(String, ForeignKey("takes.id", ondelete="SET NULL"), nullable=True)
    # Exactly one default per block at render time (enforced application-side).
    is_default = Column(Boolean, default=False, nullable=False)
    label = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


Index("ix_takes_block_default", Take.block_id, Take.is_default)


class GenerationVersion(Base):
    """Voicebox's non-destructive effects-applied version chain. Kept for
    history rows that aren't tied to a block (one-off Generate-tab work).
    Block-tied generations use the Take chain instead.
    """

    __tablename__ = "generation_versions"

    id = Column(String, primary_key=True, default=_uuid)
    generation_id = Column(String, ForeignKey("generations.id", ondelete="CASCADE"), nullable=False)
    source_version_id = Column(String, ForeignKey("generation_versions.id", ondelete="SET NULL"), nullable=True)
    audio_path = Column(String, nullable=False)
    effects_chain = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


# ── Render orchestration ──────────────────────────────────────────────────


class RenderJob(Base):
    """Resumable scene/project renders. Survives server restart (per
    DESIGN_FREEZE.md §3.7: full-implementation persistence)."""

    __tablename__ = "render_jobs"

    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    # "project" | "scene" | "blocks"
    scope = Column(String, nullable=False)
    # JSON list of scene_ids or block_ids
    scope_ids_json = Column(Text, nullable=True)
    # "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"
    status = Column(String, nullable=False, default="queued")
    total_blocks = Column(Integer, nullable=True)
    completed_blocks = Column(Integer, default=0, nullable=False)
    failed_blocks = Column(Integer, default=0, nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class RenderJobBlock(Base):
    """Per-block status within a render job. Lets us recover only the
    failed blocks on retry instead of re-rendering the whole project.
    """

    __tablename__ = "render_job_blocks"

    id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, ForeignKey("render_jobs.id", ondelete="CASCADE"), nullable=False)
    block_id = Column(String, ForeignKey("blocks.id", ondelete="CASCADE"), nullable=False)
    generation_id = Column(String, ForeignKey("generations.id", ondelete="SET NULL"), nullable=True)
    # "pending" | "running" | "completed" | "failed"
    status = Column(String, nullable=False, default="pending")
    attempts = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


# ── Stories (DAW timeline) ────────────────────────────────────────────────


class Story(Base):
    """Voicebox's multi-track timeline. Kept for podcast + game-dialogue
    assembly. Can be tied to a project (for chapter assembly) or freestanding.
    """

    __tablename__ = "stories"

    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class StoryItem(Base):
    """One clip placement on a Story timeline."""

    __tablename__ = "story_items"

    id = Column(String, primary_key=True, default=_uuid)
    story_id = Column(String, ForeignKey("stories.id", ondelete="CASCADE"), nullable=False)
    generation_id = Column(String, ForeignKey("generations.id", ondelete="CASCADE"), nullable=True)
    version_id = Column(String, ForeignKey("generation_versions.id", ondelete="SET NULL"), nullable=True)
    track = Column(Integer, default=0, nullable=False)
    start_time_ms = Column(Integer, default=0, nullable=False)
    trim_start_ms = Column(Integer, default=0, nullable=False)
    trim_end_ms = Column(Integer, default=0, nullable=False)
    volume = Column(Float, default=1.0, nullable=False)
    # Denormalized for fast timeline scrubbing without joining generations
    duration = Column(Float, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


# ── Audio output channels ────────────────────────────────────────────────


class Channel(Base):
    """A named audio output config that maps to one or more OS device IDs.
    Supports multi-output broadcast (e.g. route a voice to both default
    output AND an OBS virtual mic).
    """

    __tablename__ = "channels"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False, unique=True)
    is_default = Column(Boolean, default=False, nullable=False)
    # JSON list of OS audio device IDs
    device_ids_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=_utcnow)


# ── MCP integration ──────────────────────────────────────────────────────


class MCPBinding(Base):
    """Per-client voice + defaults binding for the MCP server. When an
    Unreal editor / Claude / Cursor calls `justvoice.speak` without
    specifying voice or personality, these defaults apply.
    """

    __tablename__ = "mcp_bindings"

    client_id = Column(String, primary_key=True)
    label = Column(String, nullable=True)
    # Replaces the prior voice_profiles FK — now points at personas after
    # Slice 4 of the Profile-kill rollout. Nullable; MCP clients without
    # a bound persona fall back to the global default.
    persona_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True)
    default_personality = Column(Boolean, default=False, nullable=False)
    default_engine = Column(String, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


# ── Captures (dictation recordings) ───────────────────────────────────────


class Capture(Base):
    """A dictation / system-audio / uploaded recording. Persisted with both
    raw Whisper output and post-refinement transcript."""

    __tablename__ = "captures"

    id = Column(String, primary_key=True, default=_uuid)
    audio_path = Column(String, nullable=False)
    # "mic" | "system_audio" | "upload"
    source = Column(String, nullable=False, default="mic")
    language = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    transcript = Column(Text, nullable=True)
    raw_transcript = Column(Text, nullable=True)
    # JSON: {smart_cleanup, self_correction, preserve_technical}
    refinement_flags_json = Column(Text, nullable=True)
    # Pinned captures sort first + survive the Pinned filter (parity:
    # the journeys mock pins repeated stream phrases).
    pinned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


# ── Effects + render presets ──────────────────────────────────────────────


class EffectPreset(Base):
    """User-saved or built-in effect chains (Robotic / Radio / Echo Chamber /
    Deep Voice + custom user presets).
    """

    __tablename__ = "effect_presets"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    # JSON: EffectConfig[]
    chain_json = Column(Text, nullable=False)
    is_builtin = Column(Boolean, default=False, nullable=False)
    sort_order = Column(Integer, default=100, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class RenderPreset(Base):
    """Named bundle of voice + delivery + master target + lexicons. Lets the
    audiobook producer lock ACX consistency across 30 chapters, or the
    game-dev lock per-character reproducibility across 200 NPCs.

    Unique (project_id, name) — global presets share namespace via null=='''.
    See DESIGN_FREEZE.md §4.13 + §3.x render-preset decision.
    """

    __tablename__ = "render_presets"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    # After Slice 4 of the Profile-kill rollout the preset binds to a
    # Persona, not the dropped VoiceProfile. ondelete RESTRICT prevents
    # deleting a Persona that has render presets bound to it.
    # NULLABLE (2026-06-12): a preset is a reusable delivery/effects/master
    # STYLE — the voice binding is optional. Delivery-only presets (incl.
    # the 4 built-ins) carry no persona; the block/request supplies the
    # voice at render time. This is what keeps Preset distinct from
    # Persona: persona = WHO speaks (T2 baseline), preset = HOW this
    # render sounds (T3 overlay).
    voice_id = Column(String, ForeignKey("personas.id", ondelete="RESTRICT"), nullable=True)
    # JSON: Delivery shape
    delivery_json = Column(Text, nullable=False, default="{}")
    # Per-preset effects chain (Slice 6) — overlays the persona's chain
    # at render time. JSON list of {type, params} dicts.
    effects_chain = Column(Text, nullable=True)
    # "acx" | "inaudio" | "podcast" | "youtube" | "none" | None
    master = Column(String, nullable=True)
    # JSON list of lexicon IDs
    lexicons_json = Column(Text, nullable=False, default="[]")
    seed = Column(Integer, nullable=True)
    cache_scope = Column(String, nullable=False, default="default")
    description = Column(Text, nullable=True)
    # Seeded by database/seed.py (Narration / Dramatic Dialogue / Quiet
    # Reflection / Action — task #88). Built-ins are editable; the flag
    # only drives the UI badge + reseed-if-missing on boot.
    is_builtin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


# Name must be unique within project_id scope; treat null as '' for the index.
# SQLite supports expression-based unique indexes.
Index(
    "ix_render_presets_unique_name_per_project",
    RenderPreset.project_id,
    RenderPreset.name,
    unique=True,
)


# ── Webhooks ──────────────────────────────────────────────────────────────


class Webhook(Base):
    """Outbound webhook subscriptions. Server POSTs to `url` with
    HMAC-SHA256-signed JSON body on registered events.

    Delivery: at-least-once, exponential backoff (1s, 5s, 30s, 5m, max 3
    retries). HMAC header = `X-JustVoice-Signature: hex(hmac_sha256(secret, body))`.
    Failed deliveries appended to `log_tail_json` (capped 50 entries).

    See DESIGN_FREEZE.md §4.12.
    """

    __tablename__ = "webhooks"

    id = Column(String, primary_key=True, default=_uuid)
    url = Column(String, nullable=False)
    # JSON array of WebhookEvent literals
    events_json = Column(Text, nullable=False)
    # bcrypt hash of the secret; raw secret returned ONCE at creation only
    secret_hash = Column(String, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    last_delivery_at = Column(DateTime, nullable=True)
    last_status_code = Column(Integer, nullable=True)
    # Rolling tail capped at 50 entries (JSON array of {timestamp, status, error?})
    log_tail_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=_utcnow)


# ── Speaker-attribution correction memory (Phase 5) ──────────────────────


class SpeakerCorrection(Base):
    """Writer-supplied corrections to speaker-attribution mistakes.

    Phase 5 of the Profile-kill plan. Captured when a block's persona_id
    changes via PATCH (the writer fixing the analyze pipeline's output).
    The extraction backend reads the top-12 most-recent per project as
    worked examples injected into the LLM prompt — so the next analyze
    run gets steered by the writer's prior fixes.

    Capped at 200 per project (old ones drop on insert).
    """

    __tablename__ = "speaker_corrections"

    id = Column(String, primary_key=True, default=_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    # The block.text at the time of correction (snippet for the
    # worked-example block in the prompt).
    text_snippet = Column(Text, nullable=False)
    # The character the writer assigned (may be null for "unknown" /
    # "narrator" — both also count as corrections worth remembering).
    character_id = Column(String, ForeignKey("personas.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=_utcnow)


Index("ix_speaker_corrections_project_created", SpeakerCorrection.project_id, SpeakerCorrection.created_at)


# ── Training jobs ────────────────────────────────────────────────────────


class TrainingJob(Base):
    """PEFT/LoRA voice training jobs with QC pipeline."""

    __tablename__ = "training_jobs"

    id = Column(String, primary_key=True, default=_uuid)
    # Replaces the prior voice_profiles FK after Slice 4 of the
    # Profile-kill rollout. Training jobs target a persona's voice.
    persona_id = Column(String, ForeignKey("personas.id", ondelete="CASCADE"), nullable=False)
    engine = Column(String, nullable=False)
    # "qc" | "training" | "completed" | "failed"
    status = Column(String, nullable=False, default="qc")
    samples_accepted = Column(Integer, default=0, nullable=False)
    samples_rejected = Column(Integer, default=0, nullable=False)
    current_step = Column(Integer, default=0, nullable=False)
    total_steps = Column(Integer, nullable=True)
    # JSON: list of {step: int, loss: float}
    loss_history_json = Column(Text, default="[]", nullable=False)
    adapter_path = Column(String, nullable=True)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
