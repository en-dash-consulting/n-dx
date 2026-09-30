/**
 * The session cache survives a transient rename refusal.
 *
 * `writeCacheFileAtomic` writes a temp file and renames it over the target.
 * On Windows a rename onto a file any process holds open does not block — it
 * fails with EPERM, EACCES or EBUSY. The cache's own lock serialises n-dx's
 * writers and cannot serialise anyone else, and `readSessionCache` reads
 * *without* the lock on purpose (a reader only ever costs a missed cache hit),
 * so a concurrent reader is itself enough to make a correctly locked writer
 * fail. Backup, indexing and antivirus software hold files the same way.
 *
 * This was not theoretical: a full-suite run failed in `batch-chain.test.ts`
 * with `EPERM: operation not permitted, rename '…session-cache.json.30212.tmp'
 * -> '…session-cache.json'`, from the production path, under load. The same
 * class is documented in `preview.ts`, which serialises its renames for it, and
 * in the test helpers' `RM_RETRY`.
 *
 * The failure is faked rather than provoked: producing a real EPERM needs a
 * second process holding the file at the exact moment of the rename, which is
 * the kind of test that passes for the wrong reason on a quiet machine.
 *
 * @see packages/hench/src/agent/lifecycle/session-cache.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Fails the next `pending` renames with `code`, then behaves normally. */
const renameFaults = { pending: 0, code: "EPERM", attempts: 0, froms: [] as string[] };

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      renameFaults.attempts++;
      renameFaults.froms.push(from);
      if (renameFaults.pending > 0) {
        renameFaults.pending--;
        const err = new Error(
          `${renameFaults.code}: operation not permitted, rename '${from}' -> '${to}'`,
        ) as NodeJS.ErrnoException;
        err.code = renameFaults.code;
        throw err;
      }
      return actual.rename(from, to);
    },
  };
});

const { writeSessionCache, readSessionCache } = await import(
  "../../../src/agent/lifecycle/session-cache.js"
);

let henchDir: string;

beforeEach(async () => {
  henchDir = await mkdtemp(join(tmpdir(), "hench-rename-retry-"));
  renameFaults.pending = 0;
  renameFaults.code = "EPERM";
  renameFaults.attempts = 0;
  renameFaults.froms = [];
});

afterEach(async () => {
  await rm(henchDir, { recursive: true, force: true });
});

const ENTRY = {
  parentId: "sess-1",
  createdAt: new Date().toISOString(),
  svFingerprint: "fp",
  vendor: "claude",
};

describe("session cache: transient rename failures", () => {
  it("writes through a rename that is refused twice", async () => {
    renameFaults.pending = 2;

    await writeSessionCache(henchDir, ENTRY);

    expect(renameFaults.attempts).toBe(3);
    await expect(readSessionCache(henchDir)).resolves.toMatchObject({ parentId: "sess-1" });
  });

  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    it(`retries a ${code} refusal`, async () => {
      renameFaults.code = code;
      renameFaults.pending = 1;

      await writeSessionCache(henchDir, ENTRY);

      expect(renameFaults.attempts).toBe(2);
      await expect(readSessionCache(henchDir)).resolves.toMatchObject({ parentId: "sess-1" });
    });
  }

  it("gives up rather than retrying forever, and leaves no scratch file", async () => {
    // A target that is held open permanently is not transient, and a write that
    // silently gave up would leave the cache stale with nothing to say why.
    renameFaults.pending = Number.MAX_SAFE_INTEGER;

    await expect(writeSessionCache(henchDir, ENTRY)).rejects.toThrow(/EPERM/);

    const { readdir } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    expect((await readdir(henchDir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("does not retry an error that is not transient", async () => {
    // ENOSPC will not clear by waiting; retrying ten times only delays the
    // report by half a second.
    renameFaults.code = "ENOSPC";
    renameFaults.pending = Number.MAX_SAFE_INTEGER;

    await expect(writeSessionCache(henchDir, ENTRY)).rejects.toThrow(/ENOSPC/);
    expect(renameFaults.attempts).toBe(1);
  });

  it("gives each write its own temp file, not one shared per process", async () => {
    // A pid-only temp name is one file shared by every writer in the process:
    // the second write overwrites the first's scratch file, and the first
    // rename then publishes contents it never wrote, or fails ENOENT because
    // the other rename already consumed it. The lock makes that unreachable
    // today, and the name should not be the reason — `preview.ts` reached the
    // same conclusion from the other direction, having no lock at all.
    for (let i = 0; i < 5; i++) {
      await writeSessionCache(henchDir, { ...ENTRY, parentId: `sess-${i}` });
    }

    expect(renameFaults.froms).toHaveLength(5);
    expect(new Set(renameFaults.froms).size).toBe(5);
    // And the pid alone would not have distinguished them.
    for (const from of renameFaults.froms) expect(from).toContain(`.${process.pid}.`);

    const raw = JSON.parse(await readFile(join(henchDir, "session-cache.json"), "utf-8"));
    expect(raw.entry?.parentId ?? raw.parentId).toBe("sess-4");
  });
});
