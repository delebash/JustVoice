# SPDX-License-Identifier: MIT
"""JustVoice's ProviderStore — persists the LLM provider list in
`settings.engines.llm` (via SettingsStore).

This is the host side of the shared `llm_runner.llm.provider_api` router
factory: it does real persistence work (read/write JV settings), which is the
genuine boundary RULE #8 allows — the CRUD logic + adapter-registry sync live in
the shared router, not here. JustWrite supplies its own ProviderStore over its
`LlmProvider` table; both mount the same router.
"""

from __future__ import annotations

from justvoice.app_state import get_state
from llm_runner.llm.provider_api import ProviderStore
from llm_runner.llm.schema import LLMProviderConfig


class SettingsProviderStore:
    """ProviderStore backed by `settings.engines.llm`."""

    def list(self) -> list[LLMProviderConfig]:
        return list(get_state().settings.get().engines.llm)

    def get(self, provider_id: str) -> LLMProviderConfig | None:
        return next(
            (p for p in get_state().settings.get().engines.llm if p.id == provider_id),
            None,
        )

    def add(self, cfg: LLMProviderConfig) -> None:
        state = get_state()
        settings = state.settings.get()
        settings.engines.llm.append(cfg)
        state.settings.set(settings)

    def replace(self, provider_id: str, cfg: LLMProviderConfig) -> None:
        state = get_state()
        settings = state.settings.get()
        settings.engines.llm = [
            cfg if p.id == provider_id else p for p in settings.engines.llm
        ]
        state.settings.set(settings)

    def remove(self, provider_id: str) -> None:
        state = get_state()
        settings = state.settings.get()
        settings.engines.llm = [
            p for p in settings.engines.llm if p.id != provider_id
        ]
        state.settings.set(settings)


_store = SettingsProviderStore()


def get_provider_store() -> ProviderStore:
    return _store
