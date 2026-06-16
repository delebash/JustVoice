# SPDX-License-Identifier: GPL-3.0-or-later
"""Built-in LLM runner — shared package (JustVoice + JustWrite).

Packages the local llama.cpp runner: hardware detection, prebuilt-binary
selection/download, GGUF model catalog, VRAM-fit flag computation, and the
spawn/lifecycle of `llama-server` (OpenAI-compatible). Designed to be
extracted into a standalone shared Python package consumed by both apps'
backends (see docs/plans/2026-06-16-builtin-llm-runner.md).

The wire/data shapes use **camelCase** (user decision 2026-06-16) so the
same `runner-manifest.json` and REST payloads are consumed identically by
the Python backends and the shared Vue `llm-ui`.

P1.1 (this commit): manifest schema + loader. Subsequent items add binary
acquisition (P1.2), model download (P1.3), spawn + VRAM-fit (P1.4), and
provider registration (P1.5).
"""

from .binary import acquire_binary, acquired_server_exe, binary_dir, select_binary
from .manifest import load_manifest
from .schema import RunnerManifest

__all__ = [
    "load_manifest",
    "RunnerManifest",
    "select_binary",
    "acquire_binary",
    "acquired_server_exe",
    "binary_dir",
]
