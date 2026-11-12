/** Synthetic route/config integration: no sockets, vendor CLI or auth mutation. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../../src/server/types.js";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@n-dx/llm-client")>(),
  exec: execMock,
}));
// Trust is outside this regression; never read or change the user's trust store.
vi.mock("../../src/server/trust-gate.js", () => ({ refuseWhileRestricted: () => false }));

import { handleCommandsRoute, invalidateAuthCheckCache } from "../../src/server/routes-commands.js";

interface ExecResult {
  stdout: string;
  stderr: string;
  error: Error | null;
}

describe("auth verdicts are isolated by workspace and effective config", () => {
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
    invalidateAuthCheckCache();
    root = await mkdtemp(join(process.cwd(), ".auth-context-test-"));
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
});
