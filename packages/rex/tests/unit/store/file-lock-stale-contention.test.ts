import {afterEach, describe, expect, it, vi} from "vitest";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const race = vi.hoisted(() => ({
  lockPath: "",
  staleGenerationObserved: false,
  publicUnlinks: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], ...args: unknown[]) => {
      const content = await (actual.readFile as (...readArgs: unknown[]) => Promise<string>)(path, ...args);
      if (String(path) !== race.lockPath) return content;

      const parsed = JSON.parse(content) as {token?: string};
      if (parsed.token === "dead-generation" && !race.staleGenerationObserved) {
        race.staleGenerationObserved = true;
        // Return the stale body, but publish a replacement before stale-lock
        // handling resumes. An unlink-by-path would now delete this lock.
        await actual.unlink(race.lockPath);
        await actual.writeFile(race.lockPath, JSON.stringify({
          pid: process.ppid,
          token: "replacement-live-generation",
          timestamp: new Date().toISOString(),
        }));
      }
      return content;
    }),
    unlink: vi.fn(async (path: Parameters<typeof actual.unlink>[0]) => {
      if (String(path) === race.lockPath) {
        race.publicUnlinks.push(String(path));
      }
      return actual.unlink(path);
    }),
  };
});

import {withLock} from "../../../src/store/file-lock.js";

describe("file-lock stale contention", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    race.lockPath = "";
    race.staleGenerationObserved = false;
    race.publicUnlinks.length = 0;
    if (tempDir) await rm(tempDir, {recursive: true, force: true});
    tempDir = undefined;
  });

  it("never unlinks a live replacement after observing a dead generation", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-stale-lock-race-"));
    const lockPath = join(tempDir, "prd.lock");
    race.lockPath = lockPath;
    await writeFile(lockPath, JSON.stringify({
      pid: 999_999_999,
      token: "dead-generation",
      timestamp: new Date().toISOString(),
    }));

    const writes: string[] = [];
    const writer = (value: string) => withLock(
      lockPath,
      async () => {
        writes.push(value);
      },
      {acquireTimeoutMs: 300, retryDelayMs: 5},
    );

    const result = await Promise.allSettled([writer("write")]);

    expect(race.staleGenerationObserved).toBe(true);
    expect(result).toEqual([
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({message: expect.stringContaining(`delete ${lockPath} manually`)}),
      }),
    ]);
    expect(writes).toEqual([]);
    expect(race.publicUnlinks).toEqual([]);
    expect(JSON.parse(await readFile(lockPath, "utf-8"))).toMatchObject({
      pid: process.ppid,
      token: "replacement-live-generation",
    });
  });
});
