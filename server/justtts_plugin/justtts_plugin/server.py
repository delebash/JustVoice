"""FastAPI shim each engine subprocess runs.

`serve(engine)` boots a FastAPI on an OS-assigned port (port 0 → kernel
picks one), writes the port to stdout as one line `PORT=<n>` so the host
can read it back, then accepts the host's HTTP calls (`/health, /load,
/voices, /synth, /clone, /info, /unload`).

Why HTTP, not stdio JSON-RPC: easy to curl-debug an engine in isolation,
binary audio comes back as raw bytes (no base64 overhead), FastAPI is
already in our deps. The LSP/MCP stdio pattern wins where editors can't
manage ports — that's not us.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import logging
import os
import signal
import sys
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict

from .embedded import EmbeddedEngine
from .protocol import SynthRequest

log = logging.getLogger("justvoice_plugin.server")


# ─── Pydantic models for the HTTP envelope ─────────────────────────────


class LoadBody(BaseModel):
    device: str = "auto"
    variant: str | None = None


class SynthBody(BaseModel):
    voice_id: str
    text: str
    language: str | None = None
    delivery: dict[str, Any] = {}
    seed: int | None = None
    audio_prompt_path: str | None = None

    model_config = ConfigDict(extra="allow")


class CloneBody(BaseModel):
    name: str
    wav_b64: str
    transcript: str | None = None


# ─── App factory ───────────────────────────────────────────────────────


def make_app(engine: EmbeddedEngine) -> FastAPI:
    app = FastAPI(title=f"JustVoice engine: {engine.meta.engine_id or 'unknown'}")

    @app.get("/health")
    async def health():
        return {
            "engine_id": engine.meta.engine_id,
            "loaded": engine.is_loaded(),
            "supports_cloning": engine.meta.supports_cloning,
        }

    @app.get("/info")
    async def info():
        return {
            "engine_id": engine.meta.engine_id,
            "display_name": engine.meta.display_name,
            "backend": engine.meta.backend,
            "supports_cloning": engine.meta.supports_cloning,
            "supports_voice_design": engine.meta.supports_voice_design,
            "supports_streaming": engine.meta.supports_streaming,
            "supports_paralinguistic_tags": engine.meta.supports_paralinguistic_tags,
            "supports_instruct_field": engine.meta.supports_instruct_field,
            "supports_embedding_blending": engine.meta.supports_embedding_blending,
            "supports_training": engine.meta.supports_training,
        }

    @app.post("/load")
    async def load(body: LoadBody):
        try:
            await asyncio.to_thread(engine.load, body.device, body.variant)
            engine._loaded = True
        except Exception as e:
            log.exception("engine load failed")
            raise HTTPException(status_code=503, detail=f"engine load failed: {e}")
        # Voices may take a moment; surface them so the host can populate
        # its catalog from one round-trip.
        try:
            voices = [v.__dict__ for v in (await asyncio.to_thread(engine.voices))]
        except Exception as e:
            log.warning("engine.voices() raised after load: %s", e)
            voices = []
        return {"loaded": True, "voices": voices}

    @app.get("/voices")
    async def voices():
        if not engine.is_loaded():
            raise HTTPException(status_code=409, detail="engine not loaded")
        return {"voices": [v.__dict__ for v in (await asyncio.to_thread(engine.voices))]}

    @app.post("/synth")
    async def synth(body: SynthBody):
        if not engine.is_loaded():
            raise HTTPException(status_code=409, detail="engine not loaded")
        req = SynthRequest(
            voice_id=body.voice_id,
            text=body.text,
            language=body.language,
            delivery=body.delivery or {},
            seed=body.seed,
            audio_prompt_path=body.audio_prompt_path,
        )
        try:
            out = await asyncio.to_thread(engine.synth, req)
        except Exception as e:
            log.exception("engine synth failed")
            raise HTTPException(status_code=500, detail=f"engine synth failed: {e}")
        # Send raw bytes back; the host re-wraps if needed. Header carries
        # sample rate / channels for raw-PCM responses (is_wav_container=False).
        from fastapi.responses import Response

        media = "audio/wav" if out.is_wav_container else "audio/L16"
        headers = {
            "X-JustVoice-Sample-Rate": str(out.sample_rate),
            "X-JustVoice-Channels": str(out.channels),
            "X-JustVoice-WAV-Container": "1" if out.is_wav_container else "0",
        }
        return Response(content=out.audio_bytes, media_type=media, headers=headers)

    @app.post("/clone")
    async def clone(body: CloneBody):
        if not engine.is_loaded():
            raise HTTPException(status_code=409, detail="engine not loaded")
        if not engine.meta.supports_cloning:
            raise HTTPException(status_code=501, detail="engine does not support voice cloning")
        try:
            resp = await asyncio.to_thread(engine.clone, body.name, body.wav_b64, body.transcript)
        except NotImplementedError as e:
            raise HTTPException(status_code=501, detail=str(e))
        except Exception as e:
            log.exception("engine clone failed")
            raise HTTPException(status_code=500, detail=f"engine clone failed: {e}")
        return resp.__dict__

    @app.post("/unload")
    async def unload():
        try:
            await asyncio.to_thread(engine.unload)
        except Exception as e:
            log.warning("engine unload raised (ignoring): %s", e)
        engine._loaded = False
        return {"unloaded": True}

    @app.post("/shutdown")
    async def shutdown():
        """Graceful shutdown — host calls this before SIGTERM to let the
        engine release GPU memory cleanly."""
        try:
            if engine.is_loaded():
                await asyncio.to_thread(engine.unload)
        except Exception:
            pass
        os.kill(os.getpid(), signal.SIGTERM)
        return {"shutting_down": True}

    return app


# ─── Public entry point ────────────────────────────────────────────────


def serve(engine: EmbeddedEngine) -> None:
    """Boot a FastAPI on an auto-assigned loopback port. Writes `PORT=<n>`
    to stdout as the first line so the host can read it back, then runs the
    server until SIGTERM.

    Engine `engine.py` files call this at the bottom of `if __name__ ==
    "__main__":` — that's the whole convention.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", default="serve")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    if args.command != "serve":
        # Reserve room for future subcommands (probe, smoke-test, etc.).
        print(f"unknown subcommand: {args.command}", file=sys.stderr)
        sys.exit(2)

    # Configure logging to stderr so it doesn't pollute the PORT= handshake on stdout.
    logging.basicConfig(
        level=os.environ.get("JUSTVOICE_LOG_LEVEL", "INFO"),
        stream=sys.stderr,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    app = make_app(engine)
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)

    # Patch the startup hook so we can announce the bound port on stdout once
    # uvicorn has actually bound. Uvicorn doesn't expose the bound port until
    # after startup, but its `servers` attribute holds the asyncio servers.
    original_startup = server.startup

    async def startup_with_port_announce(sockets=None):
        result = await original_startup(sockets=sockets)
        bound_port = None
        for srv in server.servers or []:
            for sock in srv.sockets or []:
                # AF_INET socket → (host, port); AF_INET6 → (host, port, flowinfo, scopeid)
                addr = sock.getsockname()
                if isinstance(addr, tuple) and len(addr) >= 2:
                    bound_port = addr[1]
                    break
            if bound_port:
                break
        if bound_port is None:
            print("PORT=ERROR", flush=True)
        else:
            print(f"PORT={bound_port}", flush=True)
        return result

    server.startup = startup_with_port_announce
    server.run()
