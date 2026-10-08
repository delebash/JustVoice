// SPDX-License-Identifier: MIT
// Tests for the wire models — round-trip + default invariants (the port of
// tests/test_models.py). models.js is the cross-language source of truth; these guard
// against silent shape drift. (scripts/compare-models.js checks every model against
// Python's field by field.)
import { expect, test } from "vitest";
import { construct, MasterPresetSettings, modelDump, Settings, SettingsPatch } from "../src/models.js";

test("settings_default_serializes", () => {
  const s = construct(Settings, {});
  const payload = modelDump(Settings, s);
  const rebuilt = construct(Settings, payload);
  expect(rebuilt).toEqual(s);
});

test("settings_patch_optional_fields", () => {
  // SettingsPatch must allow partial updates.
  const patch = construct(SettingsPatch, { mastering: construct(MasterPresetSettings, {}) });
  expect(patch.mastering).not.toBeNull();
  expect(patch.server).toBeNull();
});
