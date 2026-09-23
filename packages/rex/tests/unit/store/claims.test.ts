import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  openClaimsStore,
  claimsStorePath,
  resolveClaimHolder,
  NOOP_CLAIMS_STORE,
  DEFAULT_CLAIM_TTL_MS,
} from "../../../src/store/claims.js";

/**
 * Claims in the git common dir: what every worktree of a repository can see.
 *
 * Real git throughout — the store's whole point is where it lives, and only
 * `git worktree add` can put a linked worktree's common dir somewhere other
 * than its own `.git`.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** A live process whose pid a claim can carry — killed on teardown. */
function sleeper(): ChildProcess {
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
}

let root: string;
let repo: string;
let linked: string;
let plain: string;
const children: ChildProcess[] = [];

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "rex-claims-")));
  repo = join(root, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");
  linked = join(root, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
  plain = join(root, "plain");
  mkdirSync(plain);
});

afterAll(() => {
  for (const c of children) c.kill();
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  // Each test starts from an empty store.
  const path = claimsStorePath(repo)!;
  if (existsSync(path)) rmSync(path);
});

describe("claimsStorePath", () => {
  it("is <common dir>/ndx/claims.json, shared by the main checkout and its linked worktree", () => {
    const fromMain = claimsStorePath(repo);
    expect(fromMain).toBe(join(repo, ".git", "ndx", "claims.json"));
    expect(claimsStorePath(linked)).toBe(fromMain);
    mkdirSync(join(linked, "deeper"), { recursive: true });
    expect(claimsStorePath(join(linked, "deeper"))).toBe(fromMain);
  });

  it("is null outside a repository", () => {
    expect(claimsStorePath(plain)).toBeNull();
  });
});

describe("resolveClaimHolder", () => {
  it("names the worktree root git reports and this process", () => {
    mkdirSync(join(linked, "sub", "dir"), { recursive: true });
    expect(resolveClaimHolder(join(linked, "sub", "dir"))).toEqual({ worktreeRoot: linked, pid: process.pid });
    expect(resolveClaimHolder(repo).worktreeRoot).toBe(repo);
  });

  it("falls back to the directory itself outside a repository", () => {
    expect(resolveClaimHolder(plain)).toEqual({ worktreeRoot: plain, pid: process.pid });
  });
});

describe("no-op store outside a repository", () => {
  it("claims always succeed, nothing is recorded, nothing is ever claimed by another", async () => {
    const store = openClaimsStore(plain);
    expect(store).toBe(NOOP_CLAIMS_STORE);
    expect(store.path).toBeNull();
    const result = await store.claim("T1", { worktreeRoot: plain });
    expect(result.ok).toBe(true);
    expect(await store.readClaims()).toEqual([]);
    expect(await store.isClaimedByOther("T1", { worktreeRoot: "/elsewhere" })).toBeNull();
    expect(await store.claimedElsewhere("/elsewhere")).toEqual(new Map());
    expect(await store.release("T1", { worktreeRoot: plain })).toBe(true);
    expect(existsSync(join(plain, ".git"))).toBe(false);
  });
});

