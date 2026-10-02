# SPDX-License-Identifier: MIT
"""/v1/capture/readiness — speech-recognition + LLM model readiness for dictation.

Polled every 5s by useDictationReadiness while either model is missing
or downloading; stops once both green. Drives the 6-gate readiness
checklist + the hotkey-enabled toggle gating in Settings → Captures.

Speech recognition is the `asr` engine's model in the speech runtime (the
2026-10-01 switch replaced Whisper): ready = the model the dictation setting
names (`settings.captures.stt_model`) is in the speech cache. It loads on first
use, so "downloaded" is the gate, not "loaded".
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


def _stt_readiness() -> ModelReadiness:
    """The dictation recogniser: on disk in the speech cache = ready."""
    try:
        from ..app_state import get_state
        from ..engines.model_catalog import models_for
        from ..speech_cache import variant_on_disk

        st = get_state()
        want = st.settings.get().captures.stt_model
        variants = models_for("asr")
        v = next((x for x in variants if x.id == want), None) or (variants[0] if variants else None)
        if v is None:
            return ModelReadiness(ready=False, display_name="No speech-recognition model")
        return ModelReadiness(
            ready=variant_on_disk(st.data_dir, "asr", v.id),
            display_name=v.name,
            size_mb=v.size_mb or None,
        )
    except Exception:  # noqa: BLE001 — not-set-up is a state, not an error
        return ModelReadiness(ready=False, display_name="Speech recognition not set up")


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
        _adapter, model = resolve_route(
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
    return CaptureReadiness(stt=_stt_readiness(), llm=_llm_readiness())
