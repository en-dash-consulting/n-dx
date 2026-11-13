/** Synthetic route/config integration: no sockets, vendor CLI or auth mutation. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ServerContext } from "../../src/server/types.js";

const { execMock, credentialPath, trustWrite, refuseMock } = vi.hoisted(() => ({
  execMock: vi.fn(), credentialPath: vi.fn(), trustWrite: vi.fn(), refuseMock: vi.fn(),
}));
vi.mock("@n-dx/llm-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@n-dx/llm-client")>(),
  exec: execMock,
  credentialStorePath: credentialPath,
  repoTrustRecordPath: (dir: string) => join(dir, "trust-fixture.json"),
  recordRepoTrust: trustWrite,
  clearRepoTrust: trustWrite,
  evaluateRepoTrust: () => ({
    state: "trusted", restricted: false, findings: [], inventory: {},
    config: { sources: [], prdRunBlocks: [], prdRunBlocksPath: null, digest: "synthetic" },
    record: null,
  }),
}));
// Model trust decisions in-process; never read or change the user's trust store.
vi.mock("../../src/server/trust-gate.js", () => ({
  refuseWhileRestricted: refuseMock, isProjectRestricted: () => false, TRUST_HINT: "synthetic",
}));
vi.mock("../../src/server/settings-commit.js", () => ({ commitSettingsChange: vi.fn() }));

import { handleCommandsRoute, invalidateAuthCheckCache } from "../../src/server/routes-commands.js";
import { handleTrustRoute } from "../../src/server/routes-trust.js";
import { handleLlmRoute } from "../../src/server/routes-llm.js";
import { loadLLMConfig } from "@n-dx/llm-client";

interface ExecResult {
  stdout: string;
  stderr: string;
  error: Error | null;
}

describe("auth verdict context isolation and bounded freshness", () => {
  let root: string;
  let a: ServerContext;
  let b: ServerContext;
  const releases: Array<() => void> = [];
  const requests: Array<Promise<unknown>> = [];

  function deferCheck() {
    let resolve!: (result: ExecResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ExecResult>((yes, no) => { resolve = yes; reject = no; });
    releases.push(() => resolve({ stdout: "cleanup", stderr: "", error: null }));
    return { promise, resolve, reject };
  }

  function request(ctx: ServerContext, path = "auth", method = "POST") {
    const end = vi.fn();
    const writeHead = vi.fn();
    const req = { url: `/api/commands/${path}`, method } as IncomingMessage;
    const res = { end, writeHead } as unknown as ServerResponse;
    const pending = Promise.resolve(handleCommandsRoute(req, res, ctx)).then((handled) => {
      expect(handled).toBe(true);
      expect(writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      return JSON.parse(end.mock.calls[0][0] as string);
    });
    requests.push(pending);
    return pending;
  }

  const cached = (ctx: ServerContext) => request(ctx, "auth/cached", "GET");
  const config = (ctx: ServerContext, llm: unknown, local = false) =>
    writeFile(join(ctx.projectDir, local ? ".n-dx.local.json" : ".n-dx.json"), JSON.stringify({ llm }));

  beforeEach(async () => {
    execMock.mockReset();
    trustWrite.mockReset();
    refuseMock.mockReset().mockReturnValue(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]) vi.stubEnv(name, "");
    invalidateAuthCheckCache();
    root = await mkdtemp(join(process.cwd(), ".auth-context-test-"));
    credentialPath.mockReturnValue(join(root, "credential-fixture.json"));
    const context = async (name: string): Promise<ServerContext> => {
      const projectDir = join(root, name);
      await mkdir(projectDir);
      return { projectDir, rexDir: join(projectDir, ".rex"), svDir: join(projectDir, ".sourcevision"), dev: false };
    };
    a = await context("a");
    b = await context("b");
    await config(a, { vendor: "codex" });
    await config(b, { vendor: "codex" });
  });

  afterEach(async () => {
    // Drain even a failing regression before clearing module state.
    for (const release of releases.splice(0)) release();
    await Promise.allSettled(requests.splice(0));
    invalidateAuthCheckCache();
    await rm(root, { recursive: true, force: true });
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(["a", "b"])("keeps both workspace checks and verdicts when %s finishes first", async (first) => {
    const checkA = deferCheck();
    const checkB = deferCheck();
    execMock.mockReturnValueOnce(checkA.promise).mockReturnValueOnce(checkB.promise);

    const resultA = request(a);
    const resultB = request(b);
    const coalescedA = request({ ...a }, "auth?refresh=true");
    const coalescedB = request({ ...b }, "auth?refresh=true");
    expect(execMock).toHaveBeenCalledTimes(2);
    for (const [index, ctx] of [a, b].entries()) {
      expect(execMock.mock.calls[index][1]).toEqual(expect.arrayContaining(["auth", ctx.projectDir]));
      expect(execMock.mock.calls[index][2]).toMatchObject({ cwd: ctx.projectDir });
    }
    expect(await cached(a)).toEqual({ cached: false });
    expect(await cached(b)).toEqual({ cached: false });

    const pass = { stdout: "workspace A valid", stderr: "", error: null };
    const fail = { stdout: "", stderr: "workspace B invalid", error: new Error("exit 1") };
    if (first === "a") checkA.resolve(pass);
    else checkB.resolve(fail);
    await (first === "a" ? resultA : resultB);

    // Completing one key must not clear the other key's in-flight check.
    const stillPending = request(first === "a" ? b : a, "auth?refresh=true");
    expect(execMock).toHaveBeenCalledTimes(2);
    checkA.resolve(pass);
    checkB.resolve(fail);

    const expectedA = { ok: true, output: pass.stdout, error: null, cached: false };
    const expectedB = { ok: false, output: "", error: fail.stderr, cached: false };
    expect(await resultA).toEqual(expectedA);
    expect(await resultB).toEqual(expectedB);
    expect(await coalescedA).toEqual(expectedA);
    expect(await coalescedB).toEqual(expectedB);
    expect(await stillPending).toEqual(first === "a" ? expectedB : expectedA);
    expect(await cached(a)).toEqual({ ...expectedA, cached: true });
    expect(await cached(b)).toEqual({ ...expectedB, cached: true });
    expect(await request(a)).toEqual({ ...expectedA, cached: true });
    expect(await request(b)).toEqual({ ...expectedB, cached: true });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("does not reuse another workspace's completed verdict with identical config", async () => {
    execMock.mockResolvedValue({ stdout: "valid", stderr: "", error: null });
    await request(a);
    expect(await cached(b)).toEqual({ cached: false });
    expect(await request(b)).toMatchObject({ cached: false });
    expect(await cached(a)).toMatchObject({ cached: true });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("isolates concurrent config revisions and preserves the local overlay", async () => {
    await config(a, { vendor: "codex", codex: { model: "project-model" } });
    await config(a, { codex: { model: "local-model" } }, true);
    const oldCheck = deferCheck();
    const newCheck = deferCheck();
    execMock.mockReturnValueOnce(oldCheck.promise).mockReturnValueOnce(newCheck.promise);
    const oldResult = request(a);

    // A project edit shadowed by local config is still the same context.
    await config(a, { vendor: "codex", codex: { model: "shadowed-edit" } });
    const sameResult = request(a, "auth?refresh=true");
    expect(execMock).toHaveBeenCalledTimes(1);
    await config(a, { codex: { model: "new-local-model" } }, true);
    const newResult = request(a);
    const sameNewResult = request(a, "auth?refresh=true");
    expect(execMock).toHaveBeenCalledTimes(2);

    newCheck.resolve({ stdout: "new config valid", stderr: "", error: null });
    expect(await newResult).toMatchObject({ ok: true, output: "new config valid", cached: false });
    expect(await sameNewResult).toEqual(await newResult);
    oldCheck.resolve({ stdout: "", stderr: "old config invalid", error: new Error("exit 1") });
    expect(await oldResult).toMatchObject({ ok: false, error: "old config invalid" });
    expect(await sameResult).toEqual(await oldResult);
    expect(await cached(a)).toMatchObject({ ok: true, output: "new config valid", cached: true });
    expect(await request(a)).toMatchObject({ ok: true, cached: true });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("releases a failed check so a forced refresh can retry that context", async () => {
    const check = deferCheck();
    execMock.mockReturnValueOnce(check.promise);
    const first = request(a);
    const shared = request(a, "auth?refresh=true");
    check.reject(new Error("synthetic launch failure"));
    expect(await first).toEqual({ ok: false, output: "", error: "synthetic launch failure", cached: false });
    expect(await shared).toEqual(await first);
    execMock.mockResolvedValueOnce({ stdout: "retry valid", stderr: "", error: null });
    expect(await request(a, "auth?refresh=true")).toMatchObject({ ok: true, cached: false });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("reuses a %s verdict on repeated visits until five minutes, without a GET spawning", async (ok) => {
    execMock.mockResolvedValue({ stdout: "synthetic verdict", stderr: "denied", error: ok ? null : new Error("exit 1") });
    const startedAt = Date.now();
    const first = await request(a);
    expect(first).toMatchObject({ cached: false, ok });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][2]).toMatchObject({ timeout: 60_000 });
    // Model Robot Wrangler's ordinary POST on each mount, beyond the old TTL.
    for (const age of [60_001, 120_000, 299_999]) {
      vi.setSystemTime(startedAt + age);
      expect(await request(a)).toEqual({ ...first, cached: true });
      expect(await cached(a)).toEqual({ ...first, cached: true });
      expect(execMock).toHaveBeenCalledTimes(1);
    }
    vi.setSystemTime(startedAt + 300_000);
    expect(await cached(a)).toEqual({ cached: false });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(await request(a)).toMatchObject({ cached: false, ok });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("rechecks on demand and hides the old verdict while same-context requests coalesce", async () => {
    execMock.mockResolvedValueOnce({ stdout: "old", stderr: "", error: null });
    await request(a);
    vi.setSystemTime(Date.now() + 120_000);
    expect(await request(a)).toMatchObject({ output: "old", cached: true });
    expect(execMock).toHaveBeenCalledTimes(1);
    const check = deferCheck();
    execMock.mockReturnValueOnce(check.promise);
    const refreshed = request(a, "auth?refresh=true");
    const ordinary = request(a);
    const alsoRefreshed = request(a, "auth?refresh=true");
    expect(await cached(a)).toEqual({ cached: false });
    expect(execMock).toHaveBeenCalledTimes(2);
    check.resolve({ stdout: "new", stderr: "", error: null });
    for (const result of [refreshed, ordinary, alsoRefreshed]) {
      expect(await result).toMatchObject({ output: "new", cached: false });
    }
    expect(await cached(a)).toMatchObject({ output: "new", cached: true });
  });

  it.each(["old", "new"])("does not repopulate an invalidated workspace when %s finishes first", async (first) => {
    execMock.mockResolvedValueOnce({ stdout: "workspace B", stderr: "", error: null });
    await request(b);
    const old = deferCheck();
    const next = deferCheck();
    execMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const oldResult = request(a);
    invalidateAuthCheckCache(a.projectDir);
    const nextResult = request(a);
    expect(execMock).toHaveBeenCalledTimes(3);
    const completeOld = () => old.resolve({ stdout: "old", stderr: "", error: null });
    const completeNew = () => next.resolve({ stdout: "new", stderr: "", error: null });
    if (first === "old") {
      completeOld();
      await oldResult;
      expect(await cached(a)).toEqual({ cached: false });
      const joined = request(a);
      expect(execMock).toHaveBeenCalledTimes(3);
      completeNew();
      expect(await joined).toMatchObject({ output: "new" });
    } else {
      completeNew();
      await nextResult;
      completeOld();
    }
    await Promise.all([oldResult, nextResult]);
    expect(await cached(a)).toMatchObject({ output: "new", cached: true });
    expect(await cached(b)).toMatchObject({ output: "workspace B", cached: true });
  });

  it("observes credential-store creation, replacement and removal for store consumers only", async () => {
    await config(a, { vendor: "codex", codex: { auth: "api" } });
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await request(a);
    await request(b); // auto uses CLI login, not a store-only key
    const path = credentialPath();
    for (const content of ["first synthetic revision", "second synthetic revision with different size", null]) {
      if (content === null) await rm(path);
      else await writeFile(path, content);
      expect(await cached(a)).toEqual({ cached: false });
      expect(await cached(b)).toMatchObject({ cached: true });
      await request(a);
    }
    expect(execMock).toHaveBeenCalledTimes(5);
  });

  it("observes workspace trust-record changes without invalidating another workspace", async () => {
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await request(a);
    await request(b);
    const path = join(a.projectDir, "trust-fixture.json");
    for (const content of ["accepted", "accepted again", null]) {
      if (content === null) await rm(path);
      else await writeFile(path, content);
      expect(await cached(a)).toEqual({ cached: false });
      expect(await cached(b)).toMatchObject({ cached: true });
      await request(a);
    }
    expect(execMock).toHaveBeenCalledTimes(5);
  });

  it.each(["codex", "google"])("tracks the store when %s ignores a non-string configured key", async (vendor) => {
    const llm = { vendor, [vendor]: { auth: "api", api_key: 123 } };
    await config(a, llm, true);
    // The actual preflight loader keeps local API mode but ignores the malformed key.
    expect((await loadLLMConfig(a.projectDir))[vendor as "codex" | "google"]).toEqual({ auth: "api" });
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await writeFile(credentialPath(), "first synthetic revision");
    await request(a);
    await writeFile(credentialPath(), "replacement synthetic revision");
    expect(await cached(a)).toEqual({ cached: false });
    await request(a);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("tracks Google's default key environment when apiKeyEnv is empty", async () => {
    const llm = { vendor: "google", google: { apiKeyEnv: "" } };
    await config(a, llm, true);
    expect((await loadLLMConfig(a.projectDir)).google?.apiKeyEnv).toBeUndefined();
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await request(a);
    vi.stubEnv("GEMINI_API_KEY", "synthetic-replacement-key");
    expect(await cached(a)).toEqual({ cached: false });
    await request(a);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("observes active-vendor environment changes without exposing synthetic key values", async () => {
    await config(b, { vendor: "google" });
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await request(a);
    await request(b);
    vi.stubEnv("OPENAI_API_KEY", "synthetic-key-never-returned");
    expect(await cached(a)).toEqual({ cached: false });
    expect(await cached(b)).toMatchObject({ cached: true });
    expect(JSON.stringify(await request(a))).not.toContain("synthetic-key-never-returned");
    expect(JSON.stringify(execMock.mock.calls)).not.toContain("synthetic-key-never-returned");
  });

  it("observes legacy Claude settings while preserving modern field precedence", async () => {
    const write = (apiKey: string, modern: unknown = {}) => writeFile(join(a.projectDir, ".n-dx.json"), JSON.stringify({
      claude: { api_key: apiKey }, llm: { vendor: "claude", claude: modern },
    }));
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await write("synthetic-one");
    await request(a);
    await write("synthetic-two");
    expect(await cached(a)).toEqual({ cached: false });
    await write("synthetic-two", { api_key: "modern-synthetic" });
    await request(a);
    await write("shadowed-synthetic", { api_key: "modern-synthetic" });
    expect(await cached(a)).toMatchObject({ cached: true });
  });

  it("discards a check if its inputs change before completion, even without an intervening request", async () => {
    const check = deferCheck();
    execMock.mockReturnValueOnce(check.promise);
    const pending = request(a);
    await config(a, { vendor: "codex", codex: { auth: "cli" } });
    check.resolve({ stdout: "obsolete", stderr: "", error: null });
    expect(await pending).toMatchObject({ output: "obsolete" });
    // Reverting the config must not resurrect the obsolete result.
    await config(a, { vendor: "codex" });
    expect(await cached(a)).toEqual({ cached: false });
  });

  it("does not extend freshness by the duration of a slow check", async () => {
    const check = deferCheck();
    execMock.mockReturnValueOnce(check.promise);
    const startedAt = Date.now();
    const pending = request(a);
    vi.setSystemTime(startedAt + 30_000);
    check.resolve({ stdout: "slow verdict", stderr: "", error: null });
    await pending;
    expect(await cached(a)).toMatchObject({ cached: true, output: "slow verdict" });
    vi.setSystemTime(startedAt + 300_000);
    expect(await cached(a)).toEqual({ cached: false });
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it.each(["accept", "revoke", "config"])("a dashboard %s retires pending checks for only its workspace", async (action) => {
    execMock.mockResolvedValueOnce({ stdout: "workspace B", stderr: "", error: null });
    await request(b);
    const old = deferCheck();
    execMock.mockReturnValueOnce(old.promise);
    const oldResult = request(a);
    const req = Readable.from([Buffer.from(JSON.stringify({ changes: { "llm.vendor": "codex" } }))]) as unknown as IncomingMessage;
    req.url = action === "config" ? "/api/llm/config" : `/api/trust/${action}`;
    req.method = action === "config" ? "PUT" : "POST";
    const writeHead = vi.fn();
    const res = { writeHead, end: vi.fn() } as unknown as ServerResponse;
    expect(await (action === "config" ? handleLlmRoute : handleTrustRoute)(req, res, a)).toBe(true);
    expect(writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    if (action !== "config") expect(trustWrite).toHaveBeenCalledWith(a.projectDir);
    old.resolve({ stdout: "obsolete", stderr: "", error: null });
    await oldResult;
    expect(await cached(a)).toEqual({ cached: false });
    expect(await cached(b)).toMatchObject({ cached: true, output: "workspace B" });
    execMock.mockResolvedValueOnce({ stdout: "rechecked", stderr: "", error: null });
    expect(await request(a)).toMatchObject({ cached: false, output: "rechecked" });
  });

  it.each(["credential", "trust"])("isolates pending checks across a detected %s revision", async (source) => {
    await config(a, { vendor: "codex", codex: { auth: "api" } });
    const old = deferCheck();
    const next = deferCheck();
    execMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const oldResult = request(a);
    const path = source === "credential" ? credentialPath() : join(a.projectDir, "trust-fixture.json");
    await writeFile(path, "synthetic revision");
    const nextResult = request(a);
    const joined = request(a, "auth?refresh=true");
    expect(execMock).toHaveBeenCalledTimes(2);
    next.resolve({ stdout: "new revision", stderr: "", error: null });
    await Promise.all([nextResult, joined]);
    old.resolve({ stdout: "obsolete", stderr: "", error: null });
    await oldResult;
    expect(await cached(a)).toMatchObject({ output: "new revision", cached: true });
  });

  it("retires a cached verdict when the command trust gate refuses the workspace", async () => {
    execMock.mockResolvedValue({ stdout: "synthetic", stderr: "", error: null });
    await request(a);
    await request(b);
    refuseMock.mockReturnValueOnce(true); // the gate owns the 403 response
    expect(await handleCommandsRoute({ url: "/api/commands/auth", method: "POST" } as IncomingMessage,
      {} as ServerResponse, a)).toBe(true);
    expect(await cached(a)).toEqual({ cached: false });
    expect(await cached(b)).toMatchObject({ cached: true });
    expect(execMock).toHaveBeenCalledTimes(2);
  });
});
