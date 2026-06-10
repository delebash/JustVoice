# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for Pydantic models — round-trip + default invariants.

models.py is the cross-language source of truth per CLAUDE.md. These tests guard
against silent shape drift.
"""

from __future__ import annotations

from justvoice.models import (
    MasterPresetSettings,
    Settings,
    SettingsPatch,
    TrainingSettings,
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


def test_training_settings_defaults_sane() -> None:
    t = TrainingSettings()
    assert t.enabled is True
    assert t.max_concurrent_jobs >= 1
    assert t.max_samples_per_job > 0
    assert t.validation.min_sample_duration_secs > 0
    assert t.validation.max_sample_duration_secs > t.validation.min_sample_duration_secs
