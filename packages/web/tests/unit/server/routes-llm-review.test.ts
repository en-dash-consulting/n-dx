/**
 * Unit tests for the `review` block of `GET /api/llm/config` and the review
 * keys `PUT /api/llm/config` saves.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";
import type { ReviewInfo } from "../../../src/server/llm-review.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-review-"));
  server = createServer((req, res) => {
    void handleLlmRoute(req, res, { projectDir } as never).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeNdxConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function writeHenchConfig(config: unknown): Promise<void> {
  await mkdir(join(projectDir, ".hench"), { recursive: true });
  await writeFile(join(projectDir, ".hench", "config.json"), JSON.stringify(config), "utf-8");
}

async function review(): Promise<ReviewInfo> {
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  return (await res.json()).review;
}

async function put(changes: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/llm/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

describe("GET /api/llm/config — review block", () => {
  it("reports defaults with their source for an unconfigured project", async () => {
    const info = await review();
    expect(info.mode).toEqual({ value: "off", source: "default" });
    expect(info.rounds).toEqual({ value: 2, source: "default" });
    expect(info.vendor).toEqual({ value: "codex", source: "default" });
    expect(info.available).toBe(true);
    expect(info.unavailableReason).toBeUndefined();
    expect(info.pairSupported).toBe(false);
    expect(info.models.claude?.source).toBe("vendor-default");
    expect(info.models.codex?.source).toBe("vendor-default");
  });

  it("names the file each saved setting came from", async () => {
    await writeHenchConfig({ review: { mode: "pair", rounds: 3 } });
    await writeNdxConfig({ hench: { review: { mode: "self", vendor: "codex" } } });
    const info = await review();
    expect(info.mode).toEqual({ value: "self", source: "project-config" });
    expect(info.vendor).toEqual({ value: "codex", source: "project-config" });
    expect(info.rounds).toEqual({ value: 3, source: "hench-config" });
  });

  it("treats a value hench's schema would refuse as unset", async () => {
    await writeHenchConfig({ review: { mode: "sometimes", rounds: 9 } });
    const info = await review();
    expect(info.mode.source).toBe("default");
    expect(info.rounds.source).toBe("default");
  });

  it("resolves reviewer models vendor key, then shared key, then default", async () => {
    await writeNdxConfig({
      llm: { reviewModel: "opus", codex: { reviewModel: "gpt-5.1-codex" } },
    });
    const info = await review();
    expect(info.models.codex).toMatchObject({ model: "gpt-5.1-codex", source: "vendor-config" });
    expect(info.models.claude?.source).toBe("shared-config");
  });

  it("is unavailable, with a reason, when the vendor has no CLI", async () => {
    await writeNdxConfig({ llm: { vendor: "google" } });
    const info = await review();
    expect(info.available).toBe(false);
    expect(info.unavailableReason).toMatch(/CLI/);
    expect(info.vendor.value).toBeNull();
  });

  it("is unavailable when the effective provider is the API", async () => {
    await writeHenchConfig({ provider: "api" });
    const info = await review();
    expect(info.available).toBe(false);
    expect(info.unavailableReason).toMatch(/API/);
  });
});

describe("PUT /api/llm/config — review keys", () => {
  it("saves the four review keys", async () => {
    const res = await put({
      "hench.review.mode": "pair",
      "hench.review.vendor": "codex",
      "hench.review.rounds": 3,
      "llm.codex.reviewModel": "gpt-5.1-codex",
    });
    expect(res.status).toBe(200);
    const saved = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
    expect(saved.hench.review).toEqual({ mode: "pair", vendor: "codex", rounds: 3 });
    expect(saved.llm.codex.reviewModel).toBe("gpt-5.1-codex");
    const { config } = await res.json();
    expect(config.review.mode.value).toBe("pair");
    expect(config.review.models.codex.source).toBe("vendor-config");
  });

  it("clears a review key and leaves no empty hench section", async () => {
    await writeNdxConfig({ hench: { review: { mode: "self" } } });
    const res = await put({ "hench.review.mode": null });
    expect(res.status).toBe(200);
    const saved = JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8"));
    expect(saved.hench).toBeUndefined();
  });

  it("rejects a reviewer equal to llm.vendor, the default vendor included", async () => {
    await writeNdxConfig({ llm: { vendor: "codex" } });
    const res = await put({ "hench.review.vendor": "codex" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/active vendor/);

    await writeNdxConfig({});
    expect((await put({ "hench.review.vendor": "claude" })).status).toBe(400);
  });

  it("judges a reviewer against the llm.vendor saved in the same request", async () => {
    await writeNdxConfig({ llm: { vendor: "codex" } });
    const res = await put({ "llm.vendor": "claude", "hench.review.vendor": "codex" });
    expect(res.status).toBe(200);
  });

  it("rejects a google reviewer", async () => {
    const res = await put({ "hench.review.vendor": "google" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/claude, codex/);
  });

  it.each([0, 4, 1.5])("rejects rounds %s", async (rounds) => {
    const res = await put({ "hench.review.rounds": rounds });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/1 to 3/);
  });

  it("rejects an unknown mode and a reviewModel the vendor cannot run", async () => {
    expect((await put({ "hench.review.mode": "always" })).status).toBe(400);
    expect((await put({ "llm.claude.reviewModel": "gpt-5.1-codex" })).status).toBe(400);
  });

  it("does not write anything when one change in the batch is refused", async () => {
    await put({ "hench.review.mode": "pair", "hench.review.rounds": 0 });
    await expect(readFile(join(projectDir, ".n-dx.json"), "utf-8")).rejects.toThrow();
  });
});
