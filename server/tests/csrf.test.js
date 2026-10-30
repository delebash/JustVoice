// SPDX-License-Identifier: MIT
// The CSRF Origin guard (the kit's csrf.js) — the no-token "do the vector directly" hardening
// (the port of tests/test_csrf.py). JustVoice addition: the loopback origin_regex from
// settings.cors is part of the ONE allowlist, so a local page on any loopback port stays
// allowed while a foreign web origin is rejected on mutations.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const project = (name) => ({ json: { name, project_type: "custom" } });

test("cross_site_mutation_rejected", async () => {
  const { c } = await appClient();
  // A malicious page's cross-site mutating request is rejected (the CSRF vector).
  const r = await c.post("/v1/projects", { ...project("T"), headers: { origin: "http://evil.example" } });
  expect(r.status).toBe(403);
  expect(r.json().type.endsWith("/cross-origin")).toBe(true);
});

test("no_origin_and_app_origin_allowed", async () => {
  const { c } = await appClient();
  // No Origin (non-browser client) → allowed.
  expect((await c.post("/v1/projects", project("A"))).status).toBe(201);
  // The app's own dev origin (Vite :1430) → allowed.
  expect((await c.post("/v1/projects", { ...project("B"), headers: { origin: "http://localhost:1430" } })).status).toBe(201);
});

test("loopback_regex_origin_allowed", async () => {
  // JustVoice's CORS posture deliberately admits any loopback origin (settings.cors.origin_regex);
  // CSRF honours the same one allowlist, so a local page on an arbitrary port keeps working.
  const { c } = await appClient();
  const r = await c.post("/v1/projects", { ...project("C"), headers: { origin: "http://localhost:9999" } });
  expect(r.status).toBe(201);
});

test("same_origin_mutation_allowed", async () => {
  // The SERVER-HOSTED UI (headless mode) is same-origin, and browsers DO send Origin on
  // same-origin mutations — derived per request, so any host/port.
  const { c } = await appClient();
  const r = await c.post("/v1/projects", { ...project("S"), headers: { origin: "http://testserver", host: "testserver" } });
  expect(r.status).toBe(201);
});

test("a_page_that_renamed_itself_is_refused", async () => {
  // DNS rebinding: a page whose name now points at this computer is same-origin by CSRF's rule, so the
  // Host guard refuses it — from this computer only this computer's names, or one JUSTVOICE_ALLOWED_HOSTS
  // names (the suites name `testserver`), are answered (the kit's bearerAuth; decided 2026-10-20).
  const { c } = await appClient();
  const r = await c.post("/v1/projects", { ...project("R"), headers: { origin: "http://evil.example", host: "evil.example" } });
  expect(r.status).toBe(403);
  expect(r.json().type.endsWith("/host-not-allowed")).toBe(true);
});

test("cors_never_names_every_origin", async () => {
  // "*" would let any web page read this server (decided 2026-10-20); the setting keeps what it had.
  const { c } = await appClient();
  const r = await c.patch("/v1/settings", { json: { cors: { origins: ["http://localhost:1430", "*"] } } });
  expect(r.status, r.text).toBe(422);
  expect((await c.get("/v1/settings")).json().cors.origins).not.toContain("*");
});

test("cross_site_read_allowed", async () => {
  // GET is not the CSRF vector (and CORS blocks the page from reading the body).
  const { c } = await appClient();
  const r = await c.get("/v1/projects", { headers: { origin: "http://evil.example" } });
  expect(r.status).toBe(200);
});

test("desktop_window_origin_has_cors_with_no_origins_configured", async () => {
  // The window's origin is allowed by CORS whatever the settings list (TASKS step-5 rec 4) —
  // even with every origin and the regex emptied, which used to drop CORS altogether.
  const { c, dir } = await appClient();
  expect((await c.patch("/v1/settings", { json: { cors: { origins: [], origin_regex: "" } } })).status).toBe(200);
  await closeApps();
  const { c: c2 } = await appClient(dir); // CORS is read at boot
  let r = await c2.get("/v1/projects", { headers: { origin: "app://justvoice" } });
  expect(r.headers["access-control-allow-origin"]).toBe("app://justvoice");
  r = await c2.get("/v1/projects", { headers: { origin: "http://localhost:1430" } });
  expect(r.headers["access-control-allow-origin"]).toBeUndefined();
});

test("default_cors_has_no_tauri_origins", async () => {
  const { c } = await appClient();
  let r = await c.get("/v1/projects", { headers: { origin: "tauri://localhost" } });
  expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  r = await c.get("/v1/projects", { headers: { origin: "http://localhost:9999" } });
  expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:9999");
});

// The kit's resourceIsolation (Fetch Metadata), mounted beside csrfOrigin (the template's, the kit's finish list A17):
// a GET has no CSRF check, so another site's <img src=".../v1/..."> made this server work for it. A read the browser
// marks cross-site (or same-site — every page on another loopback port is) is refused unless it carries an Origin
// from the one allowlist above; the window's own media plays with crossorigin="anonymous", which sends its Origin.
const META = (site, mode, dest, more = {}) => ({ "sec-fetch-site": site, "sec-fetch-mode": mode, "sec-fetch-dest": dest, ...more });

test("a_read_the_browser_marks_cross_site_is_refused", async () => {
  const { c } = await appClient();
  let r = await c.get("/v1/projects", { headers: META("cross-site", "no-cors", "image") });
  expect(r.status).toBe(403);
  expect(r.json().type.endsWith("/cross-site")).toBe(true);
  // a plain <audio src> from another loopback port: same-site, no Origin
  expect((await c.get("/v1/projects", { headers: META("same-site", "no-cors", "audio") })).status).toBe(403);
  // a foreign page's fetch
  r = await c.get("/v1/projects", { headers: META("cross-site", "cors", "empty", { origin: "http://evil.example" }) });
  expect(r.status).toBe(403);
  // a link elsewhere straight to the API
  expect((await c.get("/v1/projects", { headers: META("cross-site", "navigate", "document") })).status).toBe(403);
});

test("the_app_s_own_windows_and_pages_read", async () => {
  const { c } = await appClient();
  // the desktop window's fetch, and its <audio crossorigin="anonymous"> (both carry its Origin)
  expect((await c.get("/v1/projects", { headers: META("cross-site", "cors", "empty", { origin: "app://justvoice" }) })).status).toBe(200);
  expect((await c.get("/v1/projects", { headers: META("cross-site", "cors", "audio", { origin: "app://justvoice" }) })).status).toBe(200);
  // the dev server's page, and a local page on any loopback port (the one allowlist's origin_regex)
  expect((await c.get("/v1/projects", { headers: META("same-site", "cors", "audio", { origin: "http://localhost:1430" }) })).status).toBe(200);
  expect((await c.get("/v1/projects", { headers: META("same-site", "cors", "empty", { origin: "http://localhost:9999" }) })).status).toBe(200);
  // the server-hosted UI, the user's own typing, a client with no Fetch Metadata
  for (const site of ["same-origin", "none"]) expect((await c.get("/v1/projects", { headers: META(site, "no-cors", "audio") })).status, site).toBe(200);
  expect((await c.get("/v1/projects")).status).toBe(200);
  // a link from another site to the UI's page passes the guard (the page itself may not be built here)
  expect((await c.get("/", { headers: META("cross-site", "navigate", "document") })).status).not.toBe(403);
});
