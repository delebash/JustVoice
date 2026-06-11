# SPDX-License-Identifier: GPL-3.0-or-later
#
# Adapted from voicebox (MIT) — backend/mcp_server/tools.py at the commit
# pinned in voicebox-pin.txt. Tool surface renamed (justvoice.*), speak
# delegates to JustVoice's /v1/generate pipeline and persists a Generation
# row (voicebox plays on speakers + saves to History; headless JustVoice
# returns a fetchable audio URL instead). transcribe is added alongside the
# bundled Whisper STT engine. Original copyright (c) the voicebox authors.
"""JustVoice MCP tool implementations.

Thin wrappers over existing routes/services. Tools are registered with
dotted names (``justvoice.speak`` etc.) so they look natural in agent logs.
"""

from __future__ import annotations

import logging
from typing import Any

from fastmcp import FastMCP

from ..app_state import get_state
from .context import current_client_id
from .resolve import resolve_voice

log = logging.getLogger(__name__)


def register_tools(mcp: FastMCP) -> None:
    """Attach all JustVoice tools to the given FastMCP instance."""

    @mcp.tool(
        name="justvoice.speak",
        description=(
            "Render text to speech in a JustVoice voice. Returns a "
            "generation id plus an audio_url you can GET for the WAV. "
            "Pass `voice` (a voice id) or `persona` (a character name); "
            "with neither, the per-client binding or the global default "
            "voice applies."
        ),
    )
    async def justvoice_speak(
        text: str,
        voice: str | None = None,
        persona: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        from ..database import get_db

        db = next(get_db())
        try:
            client_id = current_client_id.get()
            resolved = resolve_voice(voice, persona, client_id, db)
            if resolved is None:
                raise ValueError(
                    "No voice resolved. Pass `voice=` with a voice id or "
                    "`persona=` with a character name, bind a persona to "
                    "this client at POST /v1/mcp/bindings, or set "
                    "settings.mcp.default_voice."
                )
            return await _speak(
                voice_id=resolved.voice_id,
                persona=resolved.persona,
                text=text,
                language=language,
                db=db,
            )
        finally:
            db.close()

    @mcp.tool(
        name="justvoice.list_voices",
        description=(
            "List available voices (presets, cloned, designed). Use the "
            "returned `id` with justvoice.speak(voice=...)."
        ),
    )
    async def justvoice_list_voices(limit: int = 200) -> dict[str, Any]:
        if not (1 <= limit <= 1000):
            raise ValueError("`limit` must be between 1 and 1000.")
        # Delegate to the real /v1/voices route (upstream pattern: tools are
        # thin wrappers over existing routes) so the tool sees exactly what
        # the UI sees — managed-engine manifest presets included.
        from ..api.voices_api import list_voices as list_voices_route

        result = await list_voices_route()
        voices = [
            {
                "id": v.id,
                "name": v.name,
                "engine": v.engine,
                "source": v.source,
                "language": v.language,
                "gender": v.gender or None,
            }
            for v in result.voices
        ]
        return {"voices": voices[:limit], "total": len(voices)}

    @mcp.tool(
        name="justvoice.list_personas",
        description=(
            "List personas (characters) with their bound voice. Use the "
            "returned `name` with justvoice.speak(persona=...)."
        ),
    )
    async def justvoice_list_personas() -> dict[str, Any]:
        personas = get_state().personas.list()
        return {
            "personas": [
                {
                    "id": p.id,
                    "name": p.name,
                    "voice_id": p.voice_id,
                    "language": p.language,
                    "has_personality": bool(p.personality),
                }
                for p in personas
            ]
        }


# ─── Speak helper ──────────────────────────────────────────────────────────


async def _speak(
    *,
    voice_id: str,
    persona,
    text: str,
    language: str | None,
    db,
) -> dict[str, Any]:
    """Delegate to the /v1/generate pipeline, persist a Generation row, and
    return ids + a fetchable audio URL."""
    from ..api.generate_api import generate as generate_route
    from ..database.models import Generation
    from ..models import GenerateRequest
    from ..paths import generations_root

    req = GenerateRequest(
        voice=voice_id,
        text=text,
        language=language or (persona.language if persona else None),
        persona_id=persona.id if persona else None,
    )
    response = await generate_route(req)
    wav: bytes = bytes(response.body)

    state = get_state()
    gen = Generation(
        persona_id=persona.id if persona else None,
        text=text,
        language=language or "en",
        engine=state.engines.current() or "managed",
        status="completed",
        source="mcp",
        duration_sec=round((len(wav) - 44) / (2 * 16000), 3) if len(wav) > 44 else None,
    )
    db.add(gen)
    db.flush()

    out_dir = generations_root(state.data_dir)
    out_path = out_dir / f"{gen.id}.wav"
    out_path.write_bytes(wav)
    gen.audio_path = str(out_path)
    db.commit()

    return {
        "generation_id": gen.id,
        "status": "completed",
        "voice": voice_id,
        "persona": persona.name if persona else None,
        "duration_sec": gen.duration_sec,
        "audio_url": f"/v1/generations/{gen.id}/audio",
        "source": "mcp",
    }
