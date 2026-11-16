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
