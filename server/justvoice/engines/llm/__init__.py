# SPDX-License-Identifier: MIT
"""JustVoice LLM engine glue.

The LLM provider/dispatch implementation is the shared `llm_runner.llm`
package — import contracts, adapters, registry, tiers, usage and dispatch
from there directly. This package holds only the JustVoice-specific pieces:
  - `run.py`               — the in-server door onto the shared run path
                             (run_feature over template rows + presets).
  - `migrate_providers.py` — one-time settings→shared-DB provider migration.
  - `migrate_prompts.py`   — one-time jv_feature_prompts→shared migration.
"""