describe("file store", () => {
  it("claim / release round trip, visible from the other worktree", async () => {
    const mine = openClaimsStore(repo);
    const theirs = openClaimsStore(linked);

    const result = await mine.claim("T1", { worktreeRoot: repo });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claim).toMatchObject({ taskId: "T1", worktreeRoot: repo, pid: process.pid });
    expect(Date.parse(result.claim.expiresAt) - Date.parse(result.claim.claimedAt)).toBe(DEFAULT_CLAIM_TTL_MS);

    // The linked worktree reads the same file.
    expect((await theirs.readClaims()).map((c) => c.taskId)).toEqual(["T1"]);
    expect(await theirs.isClaimedByOther("T1", { worktreeRoot: linked })).toMatchObject({ pid: process.pid });
    // From the holder's own point of view it is not "another" — and that is
    // decided by the worktree, so another process in the same checkout (a
    // retry there is not a conflict) sees the same answer.
    expect(await mine.isClaimedByOther("T1", { worktreeRoot: repo })).toBeNull();
    expect([...(await theirs.claimedElsewhere(linked)).keys()]).toEqual(["T1"]);
    expect(await mine.claimedElsewhere(repo)).toEqual(new Map());

    // Only the holding worktree can release; another's release is a no-op.
    expect(await theirs.release("T1", { worktreeRoot: linked })).toBe(false);
    expect(await mine.release("T1", { worktreeRoot: repo })).toBe(true);
    expect(await theirs.readClaims()).toEqual([]);
    // The file itself is inside .git, never a tracked path.
    expect(git(repo, "status", "--porcelain").trim()).toBe("");
  });

  it("re-claiming your own task refreshes the expiry and keeps the original claim time", async () => {
    let t = Date.parse("2026-09-16T10:00:00Z");
    const store = openClaimsStore(repo, { now: () => t });
    const first = await store.claim("T1", { worktreeRoot: repo, ttlMs: 60_000 });
    t += 30_000;
    const second = await store.claim("T1", { worktreeRoot: repo, ttlMs: 60_000 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.claim.claimedAt).toBe(first.claim.claimedAt);
    expect(Date.parse(second.claim.expiresAt)).toBe(t + 60_000);
  });

  it("a claim whose pid is dead is ignored and pruned", async () => {
    const path = claimsStorePath(repo)!;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 1,
      claims: {
        T1: { taskId: "T1", worktreeRoot: linked, pid: 2 ** 22 + 4242, host: "x", claimedAt: "2026-09-16T09:00:00Z", expiresAt: "2099-01-01T00:00:00Z" },
      },
    }));
    const store = openClaimsStore(repo);
    expect(await store.readClaims()).toEqual([]);
    expect(await store.isClaimedByOther("T1", { worktreeRoot: repo })).toBeNull();
    const result = await store.claim("T1", { worktreeRoot: repo });
    expect(result.ok).toBe(true);
    const onDisk = JSON.parse(await readFile(path, "utf-8"));
    expect(onDisk.claims.T1.pid).toBe(process.pid);
  });

  it("an expired claim is ignored even though its pid is alive", async () => {
    const other = sleeper();
    children.push(other);
    let t = Date.parse("2026-09-16T10:00:00Z");
    const store = openClaimsStore(repo, { now: () => t });
    const held = await store.claim("T1", { worktreeRoot: linked, pid: other.pid!, ttlMs: 1_000 });
    expect(held.ok).toBe(true);
    expect(await store.isClaimedByOther("T1", { worktreeRoot: repo })).not.toBeNull();

    t += 1_001;
    expect(await store.isClaimedByOther("T1", { worktreeRoot: repo })).toBeNull();
    expect(await store.readClaims()).toEqual([]);
    const mine = await store.claim("T1", { worktreeRoot: repo });
    expect(mine.ok).toBe(true);
  });

  it("a live claim from the same worktree by another process is taken over, not refused", async () => {
    const other = sleeper();
    children.push(other);
    const store = openClaimsStore(repo);
    const first = await store.claim("T1", { worktreeRoot: repo, pid: other.pid! });
    const second = await store.claim("T1", { worktreeRoot: repo });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.claim.pid).toBe(process.pid);
    expect(second.claim.claimedAt).toBe(first.claim.claimedAt);
  });

  it("a live claim from another worktree is refused and names the holder", async () => {
    const other = sleeper();
    children.push(other);
    const store = openClaimsStore(repo);
    await store.claim("T1", { worktreeRoot: linked, pid: other.pid! });
    const result = await store.claim("T1", { worktreeRoot: repo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.heldBy).toMatchObject({ worktreeRoot: linked, pid: other.pid });
  });

  it("concurrent claims from two live holders in one process yield exactly one winner", async () => {
    const a = sleeper();
    const b = sleeper();
    children.push(a, b);
    const store = openClaimsStore(repo);
    const results = await Promise.all([
      store.claim("T1", { worktreeRoot: repo, pid: a.pid! }),
      store.claim("T1", { worktreeRoot: linked, pid: b.pid! }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results.find((r) => r.ok)!;
    const loser = results.find((r) => !r.ok)!;
    if (winner.ok && !loser.ok) expect(loser.heldBy.pid).toBe(winner.claim.pid);
  });

  /**
   * One process, two worktrees — the dashboard's shape, and the condition the
   * pid arm of `sameHolder` silently broke.
   *
   * `ndx start` builds a rex MCP server per workspace inside one server
   * process, and the MCP handlers claim without passing a pid, so every
   * worktree's claim carries that one pid. No child process here on purpose:
   * spawning one to get a distinct pid is precisely how a suite can pass while
   * leaving production broken.
   */
  it("one process, two worktrees: the second is refused and cannot release the first's claim", async () => {
    const fromA = openClaimsStore(repo);
    const fromB = openClaimsStore(linked);

    // Both claim as this process — exactly what acquireClaim does.
    const a = await fromA.claim("T1", { worktreeRoot: repo });
    expect(a.ok).toBe(true);

    const b = await fromB.claim("T1", { worktreeRoot: linked });
    expect(b.ok, "B must not be told it holds a task A holds").toBe(false);
    if (b.ok) return;
    expect(b.heldBy).toMatchObject({ worktreeRoot: repo, pid: process.pid });

    // The claim is untouched: it was not overwritten with B's worktreeRoot.
    expect((await fromA.readClaims())[0]).toMatchObject({ worktreeRoot: repo });

    // B still sees it as someone else's, and cannot drop it.
    expect(await fromB.isClaimedByOther("T1", { worktreeRoot: linked })).toMatchObject({ worktreeRoot: repo });
    expect(await fromB.release("T1", { worktreeRoot: linked })).toBe(false);
    expect((await fromA.readClaims()).map((c) => c.taskId)).toEqual(["T1"]);

    // A releases its own, and only then is the task free for B.
    expect(await fromA.release("T1", { worktreeRoot: repo })).toBe(true);
    expect((await fromB.claim("T1", { worktreeRoot: linked })).ok).toBe(true);
  });

  it("ignores a corrupt claims file rather than failing", async () => {
    const path = claimsStorePath(repo)!;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ not json");
    const store = openClaimsStore(repo);
    expect(await store.readClaims()).toEqual([]);
    expect((await store.claim("T1", { worktreeRoot: repo })).ok).toBe(true);
  });
});

describe("two processes", () => {
  const REX_PKG = resolve(fileURLToPath(import.meta.url), "../../../..");
  const DIST_CLAIMS = join(REX_PKG, "dist", "store", "claims.js");

  it("claiming the same task from two processes at once yields one winner", async () => {
    if (!existsSync(DIST_CLAIMS)) {
      throw new Error(`Missing build output ${DIST_CLAIMS}: this test spawns the compiled store. Run 'pnpm --filter @n-dx/rex build' first.`);
    }
    // Each child claims, reports, then stays alive so its pid is live while
    // the other decides — a finished process would read as a dead holder.
    const script = `
import { openClaimsStore } from ${JSON.stringify(pathToFileURL(DIST_CLAIMS).href)};
const store = openClaimsStore(${JSON.stringify(repo)});
const result = await store.claim("T-two", { worktreeRoot: process.argv[2] });
console.log("RESULT=" + JSON.stringify({ ok: result.ok, pid: process.pid }));
setTimeout(() => {}, 20000);
`;
    const scriptPath = join(root, "claim-driver.mjs");
    writeFileSync(scriptPath, script, "utf-8");

    const run = (worktree: string) => new Promise<{ ok: boolean; pid: number }>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [scriptPath, worktree], { stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      let out = "";
      let err = "";
      child.stdout!.on("data", (c) => {
        out += c;
        const m = /RESULT=(.+)/.exec(out);
        if (m) resolvePromise(JSON.parse(m[1]));
      });
      child.stderr!.on("data", (c) => { err += c; });
      child.on("exit", (code) => { if (!/RESULT=/.test(out)) reject(new Error(`child exited ${code} without a result: ${err}`)); });
    });

    const results = await Promise.all([run(repo), run(linked)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  }, 30_000);
});

// ── Held claims (0.7.1 PR D) ────────────────────────────────────────────────
//
// An ordinary claim dies with its pid, which is what stops a crashed run
// wedging a task. That is exactly wrong when the run ended by *refusing* to
// complete the task because its work is still uncommitted: the work is real
// and it is in that worktree, so a second worktree picking the task up would
// redo it. A held claim therefore survives a dead holder and lapses only at
// its expiry.

describe("held claims", () => {
  /** A store that reads the same file but declares every holder dead. */
  const afterHolderExits = (dir: string) => openClaimsStore(dir, { isPidAlive: () => false });

  it("outlives its holder's process, where an ordinary claim does not", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T-held", { worktreeRoot: repo });
    await mine.claim("T-plain", { worktreeRoot: repo });

    const held = await mine.hold("T-held", { worktreeRoot: repo }, "uncommitted-work");
    expect(held).toMatchObject({ taskId: "T-held", worktreeRoot: repo, reason: "uncommitted-work" });

    // The run ends; both pids are now dead.
    const later = afterHolderExits(repo);
    expect((await later.readClaims()).map((c) => c.taskId)).toEqual(["T-held"]);

    // And the other worktree is told, with the reason.
    const theirs = afterHolderExits(linked);
    expect(await theirs.isClaimedByOther("T-held", { worktreeRoot: linked })).toMatchObject({
      worktreeRoot: repo,
      reason: "uncommitted-work",
    });
    expect([...(await theirs.claimedElsewhere(linked)).keys()]).toEqual(["T-held"]);
    expect(await theirs.isClaimedByOther("T-plain", { worktreeRoot: linked })).toBeNull();
  });

  it("does not buy the claim more time, and still lapses at the original expiry", async () => {
    const mine = openClaimsStore(repo);
    const claimed = await mine.claim("T1", { worktreeRoot: repo, ttlMs: 60_000 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const held = await mine.hold("T1", { worktreeRoot: repo }, "uncommitted-work");
    expect(held?.expiresAt).toBe(claimed.claim.expiresAt);
    expect(held?.claimedAt).toBe(claimed.claim.claimedAt);

    // Dead holder, but still inside the TTL: live.
    const during = openClaimsStore(repo, {
      isPidAlive: () => false,
      now: () => Date.parse(claimed.claim.expiresAt) - 1,
    });
    expect(await during.readClaims()).toHaveLength(1);

    // Past it: gone, with nothing needed to clean it up.
    const after = openClaimsStore(repo, {
      isPidAlive: () => false,
      now: () => Date.parse(claimed.claim.expiresAt) + 1,
    });
    expect(await after.readClaims()).toEqual([]);
  });

  it("releases like any other claim — that is how the work is declared dealt with", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });
    await mine.hold("T1", { worktreeRoot: repo }, "uncommitted-work");

    const later = afterHolderExits(repo);
    expect(await later.release("T1", { worktreeRoot: repo })).toBe(true);
    expect(await later.readClaims()).toEqual([]);
  });

  it("is cleared by a fresh claim in the worktree that left the work", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });
    await mine.hold("T1", { worktreeRoot: repo }, "uncommitted-work");

    // Re-running the task there is one of the ways to resolve a hold.
    const again = await mine.claim("T1", { worktreeRoot: repo });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.claim.reason).toBeUndefined();
    expect((await mine.readClaims())[0]!.reason).toBeUndefined();
  });

  it("refuses to hold what this worktree does not hold", async () => {
    const mine = openClaimsStore(repo);
    const theirs = openClaimsStore(linked);

    expect(await mine.hold("nothing-here", { worktreeRoot: repo }, "uncommitted-work")).toBeNull();

    await mine.claim("T1", { worktreeRoot: repo });
    expect(await theirs.hold("T1", { worktreeRoot: linked }, "uncommitted-work")).toBeNull();
    expect((await mine.readClaims())[0]!.reason).toBeUndefined();
  });

  it("still blocks another worktree from claiming the task", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });
    await mine.hold("T1", { worktreeRoot: repo }, "uncommitted-work");

    const theirs = afterHolderExits(linked);
    const attempt = await theirs.claim("T1", { worktreeRoot: linked });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.heldBy).toMatchObject({ worktreeRoot: repo, reason: "uncommitted-work" });
  });
});

describe("release --force", () => {
  it("crosses the worktree boundary, where an ordinary release does not", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });

    const theirs = openClaimsStore(linked);
    // Ownership is absolute by default: one checkout cannot clear another's.
    expect(await theirs.release("T1", { worktreeRoot: linked })).toBe(false);
    expect(await theirs.readClaims()).toHaveLength(1);

    // The operator's deliberate override.
    expect(await theirs.release("T1", { worktreeRoot: linked }, { force: true })).toBe(true);
    expect(await theirs.readClaims()).toEqual([]);
  });

  it("is still false when there is nothing to release", async () => {
    const theirs = openClaimsStore(linked);
    expect(await theirs.release("absent", { worktreeRoot: linked }, { force: true })).toBe(false);
  });
});
