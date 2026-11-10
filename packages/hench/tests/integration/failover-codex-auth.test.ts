/**
 * Failover to codex builds its provider with `defaultRegistry.create("codex",
 * llmConfig)` (loop.ts `callWithFailover`). A codex key held only in the
 * credential store, with `llm.codex.auth` unset, must give the codex CLI
 * provider: before the registry consulted `llm.codex.auth` it picked the API
 * and threw "needs a key and none may be used". Placeholder values in a temp
 * ndx home.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setCredential } from "@n-dx/llm-client";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";

const STORED = "placeholder-stored-codex-key";
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hench-failover-codex-"));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("OPENAI_API_KEY", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("failover to codex under llm.codex.auth", () => {
  it("a store-only codex key with auth unset gives the codex CLI provider", () => {
    setCredential("codex", STORED, { ndxHome: home });
    const provider = defaultRegistry.create("codex", { vendor: "claude", autoFailover: true });
    expect(provider.info).toMatchObject({ vendor: "codex", mode: "cli" });
  });

  it("auth cli with an exported key gives the codex CLI provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "placeholder-exported-codex-key");
    const provider = defaultRegistry.create("codex", { codex: { auth: "cli" } });
    expect(provider.info).toMatchObject({ vendor: "codex", mode: "cli" });
  });
});
