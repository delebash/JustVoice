# SPDX-License-Identifier: GPL-3.0-or-later
"""JustVoice-standard import adapter.

Pass-through for payloads already in the StandardImport shape (e.g.
re-importing a previously-exported project, or hand-authored
adapter-pipeline output). Validates the JSON against the Pydantic
model and stamps `source = "justvoice_standard"`.
"""

from __future__ import annotations

import json

from pydantic import ValidationError

from ...errors import bad_request
from ..standard_schema import SCHEMA_VERSION, StandardImport

SOURCE_ID = "justvoice_standard"


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise bad_request(f"justvoice_standard import: not valid UTF-8 JSON ({e})") from e

    try:
        std = StandardImport.model_validate(doc)
    except ValidationError as e:
        raise bad_request(f"justvoice_standard import: schema mismatch — {e.errors()[0]['msg']}") from e

    # Preserve the inbound `source` if it's been routed through another
    # adapter previously; otherwise stamp our own.
    if not std.source:
        std.source = SOURCE_ID
    if std.schema_version != SCHEMA_VERSION:
        std.warnings.append(
            f"schema_version mismatch (file={std.schema_version}, server={SCHEMA_VERSION})"
        )
    return std
