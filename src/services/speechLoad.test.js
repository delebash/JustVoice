// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { readSpeechLoad, speechLoadChannel } from "./speechLoad.js";

// One model's row as GET /v1/ai/runtimes/audiocpp/models answers it.
const row = (over = {}) => ({ id: "qwen3-cv-1.7b-q8", onDisk: true, status: "", loading: "", running: false, loadError: "", ...over });

describe("a speech model's load, read from the kit's model list (round E, G4/G12)", () => {
  it("is done once the runtime holds it", () => {
    expect(readSpeechLoad(row({ running: true }))).toEqual({ terminal: "done" });
  });
  it("shows the download a load of a model not on disk starts first (202 downloading)", () => {
    expect(readSpeechLoad(row({ onDisk: false, status: "downloading", loading: "downloading", downloaded: 5, total: 10 })))
      .toEqual({ detail: "downloading", done: 5, total: 10, status: "downloading" });
  });
  it("then its loading", () => {
    expect(readSpeechLoad(row({ loading: "loading" }))).toEqual({ detail: "loading", status: "loading" });
  });
  it("fails with the runtime's words when the load that ran on its own failed", () => {
    expect(readSpeechLoad(row({ loadError: "not enough memory on the card" }))).toEqual({ terminal: "error", error: "not enough memory on the card" });
  });
  it("ended without loading — an Unload cancelled it — is cancelled", () => {
    expect(readSpeechLoad(row())).toEqual({ terminal: "cancelled" });
  });
});

describe("its start (POST …/models/:id/load)", () => {
  const refusal = (type, status) => Object.assign(new Error(type), { status, problem: { type: `https://x/errors/${type}` } });

  it("asks the kit's route for the model", async () => {
    const api = { post: vi.fn(async () => ({ modelId: "m" })) };
    await speechLoadChannel(api, "qwen3-cv-1.7b-q8").start();
    expect(api.post).toHaveBeenCalledWith("/v1/ai/runtimes/audiocpp/models/qwen3-cv-1.7b-q8/load", {});
  });
  it("hands a licence refusal (403 terms-required) to the caller, and ends without a failure", async () => {
    const onTerms = vi.fn();
    const api = { post: vi.fn(async () => { throw refusal("terms-required", 403); }) };
    await expect(speechLoadChannel(api, "m", { onTerms }).start()).resolves.toBeUndefined();
    expect(onTerms).toHaveBeenCalledOnce();
  });
  it("a load an Unload cancelled (409 load-cancelled) is not a failure", async () => {
    const api = { post: vi.fn(async () => { throw refusal("load-cancelled", 409); }) };
    await expect(speechLoadChannel(api, "m").start()).resolves.toBeUndefined();
  });
  it("any other refusal fails the load", async () => {
    const api = { post: vi.fn(async () => { throw refusal("not-enough-memory", 409); }) };
    await expect(speechLoadChannel(api, "m").start()).rejects.toThrow("not-enough-memory");
  });
  it("Cancel is the kit's Unload", async () => {
    const api = { post: vi.fn(async () => ({})) };
    await speechLoadChannel(api, "m").cancel();
    expect(api.post).toHaveBeenCalledWith("/v1/ai/runtimes/audiocpp/models/m/unload", {});
  });
});
