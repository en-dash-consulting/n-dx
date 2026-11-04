import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetJevFallbackWarning, resolveJudgmentRoute } from "../../src/config.js";
import {
  clearCredentialHelperCache,
  jevAvailability,
  resolveCredential,
  setCredential,
  setHelperCredential,
  type CredentialStoreOptions,
} from "../../src/credential-store.js";
import { probeJevKey } from "../../src/jev-client.js";
import { loadLLMConfig } from "../../src/llm-config.js";
import type { LLMConfig } from "../../src/llm-types.js";

// Placeholder only: a real-looking key would trip secret scanners.
const KEY = "tsk-placeholder-required-0123456789";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-typesafe-required-"));
  resetJevFallbackWarning();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("llm.typesafe.required", () => {
  const required: LLMConfig = { typesafe: { required: true } };

  it("warns once for two fallbacks, naming the command", () => {
    const warnings: string[] = [];
    const options = { ndxHome: home, env: {}, warn: (m: string) => warnings.push(m) };
    expect(resolveJudgmentRoute("code.classify", required, options)).toBeUndefined();
    expect(resolveJudgmentRoute("finding.judge", required, options)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ndx config credentials.typesafe");
  });

  it("stays silent when unset or false", () => {
    const warnings: string[] = [];
    const options = { ndxHome: home, env: {}, warn: (m: string) => warnings.push(m) };
    resolveJudgmentRoute("code.classify", {}, options);
    resolveJudgmentRoute("code.classify", { typesafe: { required: false } }, options);
    expect(warnings).toEqual([]);
  });

  it("stays silent for a class that is not Jev-routed, and when the key resolves", () => {
    const warnings: string[] = [];
    const options = { ndxHome: home, env: {}, warn: (m: string) => warnings.push(m) };
    resolveJudgmentRoute("prd.merge", required, options);
    expect(warnings).toEqual([]);
    expect(resolveJudgmentRoute("code.classify", required, { ...options, env: { TYPESAFE_API_KEY: KEY } })).toBe("typesafe");
    expect(warnings).toEqual([]);
  });

  it("is read from .n-dx.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-typesafe-required-proj-"));
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(dir, ".n-dx.json"), JSON.stringify({ llm: { typesafe: { required: true } } }));
      expect((await loadLLMConfig(dir)).typesafe).toEqual({ required: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("jevAvailability", () => {
  it("reports source without a value", () => {
    expect(jevAvailability({ ndxHome: home, env: {} })).toEqual({ available: false, source: null });
    expect(jevAvailability({ ndxHome: home, env: { TYPESAFE_API_KEY: KEY } })).toEqual({ available: true, source: "env" });
    setCredential("typesafe", KEY, { ndxHome: home });
    expect(jevAvailability({ ndxHome: home, env: {} })).toEqual({ available: true, source: "file" });
  });

  describe("with a helper entry", () => {
    let runs: number;
    const helperExec = (ok: boolean) => (() => {
      runs++;
      if (!ok) throw Object.assign(new Error("locked"), { status: 1 });
      return `${KEY}\n`;
    }) as unknown as CredentialStoreOptions["helperExec"];
    const opts = (ok: boolean) => ({ ndxHome: home, env: {}, helperExec: helperExec(ok), warn: () => {} });

    beforeEach(() => {
      runs = 0;
      clearCredentialHelperCache();
      setHelperCredential("typesafe", ["op", "read", "op://v/i/f"], { ndxHome: home });
    });
    afterEach(() => clearCredentialHelperCache());

    it("is unknown without check, and runs nothing", () => {
      expect(jevAvailability(opts(true))).toEqual({ available: null, source: "helper" });
      expect(runs).toBe(0);
    });

    it("cached: unknown before the helper ran, then what its run gave, never running it", () => {
      expect(jevAvailability({ ...opts(false), check: "cached" })).toEqual({ available: null, source: "helper" });
      expect(resolveCredential("typesafe", opts(false))).toBeUndefined();
      expect(runs).toBe(1);
      expect(jevAvailability({ ...opts(true), check: "cached" })).toEqual({ available: false, source: null });
      expect(runs).toBe(1);

      clearCredentialHelperCache();
      expect(resolveCredential("typesafe", opts(true))?.source).toBe("helper");
      expect(jevAvailability({ ...opts(false), check: "cached" })).toEqual({ available: true, source: "helper" });
      expect(runs).toBe(2);
    });

    it("check: runs the helper and reports its result", () => {
      expect(jevAvailability({ ...opts(false), check: true })).toEqual({ available: false, source: null });
      clearCredentialHelperCache();
      expect(jevAvailability({ ...opts(true), check: true })).toEqual({ available: true, source: "helper" });
    });
  });
});

describe("probeJevKey", () => {
  const respond = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
  const opts = (fetchImpl: typeof fetch) => ({ ndxHome: home, env: { TYPESAFE_API_KEY: KEY }, fetchImpl });

  it("maps 200 to ok, 401 to rejected, 503 and network errors to unreachable", async () => {
    expect((await probeJevKey(opts(respond(200)))).outcome).toBe("ok");
    expect((await probeJevKey(opts(respond(401)))).outcome).toBe("rejected");
    expect((await probeJevKey(opts(respond(503)))).outcome).toBe("unreachable");
    const down = (async () => { throw new Error(`connect failed for ${KEY}`); }) as unknown as typeof fetch;
    const result = await probeJevKey(opts(down));
    expect(result.outcome).toBe("unreachable");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("makes no request without a key", async () => {
    let calls = 0;
    const counting = (async () => { calls++; return new Response("{}"); }) as unknown as typeof fetch;
    expect((await probeJevKey({ ndxHome: home, env: {}, fetchImpl: counting })).outcome).toBe("no-key");
    expect(calls).toBe(0);
  });
});
