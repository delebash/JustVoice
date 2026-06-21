# SPDX-License-Identifier: GPL-3.0-or-later
"""JustVoice LLM engine glue.

The LLM provider/dispatch implementation is the shared `llm_runner.llm`
package — import contracts, adapters, registry, tiers, usage and dispatch
from there directly. This package holds only the JustVoice-specific pieces:
  - `config.py`        — JV's feature catalog + settings→LLMConfig mapping.
  - `local_managed.py` — registers the bundled local llama.cpp runner.
"""
