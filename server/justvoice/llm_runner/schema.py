# SPDX-License-Identifier: GPL-3.0-or-later
"""Pydantic schema for `runner-manifest.json` — the shared, camelCase,
data-only contract that both apps read (anti-drift artifact).

Why camelCase: user decision 2026-06-16. Python attributes stay idiomatic
snake_case; `CamelModel` aliases them to camelCase for JSON I/O via
`to_camel`, with `populate_by_name=True` so either form parses on input.
Serialize with `.model_dump(by_alias=True)` to emit camelCase.

Why a separate module (not server/justvoice/models.py): this package is
slated to be extracted into a shared library consumed by JustWrite too, so
its schema must be portable rather than coupled to JustVoice's core API
models. (CLAUDE.md keeps models.py as the source of truth for JustVoice's
own request/response surface; the manifest is config data for the shared
runner.)
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base: snake_case in Python, camelCase on the wire, both on input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",  # a typo'd manifest key should fail loudly, not silently
    )


# ─── llama.cpp binary distribution ──────────────────────────────────────


class BinaryAsset(CamelModel):
    """One prebuilt `llama-server` distribution, selected by platform + gpu.

    Either `asset_url` (a direct GitHub-release zip — official Windows CUDA
    builds bundle cudart; macOS Metal builds) OR `source="docker"` + `image`
    (Linux CUDA, where bare prebuilt binaries are less consistent).
    """

    platform: str            # "windows" | "macos" | "linux"
    gpu: str                 # "cuda12" | "cuda13" | "metal" | "cpu" | "vulkan" | "rocm"
    source: str = "github"   # "github" | "docker"
    asset_url: str | None = None     # github release zip URL
    image: str | None = None         # docker image ref (source="docker")
    sha256: str | None = None        # verified at download when present
    server_exe: str = "llama-server"  # exe name inside the unpacked archive


class LlamacppSpec(CamelModel):
    """The pinned llama.cpp build + its per-platform binary assets.

    `pinned_build` is an EXACT release tag (e.g. "b9644") — never "latest",
    which breaks when llama.cpp changes its server API. Bump deliberately
    and re-verify asset availability for the new tag.
    """

    pinned_build: str
    binaries: list[BinaryAsset] = []


# ─── Model catalog ──────────────────────────────────────────────────────


class RecommendedFor(CamelModel):
    min_vram_mb: int | None = None   # lowest VRAM this is viable on (MoE → low)


class ModelEntry(CamelModel):
    """One GGUF model option. Tiered so the runner can recommend per hardware;
    the ACTUAL attribution pick is benchmark-driven, not pre-decided.

    All GGUFs come from HuggingFace. `hf_repo` is an HF org/repo (e.g.
    "unsloth/Qwen3.6-35B-A3B-MTP-GGUF" — Unsloth is an HF publisher of
    dynamic "UD-" quants; "Qwen"/"bartowski" are alternatives). The runner
    resolves the actual filename(s) from the HF tree at download time using
    `quant`, so no fabricated/hardcoded filenames live here.
    """

    id: str
    name: str
    tier: str                         # "cpu" | "low-vram-moe" | "mid" | "high"
    candidate_for: list[str] = []     # e.g. ["attribution"] — candidate, benchmark-validated
    hf_repo: str
    quant: str                        # e.g. "UD-Q4_K_XL"; runner resolves files from HF tree
    mmproj: str | None = None         # sidecar filename if the model requires one
    total_params: str | None = None
    active_params: str | None = None  # set for MoE models (e.g. "3.6B")
    mtp: bool = False                 # MTP-enabled GGUF → enables draft-mtp speculative decoding
    min_ram_mb: int | None = None
    recommended_for: RecommendedFor = RecommendedFor()


# ─── Flag presets + VRAM-fit ────────────────────────────────────────────


class TurboquantPreset(CamelModel):
    """Experimental KV-cache quant — lives in a FORK, never a hard dep."""

    experimental: bool = True
    fork: str | None = None
    flags: list[str] = []


class FlagPresets(CamelModel):
    """Mainline llama.cpp flag groups the spawner composes per model/hardware.

    `base` always applies; `mtp` is added for MTP-tagged models; `turboquant`
    is opt-in/experimental only.
    """

    base: list[str] = []
    mtp: list[str] = []
    turboquant: TurboquantPreset = TurboquantPreset()


class VramFit(CamelModel):
    """Inputs to the spawn-time fit computation (nGpuLayers / nCpuMoe from
    detected VRAM + model layer bytes + post-quant KV-cache bytes), plus the
    probe-and-back-off safety margin. Tiers are advisory labels.
    """

    safety_margin_mb: int = 1024
    tiers: dict[str, int] = {}        # label -> max VRAM mb for the tier (advisory)


class RunnerManifest(CamelModel):
    """Top-level shared manifest. `schema_version` gates compatibility."""

    schema_version: int = 1
    llamacpp: LlamacppSpec
    models: list[ModelEntry] = []
    flag_presets: FlagPresets = FlagPresets()
    vram_fit: VramFit = VramFit()
