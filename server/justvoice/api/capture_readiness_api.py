# SPDX-License-Identifier: MIT
"""/v1/capture/readiness — Whisper + LLM model readiness for dictation.

Polled every 5s by useDictationReadiness while either model is missing
or downloading; stops once both green. Drives the 6-gate readiness
checklist + the hotkey-enabled toggle gating in Settings → Captures.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter(tags=["captures"])


class ModelReadiness(BaseModel):
    ready: bool
    display_name: str
    size_mb: Optional[int] = None
    downloading: bool = False
    progress: float = 0.0  # 0..100
    error: Optional[str] = None


class CaptureReadiness(BaseModel):
    stt: ModelReadiness
    llm: ModelReadiness


_WHISPER_DEFAULT = "turbo"

_WHISPER_DISPLAY = {
    "base": "Whisper Base (74M)",
    "small": "Whisper Small (244M)",
    "medium": "Whisper Medium (769M)",
    "large": "Whisper Large (1.5B)",
    "turbo": "Whisper Large v3 Turbo",
}
_WHISPER_SIZE_MB = {"base": 74, "small": 244, "medium": 769, "large": 1500, "turbo": 1500}


def _check_model_cached(hf_repo: str) -> bool:
    """Quick HF cache probe — same shape as engines/_torch_helpers.is_model_cached
    but inline so this endpoint doesn't pull torch into the API import graph.
    """
    try:
        from pathlib import Path

        from huggingface_hub import constants as hf_constants

        repo_cache = Path(hf_constants.HF_HUB_CACHE) / ("models--" + hf_repo.replace("/", "--"))
        if not repo_cache.exists():
            return False
        snaps = repo_cache / "snapshots"
        if not snaps.exists():
            return False
        return bool(list(snaps.rglob("*.safetensors")) or list(snaps.rglob("*.bin")))
    except Exception:
        return False


def _llm_readiness() -> ModelReadiness:
    """The dictation-cleanup LLM = whatever the refine action resolves to on
    the SHARED stack (its preset → provider → model), replacing the retired
    bundled-qwen3 HF-cache probe (F1 Phase 2, 2026-08-05). Ready = the route
    resolves to a model; the LLM engine setup wizard is what fills it."""
    try:
        from llm_runner.llm.dispatch import resolve_route
        from llm_runner.llm.preset_resolve import resolve_feature_preset

        from ..engines.llm.run import jv_llm_config

        preset = resolve_feature_preset("refine.base")
        _adapter, model, _tier = resolve_route(
            jv_llm_config(), "refine", action="refine.base",
            provider_override=(preset.providerId or None) if preset else None,
            model_override=(preset.model or None) if preset else None,
        )
        if model:
            return ModelReadiness(ready=True, display_name=model)
        return ModelReadiness(ready=False, display_name="No AI model selected")
    except Exception:  # noqa: BLE001 — not-set-up is a state, not an error
        return ModelReadiness(ready=False, display_name="AI engine not set up")


@router.get("/v1/capture/readiness", response_model=CaptureReadiness)
async def get_capture_readiness() -> CaptureReadiness:
    # Default model picks; in a fuller implementation we'd read these from
    # CaptureSettings. For v1 we use the defaults.
    whisper_model = _WHISPER_DEFAULT
    whisper_ready = _check_model_cached(f"openai/whisper-{whisper_model}")

    return CaptureReadiness(
        stt=ModelReadiness(
            ready=whisper_ready,
            display_name=_WHISPER_DISPLAY.get(whisper_model, whisper_model),
            size_mb=_WHISPER_SIZE_MB.get(whisper_model),
        ),
        llm=_llm_readiness(),
    )
