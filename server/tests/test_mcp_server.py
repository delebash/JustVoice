# SPDX-License-Identifier: MIT
"""MCP server tests — the /mcp mount, tool registration, and voice
resolution precedence. Speak's render path needs a loaded engine, so it's
covered by the e2e suite; here we verify the wiring that was previously
the lifted-not-wired gap (bindings table with no server reading it).
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


def test_mcp_mounted(app) -> None:
    mounts = [r.path for r in app.routes if r.__class__.__name__ == "Mount"]
    assert "/mcp" in mounts, f"/mcp not mounted; mounts: {mounts}"


def test_tools_registered() -> None:
    import asyncio

    from fastmcp import Client

    from justvoice.mcp.server import build_mcp_server

    async def _run():
        async with Client(build_mcp_server()) as client:
            return await client.list_tools()

    tools = asyncio.run(_run())
    names = {t.name for t in tools}
    assert {"justvoice.speak", "justvoice.transcribe", "justvoice.list_voices", "justvoice.list_personas"} <= names


def test_resolve_precedence(app) -> None:
    """explicit voice > explicit persona > client binding > settings default."""
    from justvoice.app_state import get_state
    from justvoice.database import MCPBinding, get_db
    from justvoice.mcp.resolve import resolve_voice

    state = get_state()
    persona = state.personas.create(name="Mara Vance", voice_id="af_heart")
    db = next(get_db())
    try:
        # 1. Explicit voice wins outright.
        r = resolve_voice("voice-x", "Mara Vance", "cli-1", db)
        assert r is not None and r.voice_id == "voice-x" and r.persona is None

        # 2. Persona by NAME (case-insensitive) resolves to its voice.
        r = resolve_voice(None, "mara vance", None, db)
        assert r is not None and r.voice_id == "af_heart" and r.persona.id == persona.id

        # 3. Client binding's persona applies when no explicit args.
        db.add(MCPBinding(client_id="cli-1", persona_id=persona.id))
        db.commit()
        r = resolve_voice(None, None, "cli-1", db)
        assert r is not None and r.voice_id == "af_heart"

        # 4. Unknown client with no default → None.
        assert resolve_voice(None, None, "cli-unknown", db) is None

        # 5. settings.mcp.default_voice is the final fallback.
        settings = state.settings.get()
        settings.mcp.default_voice = "fallback-voice"
        state.settings.set(settings)
        r = resolve_voice(None, None, "cli-unknown", db)
        assert r is not None and r.voice_id == "fallback-voice"
    finally:
        db.close()


def test_speak_without_resolvable_voice_raises(app) -> None:
    """The helpful-error contract: no args, no binding, no default."""
    import asyncio

    from fastmcp import Client

    from justvoice.mcp.server import build_mcp_server

    async def _run():
        mcp = build_mcp_server()
        async with Client(mcp) as client:
            with pytest.raises(Exception) as exc_info:
                await client.call_tool("justvoice.speak", {"text": "hello"})
            assert "No voice resolved" in str(exc_info.value)

    asyncio.run(_run())
