# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from voicebox (MIT) — backend/mcp_server/resolve.py at the commit
# pinned in voicebox-pin.txt. Voicebox resolves to a VoiceProfile; JustVoice
# resolves to (voice_id, persona) since personas carry the voice binding.
# Original copyright (c) the voicebox authors.
"""Voice resolution for MCP tool calls.

Precedence:
  1. Explicit ``voice`` tool arg (a JustVoice voice id)
  2. Explicit ``persona`` tool arg (persona name or id) → its voice
  3. Per-client MCPBinding.persona_id → its voice
  4. settings.mcp.default_voice (global default)
  5. None — caller raises a helpful error
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..app_state import get_state
from ..models import Persona


@dataclass
class Resolved:
    voice_id: str
    persona: Persona | None  # set when the voice came via a persona


def _persona_by_name_or_id(ref: str) -> Persona | None:
    personas = get_state().personas
    p = personas.get(ref)
    if p is not None:
        return p
    ref_lower = ref.strip().lower()
    for cand in personas.list():
        if cand.name.strip().lower() == ref_lower:
            return cand
    return None


def resolve_voice(
    voice: str | None,
    persona: str | None,
    client_id: str | None,
    db: Session,
) -> Resolved | None:
    """Apply the full precedence chain. Returns None when nothing resolves."""
    if voice:
        return Resolved(voice_id=voice, persona=None)

    if persona:
        p = _persona_by_name_or_id(persona)
        if p is not None and p.voice_id:
            return Resolved(voice_id=p.voice_id, persona=p)
        # Explicit but not found / voiceless — let the caller report it.
        return None

    if client_id:
        from ..database import MCPBinding

        binding = db.query(MCPBinding).filter(MCPBinding.client_id == client_id).first()
        if binding is not None and binding.persona_id:
            p = get_state().personas.get(binding.persona_id)
            if p is not None and p.voice_id:
                return Resolved(voice_id=p.voice_id, persona=p)

    default = get_state().settings.get().mcp.default_voice
    if default:
        return Resolved(voice_id=default, persona=None)

    return None
