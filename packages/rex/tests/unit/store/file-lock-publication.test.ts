import {afterEach, describe, expect, it, vi} from "vitest";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const publication = vi.hoisted(() => ({
  links: [] as Array<{source: string; destination: string; content: string}>,
  writes: [] as string[],
  failTemporaryUnlinkOnce: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async (path: Parameters<typeof actual.writeFile>[0], ...args: unknown[]) => {
      publication.writes.push(String(path));
      return (actual.writeFile as (...writeArgs: unknown[]) => Promise<void>)(path, ...args);
    }),
    link: vi.fn(async (source: string, destination: string) => {
      publication.links.push({
        source,
        destination,
        content: await actual.readFile(source, "utf-8"),
      });
      return actual.link(source, destination);
    }),
    unlink: vi.fn(async (path: Parameters<typeof actual.unlink>[0]) => {
      if (publication.failTemporaryUnlinkOnce && String(path).endsWith(".tmp")) {
        publication.failTemporaryUnlinkOnce = false;
        throw Object.assign(new Error("temporary cleanup blocked"), {code: "EPERM"});
      }
      return actual.unlink(path);
    }),
  };
});

import {acquireLock} from "../../../src/store/file-lock.js";

describe("file-lock publication", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    publication.links.length = 0;
    publication.writes.length = 0;
    publication.failTemporaryUnlinkOnce = false;
    if (tempDir) await rm(tempDir, {recursive: true, force: true});
    tempDir = undefined;
  });

  it("publishes a complete lock body atomically", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");

    for (let acquisition = 0; acquisition < 250; acquisition++) {
      const release = await acquireLock(lockPath);
      expect(JSON.parse(await readFile(lockPath, "utf-8"))).toMatchObject({
        pid: process.pid,
        token: expect.any(String),
        timestamp: expect.any(String),
      });
      await release();
    }

    expect(publication.writes).toHaveLength(250);
    expect(publication.writes).not.toContain(lockPath);
    expect(publication.links).toHaveLength(250);
    for (const linked of publication.links) {
      expect(linked.destination).toBe(lockPath);
      expect(JSON.parse(linked.content)).toMatchObject({
        pid: process.pid,
        token: expect.any(String),
        timestamp: expect.any(String),
      });
    }
    expect(await readdir(tempDir)).toEqual([]);
  });

  it("does not report failure or leak the public lock when private-name cleanup fails", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");
    publication.failTemporaryUnlinkOnce = true;

    const release = await acquireLock(lockPath);
    expect(JSON.parse(await readFile(lockPath, "utf-8"))).toMatchObject({
      pid: process.pid,
      token: expect.any(String),
    });
    await release();

    const reacquired = await acquireLock(lockPath);
    await reacquired();
    expect(await readdir(tempDir)).toEqual([expect.stringMatching(/\.tmp$/)]);
  });
});
