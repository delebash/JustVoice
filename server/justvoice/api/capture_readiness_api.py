# SPDX-License-Identifier: GPL-3.0-or-later
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
    # Which STT route is active: "local-whisper" or an external provider id
    # (plan D4). Lets the UI explain readiness in the right terms.
    stt_provider: str = "local-whisper"


_WHISPER_DEFAULT = "turbo"
_LLM_DEFAULT = "0.6B"

_WHISPER_DISPLAY = {
    "base": "Whisper Base (74M)",
    "small": "Whisper Small (244M)",
    "medium": "Whisper Medium (769M)",
    "large": "Whisper Large (1.5B)",
    "turbo": "Whisper Large v3 Turbo",
}
_WHISPER_SIZE_MB = {"base": 74, "small": 244, "medium": 769, "large": 1500, "turbo": 1500}
_LLM_DISPLAY = {
    "0.6B": "Qwen3 0.6B (refinement)",
    "1.7B": "Qwen3 1.7B (refinement)",
    "4B": "Qwen3 4B (refinement)",
}
_LLM_SIZE_MB = {"0.6B": 400, "1.7B": 1100, "4B": 2500}


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


@router.get("/v1/capture/readiness", response_model=CaptureReadiness)
async def get_capture_readiness() -> CaptureReadiness:
    """Two gates: (1) the Whisper size picked in settings.captures is in
    the HF cache (loaded-or-loadable without a download), and (2) an LLM
    provider is registered for refinement. The UI keys the Record button
    and the refine affordance off these independently — STT-only
    dictation works without any LLM."""
    from ..app_state import get_state
    from ..engines.llm.registry import get_llm_registry
    from ..engines.manager import get_manager

    settings = get_state().settings.get()
    whisper_model = getattr(settings.captures, "stt_model", _WHISPER_DEFAULT)

    # Online STT provider active (plan D4): readiness is credentials, not
    # a local model — no download gate at all.
    provider_id = getattr(settings.captures, "stt_provider", "local-whisper")
    external_cfg = None
    if provider_id and provider_id != "local-whisper":
        for cfg in getattr(settings.engines, "external_stt", []):
            if cfg.id == provider_id:
                external_cfg = cfg
                break

    if provider_id != "local-whisper":
        if external_cfg is None:
            stt_readiness = ModelReadiness(
                ready=False,
                display_name=f"Unknown STT provider {provider_id!r}",
                error="Provider not found — register it on the Engines → STT tab.",
            )
        else:
            has_url = bool(external_cfg.base_url)
            stt_readiness = ModelReadiness(
                ready=has_url,
                display_name=f"{external_cfg.name or external_cfg.id} (online STT)",
                error=None if has_url else "Provider has no base URL configured.",
            )
        adapters = get_llm_registry().all()
        return CaptureReadiness(
            stt=stt_readiness,
            llm=ModelReadiness(
                ready=bool(adapters),
                display_name=(
                    f"LLM refinement ({adapters[0].id})" if adapters else "LLM refinement (no provider)"
                ),
            ),
            stt_provider=provider_id,
        )

    mgr = get_manager()
    stt_loaded = mgr.loaded_for("stt") is not None
    whisper_ready = stt_loaded or _check_model_cached(f"openai/whisper-{whisper_model}")

    adapters = get_llm_registry().all()
    llm_ready = bool(adapters)
    llm_label = (
        f"LLM refinement ({adapters[0].id})" if adapters else "LLM refinement (no provider)"
    )

    return CaptureReadiness(
        stt=ModelReadiness(
            ready=whisper_ready,
            display_name=_WHISPER_DISPLAY.get(whisper_model, whisper_model),
            size_mb=_WHISPER_SIZE_MB.get(whisper_model),
        ),
        llm=ModelReadiness(
            ready=llm_ready,
            display_name=llm_label,
        ),
        stt_provider="local-whisper",
    )
