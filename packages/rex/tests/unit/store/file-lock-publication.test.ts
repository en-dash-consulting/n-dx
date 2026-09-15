import {afterEach, describe, expect, it, vi} from "vitest";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const publication = vi.hoisted(() => ({
  links: [] as Array<{source: string; destination: string; content: string}>,
  writes: [] as string[],
  failTemporaryUnlinkOnce: false,
  unsupportedLinkCode: undefined as string | undefined,
  directoryReadContentPath: undefined as string | undefined,
  removeBeforeStatPath: undefined as string | undefined,
  replaceBeforeReadPath: undefined as string | undefined,
  removeReplacementBeforeRetryPath: undefined as string | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async (path: Parameters<typeof actual.writeFile>[0], ...args: unknown[]) => {
      publication.writes.push(String(path));
      return (actual.writeFile as (...writeArgs: unknown[]) => Promise<void>)(path, ...args);
    }),
    readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], ...args: unknown[]) => {
      if (String(path) === publication.directoryReadContentPath) return "directory entry data";
      if (String(path) === publication.replaceBeforeReadPath) {
        publication.replaceBeforeReadPath = undefined;
        await actual.unlink(path);
        await actual.writeFile(
          path,
          JSON.stringify({pid: process.ppid, token: "replacement-holder", timestamp: new Date().toISOString()}),
        );
        publication.removeReplacementBeforeRetryPath = String(path);
        throw Object.assign(new Error("lock disappeared before inspection"), {code: "ENOENT"});
      }
      return (actual.readFile as (...readArgs: unknown[]) => Promise<unknown>)(path, ...args);
    }),
    stat: vi.fn(async (path: Parameters<typeof actual.stat>[0], ...args: unknown[]) => {
      if (String(path) === publication.removeBeforeStatPath) {
        publication.removeBeforeStatPath = undefined;
        await actual.unlink(path);
      }
      return (actual.stat as (...statArgs: unknown[]) => Promise<unknown>)(path, ...args);
    }),
    link: vi.fn(async (source: string, destination: string) => {
      publication.links.push({
        source,
        destination,
        content: await actual.readFile(source, "utf-8"),
      });
      if (publication.unsupportedLinkCode) {
        throw Object.assign(new Error("hard links unsupported"), {code: publication.unsupportedLinkCode});
      }
      if (String(destination) === publication.removeReplacementBeforeRetryPath) {
        publication.removeReplacementBeforeRetryPath = undefined;
        await actual.unlink(destination);
      }
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
    publication.unsupportedLinkCode = undefined;
    publication.directoryReadContentPath = undefined;
    publication.removeBeforeStatPath = undefined;
    publication.replaceBeforeReadPath = undefined;
    publication.removeReplacementBeforeRetryPath = undefined;
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

  it.each(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EXDEV"])(
    "falls back to atomic directory publication when hard links fail with %s",
    async (code) => {
      tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
      const lockPath = join(tempDir, "prd.lock");
      publication.unsupportedLinkCode = code;

      const release = await acquireLock(lockPath);

      expect((await stat(lockPath)).isDirectory()).toBe(true);
      expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf-8"))).toMatchObject({
        pid: process.pid,
        token: expect.any(String),
        timestamp: expect.any(String),
      });
      expect(publication.links).toHaveLength(1);

      await release();
      expect(await readdir(tempDir)).toEqual([]);
    },
  );

  it("waits on an incomplete fallback publication instead of classifying it as stale", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");
    publication.unsupportedLinkCode = "EOPNOTSUPP";
    await mkdir(lockPath);

    await expect(acquireLock(lockPath, {acquireTimeoutMs: 80, retryDelayMs: 10}))
      .rejects.toThrow(/Could not acquire PRD lock/);

    expect(publication.links.length).toBeGreaterThan(1);
  });

  it("recognizes an incomplete fallback when reading a directory succeeds", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");
    publication.unsupportedLinkCode = "EOPNOTSUPP";
    publication.directoryReadContentPath = lockPath;
    await mkdir(lockPath);

    await expect(acquireLock(lockPath, {acquireTimeoutMs: 80, retryDelayMs: 10}))
      .rejects.toThrow(/Held by a lock publication in progress/);

    expect(publication.links.length).toBeGreaterThan(1);
  });

  it("retries when an EEXIST lock disappears before its state is inspected", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");
    await writeFile(
      lockPath,
      JSON.stringify({pid: process.ppid, token: "released-holder", timestamp: new Date().toISOString()}),
    );
    publication.removeBeforeStatPath = lockPath;

    const release = await acquireLock(lockPath, {acquireTimeoutMs: 200, retryDelayMs: 1});

    // The first link observed the old lock. The second one succeeded after the
    // inspection saw that it had disappeared, rather than waiting for timeout.
    expect(publication.links).toHaveLength(2);
    await expect(stat(lockPath)).resolves.toBeTruthy();
    await release();
  });

  it("retries when a new contender republishes after the conflicted lock disappears", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");
    await writeFile(
      lockPath,
      JSON.stringify({pid: process.ppid, token: "released-holder", timestamp: new Date().toISOString()}),
    );
    publication.replaceBeforeReadPath = lockPath;

    const release = await acquireLock(lockPath, {acquireTimeoutMs: 200, retryDelayMs: 1});

    // A third contender republished after our first EEXIST. Its metadata is
    // not malformed state from the first contender; after it releases, retry.
    expect(publication.links).toHaveLength(2);
    await release();
  });

  it("does not use the fallback for unrelated link failures", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-lock-publication-"));
    const lockPath = join(tempDir, "prd.lock");
    publication.unsupportedLinkCode = "EACCES";

    await expect(acquireLock(lockPath)).rejects.toMatchObject({code: "EACCES"});
    expect(await readdir(tempDir)).toEqual([]);
  });
});
