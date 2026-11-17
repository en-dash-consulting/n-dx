/** Pure catalog checks: no HTTP listener, real config/trust loading, mocked CLI. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLiveVendorProbe } from "../../src/server/llm-catalog.js";
import { checkSavedRun } from "../../src/server/task-run-settings.js";
import { validateRunOptions } from "../../src/server/run-options.js";
import { resolveVendorModel } from "@n-dx/llm-client";
import { buildLlmCatalog, validateCatalogModel } from "../../src/server/routes-llm.js";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), list: vi.fn() }));
vi.mock("@n-dx/llm-client", async (original) => ({
  ...await original<typeof import("@n-dx/llm-client")>(),
  exec: mocks.exec,
  listCodexModels: mocks.list,
}));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-catalog-probe-"));
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  mocks.exec.mockReset().mockResolvedValue({ launched: true, exitCode: 0, stdout: "codex-cli 0.167.0-alpha.3.2", stderr: "" });
  mocks.list.mockReset().mockResolvedValue({ ok: true, models: ["gpt-client-only"] });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
it("offers and validates the client catalog without a key; reports provenance/version/time", async () => {
  const catalog = await buildLlmCatalog(dir, false);
  expect(catalog.codex).toMatchObject({ models: ["gpt-client-only"], provenance: "codex-client-catalog", cli: { version: "0.167.0-alpha.3.2" } });
  expect(Number.isNaN(Date.parse(catalog.codex.checkedAt!))).toBe(false);
  expect(await validateCatalogModel(dir, "codex", "gpt-client-only")).toBeNull();
  expect(await validateCatalogModel(dir, "codex", "gpt-not-listed")).toContain("not in");
});
it("uses local binary selection and rechecks after account/config changes and refresh", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { codex: { cli_path: "/first/codex" } } }));
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list.mock.calls[0][0]).toMatchObject({ binary: "/first/codex", cwd: dir });
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { codex: { cli_path: "/second/codex" } } }));
  mocks.list.mockResolvedValue({ ok: true, models: ["gpt-account-two"] });
  expect((await getLiveVendorProbe("codex", dir)).listing).toEqual({ ok: true, models: ["gpt-account-two"] });
  expect(mocks.list.mock.calls[1][0].binary).toBe("/second/codex");
  await getLiveVendorProbe("codex", dir, { refresh: true });
  expect(mocks.list).toHaveBeenCalledTimes(3);
});
it("does not execute a repository-selected untrusted binary or pass unrelated credentials", async () => {
  await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { codex: { cli_path: "/untrusted/codex" } } }));
  vi.stubEnv("GITHUB_TOKEN", "secret");
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.exec.mock.calls[0][0]).toBe("codex");
  expect(mocks.exec.mock.calls[0][2].env.GITHUB_TOKEN).toBeUndefined();
});
it("retains a dated built-in fallback on failure, even with an API key", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  mocks.list.mockResolvedValue({ ok: false, reason: "Codex model/list timed out; refresh" });
  const catalog = await buildLlmCatalog(dir, false);
  expect(catalog.codex).toMatchObject({ provenance: "built-in", source: "built-in", reason: expect.stringContaining("timed out") });
  expect(catalog.codex.models.length).toBeGreaterThan(0);
  expect(Number.isNaN(Date.parse(catalog.codex.checkedAt!))).toBe(false);
});

it("accepts client models in saved task and launch settings and preserves CLI resolution", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { vendor: "codex" } }));
  expect((await checkSavedRun(dir, { models: { codex: "gpt-client-only" } })).ok).toBe(true);
  expect((await validateRunOptions(dir, { model: "gpt-client-only" })).ok).toBe(true);
  expect(resolveVendorModel("codex", { vendor: "codex", codex: { model: "gpt-client-only" } })).toBe("gpt-client-only");
});

it("uses API discovery and readiness without invoking Codex, and validates the same catalog", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({
    hench: { provider: "api" }, llm: { vendor: "codex", codex: { auth: "api", api_key: "fixture-key" } },
  }));
  const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ data: [{ id: "gpt-6-astra" }, { id: "gpt-api-only" }] }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const catalog = await buildLlmCatalog(dir, false);
  expect(catalog.codex).toMatchObject({
    models: ["gpt-6-astra"], providers: ["cli", "api"], provenance: "vendor-api",
    readiness: { state: "ready", apiKey: true },
  });
  expect(await validateCatalogModel(dir, "codex", "gpt-api-only")).toMatch(/support/i);
  expect(fetch.mock.calls.map(([url]) => url)).toContain("https://api.openai.com/v1/models");
  expect(catalog.codex.cli).toBeUndefined();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.exec.mock.calls.some(([binary]) => binary === "codex")).toBe(false);
  expect(fetch.mock.calls.length).toBeGreaterThan(0);
});

it("does not send a key when Codex direct API conflicts with CLI-login authentication", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({
    hench: { provider: "api" }, llm: { vendor: "codex", codex: { auth: "cli", api_key: "fixture-key" } },
  }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const probe = await getLiveVendorProbe("codex", dir, { provider: "api" });
  expect(probe.listing.ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.exec).not.toHaveBeenCalled();
});

it("keeps custom-endpoint credentials out of public catalog requests", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({
    llm: { codex: { api_endpoint: "https://fixture.invalid/v1", auth: "api", api_key: "fixture-key" } },
  }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const probe = await getLiveVendorProbe("codex", dir, { provider: "api" });
  expect(probe.listing).toMatchObject({ ok: false, reason: expect.stringContaining("custom") });
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the task or launch provider override for a CLI-only model", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ hench: { provider: "api" }, llm: { vendor: "codex" } }));
  expect((await checkSavedRun(dir, { provider: "cli", models: { codex: "gpt-client-only" } })).ok).toBe(true);
  expect((await validateRunOptions(dir, { provider: "cli", model: "gpt-client-only" })).ok).toBe(true);
});
