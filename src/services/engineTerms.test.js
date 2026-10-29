// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMS_EVENT, handleTermsRefusal, openEngineTerms } from "./engineTerms.js";

describe("the terms door carries what to do once they're accepted (round E, G5)", () => {
  const heard = [];
  const listen = (ev) => heard.push(ev.detail);
  window.addEventListener(TERMS_EVENT, listen);
  afterEach(() => heard.splice(0));

  it("opens an engine's terms with the action to repeat", () => {
    const retry = vi.fn();
    openEngineTerms("pocket", { onAccepted: retry });
    expect(heard).toEqual([{ engine: "pocket", onAccepted: retry }]);
  });

  it("a refusal of the kit's — its model, not our engine — opens the engine the caller names", () => {
    // The kit's 403 terms-required carries `modelId`; JustVoice's own carries `engine`.
    const kit = Object.assign(new Error("Terms not accepted"), { status: 403, problem: { type: "…/errors/terms-required", modelId: "pocket-en" } });
    const retry = vi.fn();
    expect(handleTermsRefusal(kit, { engineId: "pocket", onAccepted: retry })).toBe(true);
    expect(heard).toEqual([{ engine: "pocket", onAccepted: retry }]);
  });

  it("anything else is not the terms", () => {
    expect(handleTermsRefusal(Object.assign(new Error("x"), { status: 409, problem: { type: "…/load-cancelled" } }))).toBe(false);
    expect(heard).toEqual([]);
  });
});
