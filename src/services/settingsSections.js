// SPDX-License-Identifier: MIT
// JustVoice's Settings sections, in render order — ONE list the view renders and
// the contract test asserts (parity batch slice 11). The family sections must keep
// the canon RELATIVE order (kit familyContract SETTINGS_SECTION_ORDER); app-own
// sections (General leading, the voice lane trailing) sit around them. Labels stay
// in the view (family words the kit's `kit.settingsSections.*` keys, app words literal).
export const SETTINGS_SECTION_IDS = [
  "general",
  "appearance",
  "backups",
  "sync", // app section (not yet the family canon — docgen has no sync)
  "storage",
  "server",
  "logs",
  "updates",
  "about",
  // JV's own lane.
  "mastering",
  "generation",
  "capture",
  "mcp",
  "gpu",
  "cache",
  // "channels" is hidden until routing a persona to an audio output is built (decided
  // 2026-10-15; IDEAS "Audio output channels"); its component and API stay.
  "webhooks",
];
