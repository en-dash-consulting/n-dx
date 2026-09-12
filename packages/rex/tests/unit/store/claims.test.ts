import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openClaimsStore, CLAIMS_FILENAME, DEFAULT_CLAIM_TTL_MS } from "../../../src/store/claims.js";

/** A PID that is certainly not running. */
const DEAD_PID = 999_999_999;

/** A live PID that is not this process — so it cannot be mistaken for ours. */
const LIVE_FOREIGN_PID = process.ppid;

describe("claims", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeTmpDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  /** A real git repository — the claims store needs `git rev-parse` to answer. */
  async function makeRepo(): Promise<string> {
    const dir = await makeTmpDir("rex-claims-repo-");
    execFileSync("git", ["init", "--quiet"], { cwd: dir, stdio: "ignore" });
    return dir;
  }

  /** Path to the claims file of a repo, for tests that inspect it directly. */
  function claimsFileOf(repo: string): string {
    return join(repo, ".git", "ndx", CLAIMS_FILENAME);
  }

  /** Write the claims file by hand, to set up states a caller cannot produce. */
  async function writeClaimsFile(repo: string, claims: unknown): Promise<void> {
    await mkdir(join(repo, ".git", "ndx"), { recursive: true });
    await writeFile(claimsFileOf(repo), JSON.stringify({ claims }, null, 2));
  }

  describe("in a git repository", () => {
    it("round-trips a claim and its release", async () => {
      const repo = await makeRepo();
      const store = openClaimsStore(repo);

      expect(await store.readClaims()).toEqual([]);
      expect(await store.claim("task-1")).toBe(true);

      const claims = await store.readClaims();
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ taskId: "task-1", pid: process.pid });
      expect(claims[0]?.worktreeRoot).toBeTruthy();

      await store.release("task-1");
      expect(await store.readClaims()).toEqual([]);
    });

    it("stores the claims file in the git common dir, not the working tree", async () => {
      const repo = await makeRepo();
      await openClaimsStore(repo).claim("task-1");

      const raw = JSON.parse(await readFile(claimsFileOf(repo), "utf-8"));
      expect(raw.claims).toHaveLength(1);

      // Inside .git, so git can never track it.
      const tracked = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf-8" });
      expect(tracked).toBe("");
    });

    it("is visible from a linked worktree of the same repository", async () => {
      // The whole point: a claim taken in one checkout must be seen by another.
      const repo = await makeRepo();
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init", "--quiet"], {
        cwd: repo,
        stdio: "ignore",
      });
      const linked = join(await makeTmpDir("rex-claims-wt-"), "wt");
      execFileSync("git", ["worktree", "add", "--quiet", "--detach", linked], { cwd: repo, stdio: "ignore" });

      await openClaimsStore(repo).claim("task-1", { pid: LIVE_FOREIGN_PID });

      const fromLinked = openClaimsStore(linked);
      expect(await fromLinked.readClaims()).toHaveLength(1);
      expect(await fromLinked.isClaimedByOther("task-1")).toBe(true);
    });

    it("ignores a claim whose owning process is gone", async () => {
      const repo = await makeRepo();
      await writeClaimsFile(repo, [
        {
          taskId: "task-1",
          pid: DEAD_PID,
          worktreeRoot: "/somewhere/else",
          claimedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + DEFAULT_CLAIM_TTL_MS).toISOString(),
        },
      ]);

      const store = openClaimsStore(repo);
      expect(await store.readClaims()).toEqual([]);
      expect(await store.isClaimedByOther("task-1")).toBe(false);
      expect(await store.claim("task-1")).toBe(true);
    });

    it("ignores an expired claim even when its process is still alive", async () => {
      // A process that took a claim and then wandered off must not hold the
      // task forever; the TTL is the backstop for a live-but-abandoned run.
      const repo = await makeRepo();
      await writeClaimsFile(repo, [
        {
          taskId: "task-1",
          pid: LIVE_FOREIGN_PID,
          worktreeRoot: "/somewhere/else",
          claimedAt: new Date(Date.now() - 2 * DEFAULT_CLAIM_TTL_MS).toISOString(),
          expiresAt: new Date(Date.now() - DEFAULT_CLAIM_TTL_MS).toISOString(),
        },
      ]);

      const store = openClaimsStore(repo);
      expect(await store.readClaims()).toEqual([]);
      expect(await store.isClaimedByOther("task-1")).toBe(false);
      expect(await store.claim("task-1")).toBe(true);
    });

    it("drops dead and expired claims from the file when it next writes", async () => {
      const repo = await makeRepo();
      await writeClaimsFile(repo, [
        { taskId: "dead", pid: DEAD_PID, worktreeRoot: "/a", claimedAt: "2020-01-01T00:00:00.000Z", expiresAt: new Date(Date.now() + DEFAULT_CLAIM_TTL_MS).toISOString() },
        { taskId: "expired", pid: LIVE_FOREIGN_PID, worktreeRoot: "/b", claimedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T04:00:00.000Z" },
      ]);

      await openClaimsStore(repo).claim("task-1");

      const raw = JSON.parse(await readFile(claimsFileOf(repo), "utf-8"));
      expect(raw.claims.map((c: { taskId: string }) => c.taskId)).toEqual(["task-1"]);
    });

    it("refuses a task another live process holds", async () => {
      const repo = await makeRepo();
      const held = await openClaimsStore(repo).claim("task-1", { pid: LIVE_FOREIGN_PID, worktreeRoot: "/other/worktree" });
      expect(held).toBe(true);

      const store = openClaimsStore(repo);
      expect(await store.claim("task-1")).toBe(false);
      expect(await store.isClaimedByOther("task-1")).toBe(true);
      // Unrelated tasks stay available.
      expect(await store.isClaimedByOther("task-2")).toBe(false);
    });

    it("does not report our own claim as someone else's", async () => {
      const repo = await makeRepo();
      const store = openClaimsStore(repo);
      await store.claim("task-1");

      expect(await store.isClaimedByOther("task-1")).toBe(false);
      // Re-claiming our own task is idempotent, and renews the expiry.
      expect(await store.claim("task-1")).toBe(true);
      expect(await store.readClaims()).toHaveLength(1);
    });

    it("yields exactly one winner when two processes claim at once", async () => {
      const repo = await makeRepo();
      const store = openClaimsStore(repo);

      const results = await Promise.all([
        store.claim("task-1", { pid: process.pid, worktreeRoot: "/wt/a" }),
        store.claim("task-1", { pid: LIVE_FOREIGN_PID, worktreeRoot: "/wt/b" }),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.readClaims()).toHaveLength(1);
    });

    it("release only removes the claim it owns", async () => {
      // A late release from a process whose claim already expired and was
      // retaken must not evict the new holder.
      const repo = await makeRepo();
      const store = openClaimsStore(repo);
      await store.claim("task-1", { pid: LIVE_FOREIGN_PID });

      await store.release("task-1", { pid: process.pid });
      expect(await store.readClaims()).toHaveLength(1);

      await store.release("task-1", { pid: LIVE_FOREIGN_PID });
      expect(await store.readClaims()).toEqual([]);
    });

    it("honours a custom ttl", async () => {
      const repo = await makeRepo();
      const store = openClaimsStore(repo);
      await store.claim("task-1", { ttlMs: 10 });

      await new Promise((r) => setTimeout(r, 25));
      expect(await store.readClaims()).toEqual([]);
    });

    it("treats a corrupt claims file as empty rather than throwing", async () => {
      const repo = await makeRepo();
      await mkdir(join(repo, ".git", "ndx"), { recursive: true });
      await writeFile(claimsFileOf(repo), "{ not json");

      const store = openClaimsStore(repo);
      expect(await store.readClaims()).toEqual([]);
      expect(await store.claim("task-1")).toBe(true);
      expect(await store.readClaims()).toHaveLength(1);
    });
  });

  describe("outside a git repository", () => {
    it("is a no-op store that never blocks work", async () => {
      const dir = await makeTmpDir("rex-claims-plain-");
      const store = openClaimsStore(dir);

      expect(store.path).toBeNull();
      expect(await store.readClaims()).toEqual([]);
      expect(await store.claim("task-1")).toBe(true);
      expect(await store.isClaimedByOther("task-1")).toBe(false);
      await expect(store.release("task-1")).resolves.toBeUndefined();
      // And it writes nothing.
      expect(await store.readClaims()).toEqual([]);
    });
  });
});
