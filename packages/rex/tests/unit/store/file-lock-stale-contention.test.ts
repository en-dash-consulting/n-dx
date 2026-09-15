import {afterEach, describe, expect, it, vi} from "vitest";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const race = vi.hoisted(() => ({
  canonicalLockPath: "",
  staleReads: 0,
  releaseStaleReaders: undefined as (() => void) | undefined,
  staleReadersReleased: undefined as Promise<void> | undefined,
  replacementMoved: false,
  replacementGenerationUnlinks: [] as string[],
  publicUnlinks: [] as string[],
}));

function canonicalize(path: string): string {
  return path.replace(/\/{2,}/g, "/");
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], ...args: unknown[]) => {
      const content = await (actual.readFile as (...readArgs: unknown[]) => Promise<string>)(path, ...args);
      if (canonicalize(String(path)) !== race.canonicalLockPath) return content;

      const parsed = JSON.parse(content) as {token?: string};
      if (parsed.token !== "dead-generation") return content;

      race.staleReads++;
      if (race.staleReads === 2) {
        await actual.unlink(race.canonicalLockPath);
        await actual.writeFile(race.canonicalLockPath, JSON.stringify({
          pid: process.ppid,
          token: "replacement-live-generation",
          timestamp: new Date().toISOString(),
        }));
        race.releaseStaleReaders?.();
      }
      await race.staleReadersReleased;
      return content;
    }),
    unlink: vi.fn(async (path: Parameters<typeof actual.unlink>[0]) => {
      if (canonicalize(String(path)) === race.canonicalLockPath) {
        race.publicUnlinks.push(String(path));
      }
      if (String(path).includes(".reclaim-")) {
        const content = await actual.readFile(path, "utf-8").catch(() => "");
        if (JSON.parse(content).token === "replacement-live-generation") {
          race.replacementGenerationUnlinks.push(String(path));
        }
      }
      return actual.unlink(path);
    }),
    rename: vi.fn(async (
      oldPath: Parameters<typeof actual.rename>[0],
      newPath: Parameters<typeof actual.rename>[1],
    ) => {
      await actual.rename(oldPath, newPath);
      if (
        !race.replacementMoved &&
        canonicalize(String(oldPath)) === race.canonicalLockPath &&
        String(newPath).includes(".reclaim-")
      ) {
        race.replacementMoved = true;
        // A stale cleaner has just moved C's live lock aside. Publish D before
        // that cleaner can roll C back: the old cleanup then deletes C's
        // replacement generation while D enters the critical section.
        await actual.writeFile(race.canonicalLockPath, JSON.stringify({
          pid: process.ppid,
          token: "second-live-generation",
          timestamp: new Date().toISOString(),
        }));
      }
    }),
  };
});

describe("file-lock stale contention", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    race.canonicalLockPath = "";
    race.staleReads = 0;
    race.releaseStaleReaders = undefined;
    race.staleReadersReleased = undefined;
    race.replacementMoved = false;
    race.replacementGenerationUnlinks.length = 0;
    race.publicUnlinks.length = 0;
    if (tempDir) await rm(tempDir, {recursive: true, force: true});
    tempDir = undefined;
  });

  it("never unlinks a live replacement after two contenders inspect the same dead lock", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-stale-lock-race-"));
    const lockPath = join(tempDir, "prd.lock");
    race.canonicalLockPath = canonicalize(lockPath);
    race.staleReadersReleased = new Promise<void>((resolve) => {
      race.releaseStaleReaders = resolve;
    });
    // Separate module instances have separate in-process queues, modelling two
    // processes while every filesystem operation uses the exact same path. This
    // avoids the path-spelling trick that deadlocked this regression on Windows.
    const {withLock: firstWithLock} = await import("../../../src/store/file-lock.js");
    vi.resetModules();
    const {withLock: secondWithLock} = await import("../../../src/store/file-lock.js");
    await writeFile(lockPath, JSON.stringify({
      pid: 999_999_999,
      token: "dead-generation",
      timestamp: new Date().toISOString(),
    }));

    let activeCallbacks = 0;
    let maximumActiveCallbacks = 0;
    const writes: string[] = [];
    const writer = (withLock: typeof firstWithLock, value: string) => withLock(
      lockPath,
      async () => {
        activeCallbacks++;
        maximumActiveCallbacks = Math.max(maximumActiveCallbacks, activeCallbacks);
        writes.push(value);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCallbacks--;
      },
      {acquireTimeoutMs: 300, retryDelayMs: 5},
    );

    const results = await Promise.allSettled([
      writer(firstWithLock, "first write"),
      writer(secondWithLock, "second write"),
    ]);

    expect(race.staleReads).toBe(2);
    expect(results).toEqual([
      expect.objectContaining({status: "rejected"}),
      expect.objectContaining({status: "rejected"}),
    ]);
    expect(results.map((result) => result.status === "rejected" ? result.reason.message : ""))
      .toEqual([
        expect.stringContaining(`delete ${lockPath} manually`),
        expect.stringContaining(`delete ${lockPath} manually`),
      ]);
    expect(maximumActiveCallbacks).toBe(0);
    expect(writes).toEqual([]);
    expect(race.publicUnlinks).toEqual([]);
    // Reinstating stale reclamation would rename C's replacement to a tombstone,
    // let D acquire the public path, then unlink C's tombstone after rollback
    // loses to D. The safety-first implementation must never start that path.
    expect(race.replacementGenerationUnlinks).toEqual([]);
    expect(JSON.parse(await readFile(lockPath, "utf-8"))).toMatchObject({
      pid: process.ppid,
      token: "replacement-live-generation",
    });
  });
});
