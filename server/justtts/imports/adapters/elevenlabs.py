# SPDX-License-Identifier: GPL-3.0-or-later
"""ElevenLabs project import adapter — stub.

ElevenLabs Studio exports projects as a proprietary JSON bundle that
includes voice IDs scoped to their cloud account. Mapping their voice
slots to JustVoice personas requires either:

 - an account-side voice manifest fetched via their REST API, or
 - an operator step that hand-maps each ElevenLabs voice to a local
   persona before import.

Both routes are out of scope for the initial multi-adapter pipeline.
This stub is wired into the registry so the UI picker can display
ElevenLabs as an "available soon" choice without crashing if someone
selects it.

Docs link tracked for when this is implemented:
https://elevenlabs.io/docs/api-reference/studio
"""

from __future__ import annotations

from ...errors import not_implemented
from ..standard_schema import StandardImport

SOURCE_ID = "elevenlabs"


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    raise not_implemented(
        "ElevenLabs Studio import is not implemented yet — see "
        "https://elevenlabs.io/docs/api-reference/studio for the source "
        "schema. Track progress in docs/import-formats.md."
    )
