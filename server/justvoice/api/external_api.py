"""External OpenAI-compatible TTS server probe + live add/remove."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter

from ..app_state import get_state
from ..engines.external_openai import ExternalOpenAiTtsBackend
from ..errors import bad_request, conflict, not_found
from ..models import ExternalEngineConfig, ProbeRequest, ProbeResponse, SettingsPatch

log = logging.getLogger(__name__)
router = APIRouter(tags=["engines"])


def _extract_model_ids(body) -> list[str]:
    if isinstance(body, dict) and isinstance(body.get("data"), list):
        return [m["id"] for m in body["data"] if isinstance(m, dict) and "id" in m]
    if isinstance(body, list):
        out: list[str] = []
        for item in body:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict) and "id" in item:
                out.append(item["id"])
        return out
    return []


def _extract_voice_ids(body) -> list[str]:
    if isinstance(body, dict) and isinstance(body.get("voices"), list):
        body = body["voices"]
    if isinstance(body, list):
        out: list[str] = []
        for v in body:
            if isinstance(v, str):
                out.append(v)
            elif isinstance(v, dict):
                if "id" in v:
                    out.append(v["id"])
                elif "name" in v:
                    out.append(v["name"])
        return out
    return []


def _server_hint(base: str, models: list[str], voices: list[str]) -> str:
    lower = base.lower()
    if "openai.com" in lower:
        return "openai"
    if "kokoro" in models or any(
        v.startswith(("af_", "am_", "bf_", "bm_", "ef_", "em_")) for v in voices
    ):
        return "kokoro-fastapi"
    if "tts-1" in models or "tts-1-hd" in models:
        return "openai-edge-tts"
    return "unknown"


@router.post("/v1/engines/external/probe", response_model=ProbeResponse)
async def probe_external(req: ProbeRequest) -> ProbeResponse:
    base = req.base_url.strip().rstrip("/")
    if not base:
        raise bad_request("base_url must not be empty")
    if not (base.startswith("http://") or base.startswith("https://")):
        raise bad_request("base_url must start with http:// or https://")

    headers = {"Authorization": f"Bearer {req.api_key}"} if req.api_key else {}
    reachable = False
    error: str | None = None
    models: list[str] = []
    voices: list[str] = []

    async with httpx.AsyncClient(timeout=8.0) as client:
        try:
            r = await client.get(f"{base}/v1/models", headers=headers)
            reachable = True
            if r.status_code < 400:
                models = _extract_model_ids(r.json())
        except Exception as e:
            error = f"/v1/models: {e}"

        for path in ("/v1/audio/voices", "/v1/voices"):
            try:
                r = await client.get(f"{base}{path}", headers=headers)
                reachable = True
                if r.status_code < 400:
                    voices = _extract_voice_ids(r.json())
                    if voices:
                        break
            except Exception:
                pass

        if not reachable:
            try:
                r = await client.head(base + "/")
                reachable = r.status_code < 600
            except Exception:
                pass

    hint = _server_hint(base, models, voices)
    recommended_model = models[0] if models else {
        "kokoro-fastapi": "kokoro",
        "openai": "tts-1",
        "openai-edge-tts": "tts-1",
    }.get(hint)

    return ProbeResponse(
        reachable=reachable,
        models=models,
        voices=voices,
        server_hint=hint,  # type: ignore
        recommended_model=recommended_model,
        error=None if reachable else error,
    )


@router.post("/v1/engines/external", response_model=ExternalEngineConfig, status_code=201)
async def add_external_engine(cfg: ExternalEngineConfig) -> ExternalEngineConfig:
    st = get_state()
    if not cfg.id.strip():
        raise bad_request("id must not be empty")
    if not cfg.base_url.strip():
        raise bad_request("base_url must not be empty")
    if st.engines.has(cfg.id):
        raise conflict(f"Engine id '{cfg.id}' is already registered.")

    backend = ExternalOpenAiTtsBackend(
        id=cfg.id,
        name=cfg.name,
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        model=cfg.model,
        voices=cfg.voices,
        response_format=cfg.response_format,
    )
    st.engines.register(backend)

    current = st.settings.get()
    current.engines.external = [e for e in current.engines.external if e.id != cfg.id]
    current.engines.external.append(cfg)
    st.settings.patch(SettingsPatch(engines=current.engines))

    return cfg


@router.delete("/v1/engines/external/{id}", status_code=200)
async def remove_external_engine(id: str) -> dict:
    st = get_state()
    current = st.settings.get()
    before = len(current.engines.external)
    current.engines.external = [e for e in current.engines.external if e.id != id]
    if len(current.engines.external) == before:
        raise not_found(f"No external engine with id '{id}' in settings")
    st.engines.unregister(id)
    st.settings.patch(SettingsPatch(engines=current.engines))
    return {"removed": id}
