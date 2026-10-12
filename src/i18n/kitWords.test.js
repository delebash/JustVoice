// SPDX-License-Identifier: MIT
// The kit's words through JustVoice's vue-i18n instance (the family's i18n plan, Task 1 step B —
// just-llm-runner/docs/plans/2026-10-12-i18n-standard.md): the kit's catalog first, JustVoice's own
// `kit.*` keys winning, the kit's catalog itself never reworded.
import { describe, expect, it } from "vitest";

import { kitMessages } from "../../../just-llm-runner/ui/src/i18n/index.js";
import { i18n } from "./index.js";

const { t } = i18n.global;
const KIT = kitMessages().en.kit;

describe("the kit's words in JustVoice", () => {
  it("JustVoice's own words win over the kit's", () => {
    expect(t("kit.aiTabs.providers")).toBe("LLM providers");
    expect(t("kit.aiOffer.quickSetup")).toBe("Run LLM engine setup");
    expect(t("kit.quickSetup.runButton")).toBe("Run LLM engine setup");
    expect(t("kit.catalog.chatSectionLabel")).toBe("Assistant models");
  });

  it("the kit's other words come through as the kit has them", () => {
    expect(t("kit.aiTabs.routing")).toBe(KIT.aiTabs.routing);
    expect(t("kit.settingsSections.backups")).toBe(KIT.settingsSections.backups);
  });

  it("the kit's own catalog stays unreworded — vue-i18n merges into the objects it is given", () => {
    expect(kitMessages().en.kit.aiTabs.providers).toBe(KIT.aiTabs.providers);
    expect(KIT.aiTabs.providers).not.toBe("LLM providers");
  });
});
