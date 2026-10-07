import { describe, it, expect, afterEach } from "vitest";
import { readFile, readdir, rename as fsRename, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicWrite,
  atomicWriteJSON,
  atomicWriteTempPath,
  isAtomicWriteTempPath,
  renameReplacing,
  RENAME_RETRY_DELAYS_MS,
} from "../../../src/store/atomic-write.js";

describe("atomicWriteTempPath / isAtomicWriteTempPath", () => {
  // The matcher and the builder are the two halves of one contract: a reader
  // walking the tree (snapshotPRDTree) skips what a writer is mid-rename. If
  // they drift, the snapshot silently copies temp files again — or worse,
  // aborts on one that vanished. This asserts they agree.
  it("recognises the path the builder produces", () => {
    expect(isAtomicWriteTempPath(atomicWriteTempPath("/tree/epic/index.md"))).toBe(true);
  });

  it("keeps the temp file a sibling of its target", () => {
    const tmp = atomicWriteTempPath("/tree/epic/index.md");
    expect(tmp.startsWith("/tree/epic/index.md.")).toBe(true);
    expect(tmp.endsWith(".tmp")).toBe(true);
  });

  it("gives each call a distinct name", () => {
    const a = atomicWriteTempPath("/tree/epic/index.md");
    const b = atomicWriteTempPath("/tree/epic/index.md");
    expect(a).not.toBe(b);
  });

  it("does not treat real PRD content as a temp file", () => {
    expect(isAtomicWriteTempPath("/tree/epic/index.md")).toBe(false);
    expect(isAtomicWriteTempPath("/tree/epic/.tree-meta.json")).toBe(false);
    // A user-authored file that merely ends in .tmp is content, not in-flight.
    expect(isAtomicWriteTempPath("/tree/epic/notes.tmp")).toBe(false);
    expect(isAtomicWriteTempPath("/tree/epic/index.md.1234.tmp")).toBe(false);
  });
});

describe("atomicWrite", () => {
  const tmpDir = join(tmpdir(), `rex-atomic-write-str-test-${process.pid}`);
  const filePath = join(tmpDir, "test.txt");

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a pre-serialized string atomically", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWrite(filePath, '{"custom":true}');

    const raw = await readFile(filePath, "utf-8");
    expect(raw).toBe('{"custom":true}');
  });
});

describe("atomicWriteJSON", () => {
  const tmpDir = join(tmpdir(), `rex-atomic-write-test-${process.pid}`);
  const filePath = join(tmpDir, "test.json");

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes valid JSON that can be read back", async () => {
    await mkdir(tmpDir, { recursive: true });
    const data = { proposals: [{ title: "Test" }], count: 42 };
    await atomicWriteJSON(filePath, data);

    const raw = await readFile(filePath, "utf-8");
    expect(JSON.parse(raw)).toEqual(data);
  });

  it("overwrites existing file atomically", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWriteJSON(filePath, { version: 1 });
    await atomicWriteJSON(filePath, { version: 2 });

    const raw = await readFile(filePath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 2 });
  });

  it("uses custom serializer when provided", async () => {
    await mkdir(tmpDir, { recursive: true });
    const customSerializer = (d: unknown) => `CUSTOM:${JSON.stringify(d)}`;
    await atomicWriteJSON(filePath, { a: 1 }, customSerializer);

    const raw = await readFile(filePath, "utf-8");
    expect(raw).toBe('CUSTOM:{"a":1}');
  });

  it("does not leave temp files on success", async () => {
    await mkdir(tmpDir, { recursive: true });
    await atomicWriteJSON(filePath, { ok: true });

    const { readdirSync } = await import("node:fs");
    const files = readdirSync(tmpDir);
    expect(files).toEqual(["test.json"]);
  });
});

/** An fs-style error carrying `code`, as `rename` rejects with. */
function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated rename failure`), { code });
}

/** A rename stub that fails with `codes` in order, then succeeds. */
function renameFailing(...codes: string[]) {
  const calls: Array<[string, string]> = [];
  const rename = async (from: string, to: string): Promise<void> => {
    calls.push([from, to]);
    const code = codes[calls.length - 1];
    if (code) throw fsError(code);
  };
  return { rename, calls };
}

/** Records requested waits instead of sleeping, so the tests run instantly. */
function recordingSleep() {
  const waits: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  return { waits, sleep };
}

describe("renameReplacing", () => {
  // Windows refuses to replace a file another process holds open (a concurrent
  // unlocked reader, Defender, the indexer) and Node surfaces that as EPERM,
  // EACCES or EBUSY. These cases inject the platform, so they simulate win32
  // on any host.
  const tmpDir = join(tmpdir(), `rex-rename-replacing-test-${process.pid}`);
  const target = join(tmpDir, "tree-meta.json");

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function tempFileFor(path: string): Promise<string> {
    await mkdir(tmpDir, { recursive: true });
    const tmp = atomicWriteTempPath(path);
    await writeFile(tmp, "{}", "utf-8");
    return tmp;
  }

  it("retries a transient win32 EPERM until the rename succeeds", async () => {
    const { rename, calls } = renameFailing("EPERM", "EPERM");
    const { waits, sleep } = recordingSleep();

    await renameReplacing("a.tmp", "a", { platform: "win32", rename, sleep });

    expect(calls).toHaveLength(3);
    expect(waits).toEqual(RENAME_RETRY_DELAYS_MS.slice(0, 2));
  });

  it.each(["EACCES", "EBUSY"])("retries win32 %s too", async (code) => {
    const { rename, calls } = renameFailing(code);
    const { sleep } = recordingSleep();

    await renameReplacing("a.tmp", "a", { platform: "win32", rename, sleep });

    expect(calls).toHaveLength(2);
  });

  it("rethrows the original code once the bounded retries are spent, and removes the temp file", async () => {
    const tmp = await tempFileFor(target);
    const always = RENAME_RETRY_DELAYS_MS.map(() => "EPERM").concat("EPERM");
    const { rename, calls } = renameFailing(...always);
    const { waits, sleep } = recordingSleep();

    await expect(
      renameReplacing(tmp, target, { platform: "win32", rename, sleep }),
    ).rejects.toMatchObject({ code: "EPERM" });

    expect(calls).toHaveLength(RENAME_RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([...RENAME_RETRY_DELAYS_MS]);
    const total = waits.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(2000);
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("does not retry a win32 error that is not a sharing conflict", async () => {
    const tmp = await tempFileFor(target);
    const { rename, calls } = renameFailing("ENOENT");
    const { waits, sleep } = recordingSleep();

    await expect(
      renameReplacing(tmp, target, { platform: "win32", rename, sleep }),
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it.each(["linux", "darwin"] as const)("does not retry EPERM on %s", async (platform) => {
    const tmp = await tempFileFor(target);
    const { rename, calls } = renameFailing("EPERM");
    const { waits, sleep } = recordingSleep();

    await expect(
      renameReplacing(tmp, target, { platform, rename, sleep }),
    ).rejects.toMatchObject({ code: "EPERM" });

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("is what atomicWrite renames through", async () => {
    await mkdir(tmpDir, { recursive: true });
    const { rename, calls } = renameFailing("EBUSY");
    const { sleep } = recordingSleep();

    await atomicWrite(target, "written", {
      platform: "win32",
      sleep,
      rename: async (from, to) => {
        await rename(from, to);
        await fsRename(from, to);
      },
    });

    expect(calls).toHaveLength(2);
    expect(await readFile(target, "utf-8")).toBe("written");
    expect(await readdir(tmpDir)).toEqual(["tree-meta.json"]);
  });
});
