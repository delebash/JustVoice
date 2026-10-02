# SPDX-License-Identifier: MIT
"""Tests for Pydantic models — round-trip + default invariants.

models.py is the cross-language source of truth per CLAUDE.md. These tests guard
against silent shape drift.
"""

from __future__ import annotations

from justvoice.models import (
    MasterPresetSettings,
    Settings,
    SettingsPatch,
)


def test_settings_default_serializes() -> None:
    s = Settings()
    payload = s.model_dump()
    rebuilt = Settings.model_validate(payload)
    assert rebuilt == s


def test_settings_patch_optional_fields() -> None:
    # SettingsPatch must allow partial updates.
    patch = SettingsPatch(mastering=MasterPresetSettings())
    assert patch.mastering is not None
    assert patch.server is None
