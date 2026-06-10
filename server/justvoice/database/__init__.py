# SPDX-License-Identifier: GPL-3.0-or-later
"""SQLite via SQLAlchemy — primary persistence layer.

Per DESIGN_FREEZE.md §4, every entity except user-editable preferences lives
here. `settings.json` is the ONLY remaining atomic-JSON store.

Migration pattern is hand-rolled idempotent column-existence checks
(MIT-lifted; per-file attribution in `migrations.py` header). No Alembic;
see `migrations.py` for the why.
"""

from .session import init_db, get_db, SessionLocal, engine
from .models import (
    Base,
    # Persona layer (Persona absorbs the former Profile-side fields per
    # Slice 4 of the Profile-kill rollout)
    Persona,
    PersonaChannel,
    # Lexicon layer
    Lexicon,
    LexiconEntry,
    # Project layer (use-case generalized: audiobook + game + podcast)
    Project,
    ProjectPersona,
    Scene,
    Block,
    # Generation + take layer
    Generation,
    Take,
    GenerationVersion,
    # Render orchestration
    RenderJob,
    RenderJobBlock,
    # Stories (DAW timeline)
    Story,
    StoryItem,
    # Audio channels
    Channel,
    # MCP integration
    MCPBinding,
    # Captures (dictation)
    Capture,
    # Effects + render presets (v1.0 from gap-decision workflow)
    EffectPreset,
    RenderPreset,
    # Webhooks (v1.0 from gap-decision workflow)
    Webhook,
    # Training jobs
    TrainingJob,
    # Speaker-attribution correction memory (Phase 5)
    SpeakerCorrection,
)

__all__ = [
    "init_db",
    "get_db",
    "SessionLocal",
    "engine",
    "Base",
    "Persona",
    "PersonaChannel",
    "Lexicon",
    "LexiconEntry",
    "Project",
    "ProjectPersona",
    "Scene",
    "Block",
    "Generation",
    "Take",
    "GenerationVersion",
    "RenderJob",
    "RenderJobBlock",
    "Story",
    "StoryItem",
    "Channel",
    "MCPBinding",
    "Capture",
    "EffectPreset",
    "RenderPreset",
    "Webhook",
    "TrainingJob",
    "SpeakerCorrection",
]
