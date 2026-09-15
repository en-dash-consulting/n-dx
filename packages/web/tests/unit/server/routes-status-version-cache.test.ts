/**
 * readWebVersion() caching behavior — packages/web/src/server/routes-status.ts.
 *
 * A transient read failure (EMFILE, a not-yet-ready mount, ...) must not be
 * memoized like a success: the next call should retry rather than repeat
 * "unknown" for the life of the process. A *successful* read, on the other
 * hand, is memoized permanently (the file does not change under a running
 * process) and must not be re-read on every call.
 *
 * Each test resets the module registry so routes-status.ts's module-level
 * `cachedVersion` starts fresh, then mocks `node:fs`'s `readFileSync` to
 * control exactly the read of packages/web/package.json while every other
 * path falls through to the real implementation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { ServerContext } from "../../../src/server/types.js";

/** Absolute path to packages/web/package.json — mirrors readWebVersion's own resolution. */
const pkgPath = fileURLToPath(new URL("../../../package.json", import.meta.url));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

function makeCtx(): ServerContext {
  return { projectDir: "/tmp/version-cache-test", svDir: "/tmp/x/.sourcevision", rexDir: "/tmp/x/.rex", dev: false };
}

describe("readWebVersion caching (via buildServerInfo)", () => {
  let realReadFileSync: typeof import("node:fs").readFileSync;
  let realVersion: string;
  let mockedReadFileSync: ReturnType<typeof vi.mocked<typeof import("node:fs").readFileSync>>;

  beforeEach(async () => {
    vi.resetModules();
    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    realReadFileSync = actualFs.readFileSync;
    realVersion = (JSON.parse(realReadFileSync(pkgPath, "utf-8") as string) as { version: string }).version;

    // The `node:fs` mock module is a file-level singleton — vi.resetModules()
    // only resets ordinary (unmocked) modules like routes-status.ts, so the
    // mock's call history must be cleared explicitly or it leaks across tests.
    const fsMod = await import("node:fs");
    mockedReadFileSync = vi.mocked(fsMod.readFileSync);
    mockedReadFileSync.mockClear();
  });

  it("does not cache a transient failure — a later call that succeeds returns the real version", async () => {
    mockedReadFileSync.mockImplementation(((path: unknown, options?: unknown) => {
      if (path === pkgPath) throw new Error("EMFILE: simulated transient failure");
      return realReadFileSync(path as string, options as BufferEncoding);
    }) as typeof realReadFileSync);

    const { buildServerInfo } = await import("../../../src/server/routes-status.js");
    const ctx = makeCtx();

    // First call: the read fails — must report "unknown", not throw.
    expect(buildServerInfo(ctx).version).toBe("unknown");

    // File is readable again on the next call.
    mockedReadFileSync.mockImplementation(((path: unknown, options?: unknown) =>
      realReadFileSync(path as string, options as BufferEncoding)) as typeof realReadFileSync);

    expect(buildServerInfo(ctx).version).toBe(realVersion);
  });

  it("memoizes a successful read — the file is read once, not on every call", async () => {
    mockedReadFileSync.mockImplementation(((path: unknown, options?: unknown) =>
      realReadFileSync(path as string, options as BufferEncoding)) as typeof realReadFileSync);

    const { buildServerInfo } = await import("../../../src/server/routes-status.js");
    const ctx = makeCtx();

    buildServerInfo(ctx);
    buildServerInfo(ctx);
    buildServerInfo(ctx);

    const pkgReadCalls = mockedReadFileSync.mock.calls.filter(([path]) => path === pkgPath);
    expect(pkgReadCalls).toHaveLength(1);
  });

  it("succeed-then-fail: keeps returning the cached real version even when a later read would fail", async () => {
    mockedReadFileSync.mockImplementation(((path: unknown, options?: unknown) =>
      realReadFileSync(path as string, options as BufferEncoding)) as typeof realReadFileSync);

    const { buildServerInfo } = await import("../../../src/server/routes-status.js");
    const ctx = makeCtx();

    // First call succeeds and memoizes the real version.
    expect(buildServerInfo(ctx).version).toBe(realVersion);

    // A later read of package.json would fail — memoization must mean this
    // implementation is never even invoked again for that path.
    mockedReadFileSync.mockImplementation(((path: unknown, options?: unknown) => {
      if (path === pkgPath) throw new Error("should not be called again — version is memoized");
      return realReadFileSync(path as string, options as BufferEncoding);
    }) as typeof realReadFileSync);

    expect(buildServerInfo(ctx).version).toBe(realVersion);
  });
});
