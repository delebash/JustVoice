# SPDX-License-Identifier: MIT
"""Multi-adapter import pipeline.

Each adapter module under `imports/adapters/` exposes a `parse(raw,
*, filename)` callable returning a `StandardImport`. This file
collects them into a registry and exposes:

  - `get_adapter(source_id)` — adapter callable or None
  - `list_adapters()` — list of AdapterInfo objects for the UI picker
  - `run_adapter(source_id, raw, filename)` — convenience wrapper

Adding a new adapter:
  1. Create `server/justvoice/imports/adapters/<name>.py` exporting
     `SOURCE_ID` + `parse(raw, *, filename)`.
  2. Append an `_ADAPTER_REGISTRY` entry below with the AdapterInfo.
  3. Document the input shape in `docs/import-and-export.md`.
"""

from __future__ import annotations

from typing import Callable

from .adapters import (
    audacity_labels,
    book_prose,
    csv_lines,
    justvoice_standard,
    justwrite,
    podcast_markdown,
    srt,
)
from .standard_schema import AdapterInfo, StandardImport

# Each row: (info, parser). Order is the order the UI picker shows.
# JustWrite first — it's the primary integration partner.
_ADAPTER_REGISTRY: list[tuple[AdapterInfo, Callable[..., StandardImport]]] = [
    (
        AdapterInfo(
            id=justwrite.SOURCE_ID,
            label="JustWrite book",
            description="The .zip JustWrite exports (book.json + images) — chapters, prose and the character roster; speakers are found later in Script.",
            # The zip is the real export; a bare book.json (someone unzipped it
            # first) parses too.
            file_extensions=[".zip", ".json"],
            implemented=True,
            docs_anchor="import-justwrite",
        ),
        justwrite.parse,
    ),
    (
        AdapterInfo(
            id=book_prose.SOURCE_ID,
            label="Book / manuscript",
            description="EPUB, DOCX, Markdown, or plain text — chapters split on headings; speakers discovered later in Script.",
            file_extensions=[".epub", ".docx", ".md", ".markdown", ".txt"],
            implemented=True,
            docs_anchor="import-book_prose",
        ),
        book_prose.parse,
    ),
    (
        AdapterInfo(
            id=podcast_markdown.SOURCE_ID,
            label="Podcast script (markdown)",
            description="Speaker-labeled script — SARAH: / **JIN:** paragraphs become segments; [tags] ride along; ## headings split segments.",
            file_extensions=[".md", ".markdown", ".txt", ".fountain"],
            implemented=True,
            docs_anchor="import-podcast_markdown",
        ),
        podcast_markdown.parse,
    ),
    (
        AdapterInfo(
            id=csv_lines.SOURCE_ID,
            label="CSV lines",
            description="Spreadsheet of dialogue rows — scene, character, text, delivery, pause_after_ms.",
            file_extensions=[".csv"],
            implemented=True,
            docs_anchor="import-csv_lines",
        ),
        csv_lines.parse,
    ),
    (
        AdapterInfo(
            id=srt.SOURCE_ID,
            label="SubRip subtitles (.srt)",
            description="SRT cue blocks — each cue becomes a line; SPEAKER: prefixes lift to characters.",
            file_extensions=[".srt"],
            implemented=True,
            docs_anchor="import-srt",
        ),
        srt.parse,
    ),
    (
        AdapterInfo(
            id=audacity_labels.SOURCE_ID,
            label="Audacity label track",
            description="Audacity TSV label export — one line per label, pause derived from gaps.",
            file_extensions=[".txt"],
            implemented=True,
            docs_anchor="import-audacity_labels",
        ),
        audacity_labels.parse,
    ),
    (
        AdapterInfo(
            id=justvoice_standard.SOURCE_ID,
            label="JustVoice standard JSON",
            description="A payload already in the JustVoice import standard shape — pass-through + validate.",
            file_extensions=[".json"],
            implemented=True,
            # "import-standard-json" since the import/export doc merge
            # (2026-08-08): the old "import-standard" id was DUPLICATED in the
            # page (the schema section carried it too), so this adapter's help
            # link landed on the schema instead of its own section.
            docs_anchor="import-standard-json",
        ),
        justvoice_standard.parse,
    ),
    # NOTHING UNIMPLEMENTED GOES IN THIS LIST. The ElevenLabs row lived here as
    # `implemented=False` and answered every selection with a 501 — an entry in
    # the format menu that could not import anything. Deleted 2026-08-08 with its
    # stub module; the shape it would parse is researched in
    # docs/dev/external-import-formats.md, and the build-or-drop call is a
    # tracker item. `AdapterInfo.implemented` stays: it is part of the
    # /v1/projects/import/adapters response shape.
]

_BY_ID: dict[str, Callable[..., StandardImport]] = {
    info.id: parser for info, parser in _ADAPTER_REGISTRY
}


def list_adapters() -> list[AdapterInfo]:
    """All registered adapters in display order."""
    return [info for info, _ in _ADAPTER_REGISTRY]


def get_adapter(source_id: str) -> Callable[..., StandardImport] | None:
    return _BY_ID.get(source_id)


def run_adapter(
    source_id: str, raw: bytes, *, filename: str | None = None, **options
) -> StandardImport:
    parser = get_adapter(source_id)
    if parser is None:
        from ..errors import bad_request

        known = ", ".join(_BY_ID.keys())
        raise bad_request(f"unknown import source '{source_id}'. Known: {known}")
    if options:
        # Adapter-specific options (e.g. book_prose split_on) — drop any
        # the target adapter doesn't declare so callers can pass them
        # uniformly without every adapter growing the parameter.
        import inspect

        accepted = inspect.signature(parser).parameters
        options = {k: v for k, v in options.items() if k in accepted and v is not None}
    return parser(raw, filename=filename, **options)


__all__ = [
    "AdapterInfo",
    "StandardImport",
    "list_adapters",
    "get_adapter",
    "run_adapter",
]
