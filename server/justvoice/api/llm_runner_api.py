# SPDX-License-Identifier: GPL-3.0-or-later
"""GET /v1/llm-runner/manifest — the shared built-in-LLM-runner manifest.

Exposes the camelCase `runner-manifest.json` (pinned llama.cpp build +
per-platform binaries, GGUF model catalog, flag presets, VRAM-fit recipe)
so the renderer / shared Vue `llm-ui` reads the SAME data the backend uses.
See docs/plans/2026-06-16-builtin-llm-runner.md (P1.1).
"""

from __future__ import annotations

from fastapi import APIRouter

from ..llm_runner import RunnerManifest, load_manifest

router = APIRouter(tags=["llm-runner"])


@router.get(
    "/v1/llm-runner/manifest",
    response_model=RunnerManifest,
    response_model_by_alias=True,  # emit camelCase keys
    summary="Built-in LLM runner manifest (binaries, model catalog, flags)",
)
async def get_runner_manifest() -> RunnerManifest:
    return load_manifest()
