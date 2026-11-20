/** Pure catalog checks: no HTTP listener, real config/trust loading, mocked CLI. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CODEX_CATALOG_CACHE_TTL_MS, CATALOG_FAILURE_TTL_MS, clearLlmCatalogCache, getLiveVendorProbe } from "../../src/server/llm-catalog.js";
import { checkSavedRun } from "../../src/server/task-run-settings.js";
import { validateRunOptions } from "../../src/server/run-options.js";
import { resolveVendorModel } from "@n-dx/llm-client";
import { buildLlmCatalog, validateCatalogModel } from "../../src/server/routes-llm.js";
const mocks = vi.hoisted(() => ({ exec: vi.fn(), list: vi.fn(), load: vi.fn() }));
vi.mock("@n-dx/llm-client", async (original) => {
  const actual = await original<typeof import("@n-dx/llm-client")>();
  return { ...actual, exec: mocks.exec, listCodexModels: mocks.list, loadLLMConfig: mocks.load.mockImplementation(actual.loadLLMConfig) };
});
let dir: string;
let authHome: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-catalog-probe-"));
  authHome = await mkdtemp(join(tmpdir(), "ndx-catalog-auth-"));
  // The Windows casing test unsets CODEX_HOME; POSIX config readers then use homedir().
  vi.stubEnv("HOME", authHome);
  vi.stubEnv("USERPROFILE", authHome);
  vi.stubEnv("CODEX_HOME", authHome);
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  mocks.exec.mockReset().mockResolvedValue({ launched: true, exitCode: 0, stdout: "codex-cli 0.167.0-alpha.3.2", stderr: "" });
  mocks.list.mockReset().mockResolvedValue({ ok: true, models: ["gpt-client-only"] });
});
afterEach(async () => {
  clearLlmCatalogCache(dir);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
  await rm(authHome, { recursive: true, force: true });
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
  expect((await buildLlmCatalog(dir, false)).codex.models).toContain("gpt-client-only");
  mocks.list.mockResolvedValue({ ok: false, reason: "Codex model/list timed out; refresh" });
  expect((await checkSavedRun(dir, { models: { codex: "gpt-client-only" } })).ok).toBe(true);
  expect((await validateRunOptions(dir, { model: "gpt-client-only" })).ok).toBe(true);
  expect(resolveVendorModel("codex", { vendor: "codex", codex: { model: "gpt-client-only" } })).toBe("gpt-client-only");
  expect(mocks.list).toHaveBeenCalledTimes(1);
});

it("coalesces concurrent catalog, Prepare/save and launch checks, including the version probe", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { vendor: "codex" } }));
  let finish!: (value: { ok: true; models: string[] }) => void;
  mocks.list.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const requests = [
    buildLlmCatalog(dir, false),
    checkSavedRun(dir, { models: { codex: "gpt-client-only" } }),
    validateRunOptions(dir, { model: "gpt-client-only" }),
    getLiveVendorProbe("codex", dir),
  ];
  await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  finish({ ok: true, models: ["gpt-client-only"] });
  const [, saved, launch] = await Promise.all(requests);
  expect(saved).toMatchObject({ ok: true });
  expect(launch).toMatchObject({ ok: true });
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.exec.mock.calls.filter(([binary]) => binary === "codex")).toHaveLength(1);
});

it("expires successful probes and bounds failures without losing their actionable reason", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { vendor: "codex" } }));
  vi.useFakeTimers({ toFake: ["Date"] });
  const first = await getLiveVendorProbe("codex", dir);
  vi.setSystemTime(Date.now() + CODEX_CATALOG_CACHE_TTL_MS - 1);
  expect(await getLiveVendorProbe("codex", dir)).toBe(first);
  mocks.list.mockResolvedValue({ ok: false, reason: "Codex model/list timed out; check CLI login and connectivity, then refresh." });
  vi.setSystemTime(Date.now() + 1);
  const failed = await getLiveVendorProbe("codex", dir);
  expect(failed.listing.ok).toBe(false);
  expect(await validateCatalogModel(dir, "codex", "gpt-client-only")).toContain("check CLI login and connectivity");
  expect(await checkSavedRun(dir, { models: { codex: "gpt-client-only" } })).toMatchObject({ ok: false, error: expect.stringContaining("check CLI login and connectivity") });
  expect(await validateRunOptions(dir, { model: "gpt-client-only" })).toMatchObject({ ok: false, error: expect.stringContaining("check CLI login and connectivity") });
  expect(mocks.list).toHaveBeenCalledTimes(2);
  mocks.list.mockResolvedValue({ ok: true, models: ["gpt-recovered"] });
  vi.setSystemTime(Date.now() + CATALOG_FAILURE_TTL_MS);
  expect((await getLiveVendorProbe("codex", dir)).listing).toEqual({ ok: true, models: ["gpt-recovered"] });
  expect(mocks.list).toHaveBeenCalledTimes(3);
});

it.each(["auth.json", "config.toml"])("invalidates auth-home %s creation and removal", async (file) => {
  await getLiveVendorProbe("codex", dir);
  await writeFile(join(authHome, file), "fixture-only secret");
  await getLiveVendorProbe("codex", dir);
  await rm(join(authHome, file));
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(3);
});

it("resolves a relative auth home against the probed workspace", async () => {
  vi.stubEnv("CODEX_HOME", relative(dir, authHome));
  await getLiveVendorProbe("codex", dir);
  await writeFile(join(authHome, "auth.json"), "fixture account");
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("observes the default auth home when CODEX_HOME is unset", async () => {
  vi.stubEnv("CODEX_HOME", "");
  vi.stubEnv("HOME", authHome);
  vi.stubEnv("USERPROFILE", authHome);
  await mkdir(join(authHome, ".codex"));
  await getLiveVendorProbe("codex", dir);
  await writeFile(join(authHome, ".codex", "auth.json"), "fixture account");
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("observes a case-insensitive Windows auth-home variable", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  vi.stubEnv("CODEX_HOME", undefined);
  vi.stubEnv("codex_home", authHome);
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    await getLiveVendorProbe("codex", dir);
    expect(mocks.list.mock.calls[0][0].env.codex_home).toBe(authHome);
    await writeFile(join(authHome, "auth.json"), "new fixture account");
    mocks.list.mockResolvedValue({ ok: true, models: ["gpt-new-account"] });
    expect((await getLiveVendorProbe("codex", dir)).listing).toEqual({ ok: true, models: ["gpt-new-account"] });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});

it("invalidates auth mode, effective config, auth home and environment changes", async () => {
  await getLiveVendorProbe("codex", dir);
  for (const codex of [{ auth: "cli" }, { auth: "auto", model: "gpt-pinned" }]) {
    await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { codex } }));
    await getLiveVendorProbe("codex", dir);
  }
  await mkdir(join(authHome, "other"));
  vi.stubEnv("CODEX_HOME", join(authHome, "other"));
  await getLiveVendorProbe("codex", dir);
  vi.stubEnv("OPENAI_API_KEY", "fixture-only-key");
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(5);
});

it("invalidates PATH resolution, executable replacement and symlink retargeting", async () => {
  const bin = join(authHome, "codex");
  const target = join(authHome, "target");
  await writeFile(bin, "first", { mode: 0o755 });
  await writeFile(target, "target", { mode: 0o755 });
  vi.stubEnv("PATH", authHome);
  await getLiveVendorProbe("codex", dir);
  await writeFile(bin, "replacement-longer");
  await getLiveVendorProbe("codex", dir);
  if (process.platform !== "win32") {
    await chmod(bin, 0o644);
    await getLiveVendorProbe("codex", dir);
    await rm(bin);
    await symlink(target, bin);
    await getLiveVendorProbe("codex", dir);
    await writeFile(target, "new-target-content");
    await getLiveVendorProbe("codex", dir);
  }
  vi.stubEnv("PATH", join(authHome, "absent"));
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(process.platform === "win32" ? 3 : 6);
});

it.each(["clear", "refresh", "config", "account", "binary"])("does not let an old pending probe overwrite %s", async (action) => {
  let finish!: (value: { ok: true; models: string[] }) => void;
  mocks.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const old = getLiveVendorProbe("codex", dir);
  await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  if (action === "clear") clearLlmCatalogCache(dir);
  if (action === "config") await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { codex: { auth: "cli" } } }));
  if (action === "account") await writeFile(join(authHome, "auth.json"), "new fixture account");
  if (action === "binary") await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { codex: { cli_path: "/new/codex" } } }));
  mocks.list.mockResolvedValue({ ok: true, models: ["gpt-new"] });
  const current = await getLiveVendorProbe("codex", dir, { refresh: action === "refresh" });
  finish({ ok: true, models: ["gpt-old"] });
  await old;
  expect(await getLiveVendorProbe("codex", dir)).toBe(current);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it.each(["lookup", "clear", "refresh"])("retires an older config read racing a newer %s", async (action) => {
  let finish!: (value: object) => void;
  mocks.load.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const old = getLiveVendorProbe("codex", dir);
  if (action === "clear") clearLlmCatalogCache(dir);
  const current = await getLiveVendorProbe("codex", dir, { refresh: action === "refresh" });
  finish({ codex: { cli_path: "/old/codex" } });
  await old;
  expect(await getLiveVendorProbe("codex", dir)).toBe(current);
});

it("rechecks repository trust and inherited Codex configuration", async () => {
  await getLiveVendorProbe("codex", dir);
  await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { codex: { cli_path: "/untrusted/codex" } } }));
  expect((await getLiveVendorProbe("codex", dir)).listing).toMatchObject({ ok: false, reason: expect.stringContaining("trust accept") });
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await rm(join(dir, ".n-dx.json"));
  expect((await getLiveVendorProbe("codex", dir)).listing.ok).toBe(true);
  await mkdir(join(dir, ".codex"));
  await writeFile(join(dir, ".codex", "config.toml"), "model = 'gpt-client-only'\n");
  await getLiveVendorProbe("codex", dir);
  expect(mocks.exec).toHaveBeenCalledTimes(4);
});

it("does not cache a rejected probe promise", async () => {
  mocks.list.mockRejectedValueOnce(new Error("fixture failure"));
  await expect(getLiveVendorProbe("codex", dir)).rejects.toThrow("fixture failure");
  expect((await getLiveVendorProbe("codex", dir)).listing.ok).toBe(true);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("evicts the oldest workspace from the bounded cache", async () => {
  await getLiveVendorProbe("codex", dir);
  for (let i = 0; i < 128; i++) {
    await getLiveVendorProbe("codex", join(dir, `workspace-${i}`));
  }
  const before = mocks.exec.mock.calls.length;
  await getLiveVendorProbe("codex", dir);
  expect(mocks.exec).toHaveBeenCalledTimes(before + 1);
  for (let i = 0; i < 128; i++) clearLlmCatalogCache(join(dir, `workspace-${i}`));
});

it("does not repopulate a cleared cache when an old probe is the last to finish", async () => {
  let finish!: (value: { ok: true; models: string[] }) => void;
  mocks.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const old = getLiveVendorProbe("codex", dir);
  await vi.waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  clearLlmCatalogCache(dir);
  finish({ ok: true, models: ["gpt-old"] });
  await old;
  await getLiveVendorProbe("codex", dir);
  expect(mocks.list).toHaveBeenCalledTimes(2);
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


it("keeps a warm CLI catalog separate from direct API discovery", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({
    llm: { vendor: "codex", codex: { auth: "api", api_key: "fixture-key" } },
  }));
  const fetch = vi.fn(async () => Response.json({ data: [{ id: "gpt-6-astra" }] }));
  vi.stubGlobal("fetch", fetch);
  expect((await getLiveVendorProbe("codex", dir, { provider: "cli" })).listing)
    .toEqual({ ok: true, models: ["gpt-client-only"] });
  expect((await getLiveVendorProbe("codex", dir, { provider: "api" })).listing)
    .toEqual({ ok: true, models: ["gpt-6-astra"] });
  expect((await getLiveVendorProbe("codex", dir, { provider: "cli" })).listing)
    .toEqual({ ok: true, models: ["gpt-client-only"] });
  expect(mocks.exec).toHaveBeenCalledTimes(1);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("discovers direct API models without reading native CLI configuration", async () => {
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({
    llm: { codex: { auth: "api", api_key: "fixture-key" } },
  }));
  // A directory cannot be read as config text; this is a disposable auth home.
  await mkdir(join(authHome, "config.toml"));
  const fetch = vi.fn(async () => Response.json({ data: [{ id: "gpt-6-astra" }] }));
  vi.stubGlobal("fetch", fetch);
  expect((await getLiveVendorProbe("codex", dir, { provider: "api" })).listing)
    .toEqual({ ok: true, models: ["gpt-6-astra"] });
  expect(mocks.exec).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
