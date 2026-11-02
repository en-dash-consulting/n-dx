/**
 * `llm.<vendor>.auth` against `hench.provider`, in the shared run-settings
 * resolver: an `api` loop the auth setting rules out is refused before the
 * run starts, and a key held only in the credential store never makes one.
 * Placeholder values in a temp ndx home.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setCredential } from "@n-dx/llm-client";
import type { LLMConfig, LLMVendor } from "@n-dx/llm-client";
import { resolveTaskRunSettings } from "../../../../src/cli/commands/run-settings.js";
import type { TaskRunSettings } from "../../../../src/cli/commands/run-settings.js";
import { DEFAULT_HENCH_CONFIG } from "../../../../src/schema/index.js";
import type { HenchConfig } from "../../../../src/schema/index.js";
import type { PRDItem } from "../../../../src/prd/rex-gateway.js";

const STORED = "placeholder-stored-claude-key";
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hench-run-auth-"));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  vi.stubEnv("GEMINI_API_KEY", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

function resolveFor(options: {
  provider?: "cli" | "api";
  flags?: Record<string, string>;
  llm?: LLMConfig;
  vendor?: LLMVendor;
  item?: Pick<PRDItem, "id" | "title" | "run">;
}): TaskRunSettings {
  const config = { ...DEFAULT_HENCH_CONFIG(), ...(options.provider ? { provider: options.provider } : {}) } as HenchConfig;
  return resolveTaskRunSettings({
    flags: options.flags ?? {},
    config,
    configuredHenchKeys: new Set(options.provider ? ["provider"] : []),
    llmConfig: options.llm ?? { vendor: "claude" },
    vendor: options.vendor ?? "claude",
    autonomous: true,
    ...(options.item ? { item: options.item } : {}),
  });
}

const claudeAuth = (auth: string): LLMConfig => ({ vendor: "claude", claude: { auth } } as LLMConfig);

describe("provider=api against llm.<vendor>.auth", () => {
  it("refuses auth cli before the run starts, naming both keys", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "placeholder-exported-key");
    const r = resolveFor({ provider: "api", llm: claudeAuth("cli") });
    expect(r.provider.value).toBe("api");
    const text = `${r.provider.error?.message} ${r.provider.error?.suggestion}`;
    expect(text).toContain("hench.provider");
    expect(text).toContain("llm.claude.auth");
    expect(resolveFor({ provider: "cli", llm: claudeAuth("cli") }).provider.error).toBeUndefined();
  });

  it("refuses auth api with no key, naming the store and the setting", () => {
    const r = resolveFor({ provider: "api", llm: claudeAuth("api") });
    expect(r.provider.error?.message).toContain("ndx config credentials.claude");
    expect(r.provider.error?.message).toContain("llm.claude.auth");
  });

  it("gives auth auto with only a stored key the same error as auth api with no key", () => {
    const noKey = resolveFor({ provider: "api", llm: claudeAuth("api") }).provider.error?.message;
    setCredential("claude", STORED, { ndxHome: home });
    const r = resolveFor({ provider: "api" });
    expect(r.provider.error?.message).toBe(noKey);
    expect(r.provider.error?.message).not.toContain(STORED);
  });

  it("accepts auth api with a stored key, and auth auto with an exported one", () => {
    setCredential("claude", STORED, { ndxHome: home });
    expect(resolveFor({ provider: "api", llm: claudeAuth("api") }).provider.error).toBeUndefined();
    vi.stubEnv("ANTHROPIC_API_KEY", "placeholder-exported-key");
    expect(resolveFor({ provider: "api" }).provider.error).toBeUndefined();
  });

  it("leaves auth auto with no key anywhere to the loop, as before", () => {
    expect(resolveFor({ provider: "api" }).provider.error).toBeUndefined();
  });

  it("refuses provider=cli under auth api with no key before the run starts", () => {
    const r = resolveFor({ provider: "cli", llm: claudeAuth("api") });
    expect(r.provider.value).toBe("cli");
    expect(r.provider.error?.message).toContain("ndx config credentials.claude");
    setCredential("claude", STORED, { ndxHome: home });
    expect(resolveFor({ provider: "cli", llm: claudeAuth("api") }).provider.error).toBeUndefined();
  });

  it("refuses the --provider=api flag too", () => {
    expect(resolveFor({ flags: { provider: "api" }, llm: claudeAuth("cli") }).provider.error).toBeDefined();
  });

  it("skips a saved api the auth setting rules out, with a warning, instead of ending the loop", () => {
    const r = resolveFor({ provider: "cli", llm: claudeAuth("cli"), item: { id: "t-1", title: "Saved", run: { provider: "api" } as PRDItem["run"] } });
    expect(r.provider).toMatchObject({ value: "cli", source: "hench.provider" });
    expect(r.provider.error).toBeUndefined();
    expect(r.warnings.map((w) => w.code)).toContain("saved-provider-unavailable");
    expect(r.warnings.find((w) => w.code === "saved-provider-unavailable")?.message).toContain("llm.claude.auth");
  });

  it("google (no CLI login) runs its api loop on a stored key", () => {
    setCredential("google", "placeholder-stored-google-key", { ndxHome: home });
    const r = resolveFor({ provider: "api", vendor: "google", llm: { vendor: "google" } });
    expect(r.provider.error).toBeUndefined();
  });
});

describe("auth in the resolution", () => {
  it("reports llm.<vendor>.auth with its source", () => {
    expect(resolveFor({}).auth).toEqual({ value: "auto", source: "built-in" });
    expect(resolveFor({ llm: claudeAuth("cli") }).auth).toEqual({ value: "cli", source: "llm.claude.auth" });
    expect(resolveFor({ vendor: "local", llm: { vendor: "local" } }).auth).toEqual({ value: null, source: "built-in" });
  });
});
