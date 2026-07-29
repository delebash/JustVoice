# SPDX-License-Identifier: MIT
"""JustVoice import standard schema.

Every adapter normalizes its source format into a `StandardImport`
shape, so the rest of the server only deals with one structure when
materializing a project.

Versioning: bump `schema_version` whenever a backwards-incompatible
change to the shape lands. Old payloads can be migrated by the
`justvoice_standard` adapter (which is also responsible for validating
incoming JSON that claims to already be in this shape).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"

ProjectKind = Literal["audiobook", "game_voicelines", "podcast", "custom"]


class StandardLexiconEntry(BaseModel):
    grapheme: str
    phoneme_ipa: str | None = None
    alias: str | None = None


class StandardCharacter(BaseModel):
    """A speaking part. Maps to a persona once the project is committed.

    `voice_hint` is a free-form string the operator can use to bias
    voice assignment (e.g. "elderly male" or a persona id). It is not
    binding — the GUI lets the operator pick the final voice on commit.
    """

    id: str
    name: str
    voice_hint: str | None = None
    notes: str | None = None


class StandardLine(BaseModel):
    """One spoken line in a scene. The smallest renderable unit."""

    character_id: str | None = None
    text: str
    delivery: dict | None = None  # free-form overlay (speed, emotion, pause_before, …)
    pause_after_ms: int | None = None
    source_ref: str | None = None  # row/line/cue id in the source file


class StandardScene(BaseModel):
    """A scene (chapter / dialog tree node / podcast segment).

    `kind` is informational — adapters set it to whatever best
    describes the source slice (e.g. "chapter", "cue", "segment").
    """

    id: str
    title: str | None = None
    kind: str | None = None
    lines: list[StandardLine] = Field(default_factory=list)


class StandardProject(BaseModel):
    """Top-level container.

    `kind` selects which use-case UI surface the GUI will mount when
    the project is opened (audiobook chapter view, game voiceline
    table, podcast timeline, etc.).
    """

    id: str | None = None  # filled in on commit
    name: str
    kind: ProjectKind = "audiobook"
    description: str | None = None
    language: str = "en-US"


class StandardImport(BaseModel):
    """Top-level normalized payload every adapter produces."""

    schema_version: str = SCHEMA_VERSION
    source: str  # the adapter id (justwrite, csv_lines, …)
    project: StandardProject
    characters: list[StandardCharacter] = Field(default_factory=list)
    scenes: list[StandardScene] = Field(default_factory=list)
    lexicon_entries: list[StandardLexiconEntry] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AdapterInfo(BaseModel):
    """Describes an adapter for the UI picker."""

    id: str
    label: str
    description: str
    file_extensions: list[str] = Field(default_factory=list)
    implemented: bool = True
    docs_anchor: str | None = None  # e.g. "import-justwrite" — feeds the help-bus key


class AdapterListResponse(BaseModel):
    adapters: list[AdapterInfo]
    schema_version: str = SCHEMA_VERSION


class ImportRunResponse(BaseModel):
    """Returned from POST /v1/projects/import.

    On dry_run, `committed` is false and `project_id` is null. The
    `standard` payload is included so the UI can show a preview.
    """

    committed: bool
    project_id: str | None
    standard: StandardImport
    warnings: list[str] = Field(default_factory=list)
