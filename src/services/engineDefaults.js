// SPDX-License-Identifier: MIT
//
// A model's default version — the user layer the server resolves
// (settings.engines.engine_overrides[id].default_variant; the manager reads it,
// so a no-version load, and a render that has no version of that model loaded,
// speak with it). One door for Speech engines' "Set as default" and the persona
// page's Version choice (decided 2026-10-05).

/** Make `variantId` the engine's default version. Read-modify-write the
 *  overrides map — a bare PATCH would clobber the other engines' overrides. */
export async function setDefaultVariant(api, engineId, variantId) {
  const s = await api.request("/v1/settings");
  const overrides = { ...(s?.engines?.engine_overrides || {}) };
  overrides[engineId] = { ...(overrides[engineId] || {}), default_variant: variantId };
  await api.request("/v1/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engines: { engine_overrides: overrides } }),
  });
}
