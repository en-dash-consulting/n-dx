/**
 * `rex claim` — the CLI over cross-worktree claims.
 *
 * Real git throughout, like the store's own suite: the claims file lives in
 * the git *common* directory, and only `git worktree add` puts a linked
 * worktree's common dir somewhere other than its own `.git`. Faking that
 * would test the fake.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openClaimsStore, claimsStorePath } from "../../../src/store/claims.js";
import {
  cmdClaim,
  collectClaims,
  claimState,
  releasableWithoutForce,
  formatClaims,
  type ClaimReport,
} from "../../../src/cli/commands/claim.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** A pid no process will own. `kill(pid, 0)` raises ESRCH, so it reads as dead. */
const DEAD_PID = 0x7fff_fffe;

let root: string;
let repo: string;
let linked: string;

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "rex-claim-cli-")));
  repo = join(root, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");
  linked = join(root, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  const path = claimsStorePath(repo)!;
  if (existsSync(path)) rmSync(path);
  vi.restoreAllMocks();
  // `release --format=json` reports failure through the exit code rather than
  // a throw, and this process is the test runner — leaving it set would fail
  // the suite from the outside.
  process.exitCode = 0;
});

/** Run a subcommand, returning everything it printed. */
async function run(positional: string[], flags: Record<string, string> = {}): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  await cmdClaim(repo, positional, flags);
  return lines.join("\n");
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("claimState", () => {
  it("is the held reason, or 'running' when a process still owns it", () => {
    expect(claimState({ reason: undefined })).toBe("running");
    expect(claimState({ reason: "uncommitted-work" })).toBe("uncommitted-work");
  });
});

describe("releasableWithoutForce", () => {
  it("allows a held claim — freeing it is how the work is declared dealt with", () => {
    expect(releasableWithoutForce({ reason: "uncommitted-work", pid: process.pid })).toBe(true);
  });

  it("allows a claim whose holder is gone — the store would drop it at expiry anyway", () => {
    expect(releasableWithoutForce({ reason: undefined, pid: DEAD_PID })).toBe(true);
  });

  it("refuses a live run, which is the duplicate work claims exist to prevent", () => {
    expect(releasableWithoutForce({ reason: undefined, pid: process.pid })).toBe(false);
  });
});

describe("formatClaims", () => {
  it("says so plainly when nothing is held", () => {
    expect(formatClaims([]).join("\n")).toContain("No task claims");
  });

  it("names the title, worktree, holder liveness, state and expiry", () => {
    const report: ClaimReport = {
      taskId: "abc123",
      title: "Hold the task claim",
      worktreeRoot: "/repo/wt",
      pid: 4242,
      host: "box",
      pidAlive: false,
      claimedAt: "2026-09-22T10:00:00.000Z",
      expiresAt: "2026-09-22T14:00:00.000Z",
      reason: "uncommitted-work",
      mine: false,
    };
    const out = formatClaims([report]).join("\n");
    expect(out).toContain("abc123");
    expect(out).toContain("Hold the task claim");
    expect(out).toContain("/repo/wt");
    expect(out).toContain("pid 4242 on box — not running");
    expect(out).toContain("uncommitted-work");
    expect(out).toContain("2026-09-22 14:00");
    expect(out).not.toContain("(this worktree)");
  });

  it("marks the caller's own claims", () => {
    const out = formatClaims([
      {
        taskId: "t", title: null, worktreeRoot: "/w", pid: 1, host: "h", pidAlive: true,
        claimedAt: "2026-09-22T10:00:00.000Z", expiresAt: "2026-09-22T14:00:00.000Z",
        reason: null, mine: true,
      },
    ]).join("\n");
    expect(out).toContain("(this worktree)");
    expect(out).toContain("running");
    // No PRD here, so the title degrades rather than failing the listing.
    expect(out).toContain("not in this worktree's PRD");
  });
});

// ── list ────────────────────────────────────────────────────────────────────

describe("rex claim list", () => {
  it("reports a running claim and a held one, each with its state", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T-running", { worktreeRoot: repo });
    await mine.claim("T-held", { worktreeRoot: repo });
    await mine.hold("T-held", { worktreeRoot: repo }, "uncommitted-work");

    const out = await run(["list"]);
    expect(out).toContain("2 task claims");
    expect(out).toContain("T-running");
    expect(out).toContain("T-held");
    expect(out).toContain("uncommitted-work");
    expect(out).toContain("running");
  });

  it("emits the same rows as JSON", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });
    await mine.hold("T1", { worktreeRoot: repo }, "uncommitted-work");

    const parsed = JSON.parse(await run(["list"], { format: "json" })) as { claims: ClaimReport[] };
    expect(parsed.claims).toHaveLength(1);
    expect(parsed.claims[0]).toMatchObject({
      taskId: "T1",
      worktreeRoot: repo,
      reason: "uncommitted-work",
      mine: true,
    });
  });

  it("shows another worktree's held claim, and does not call it mine", async () => {
    const theirs = openClaimsStore(linked);
    await theirs.claim("T1", { worktreeRoot: linked });
    await theirs.hold("T1", { worktreeRoot: linked }, "uncommitted-work");

    const reports = await collectClaims(repo);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ worktreeRoot: linked, mine: false, reason: "uncommitted-work" });
  });

  it("says nothing is held when nothing is", async () => {
    expect(await run(["list"])).toContain("No task claims");
  });
});

// ── release ─────────────────────────────────────────────────────────────────

describe("rex claim release", () => {
  it("frees a held claim without --force", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });
    await mine.hold("T1", { worktreeRoot: repo }, "uncommitted-work");

    expect(await run(["release", "T1"])).toContain("Released the claim on T1");
    expect(await mine.readClaims()).toEqual([]);
  });

  it("refuses a claim whose run is still alive, and names the pid", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });

    await expect(run(["release", "T1"])).rejects.toThrow(/still working it/);
    expect(await mine.readClaims()).toHaveLength(1);

    // The same refusal, as a message rather than a throw, under --format=json.
    const parsed = JSON.parse(await run(["release", "T1"], { format: "json" })) as {
      released: boolean; detail: string;
    };
    expect(parsed.released).toBe(false);
    expect(parsed.detail).toContain(String(process.pid));
  });

  it("frees a live claim when --force says so", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T1", { worktreeRoot: repo });

    expect(await run(["release", "T1"], { force: "true" })).toContain("Released");
    expect(await mine.readClaims()).toEqual([]);
  });

  it("frees another worktree's held claim only with --force", async () => {
    const theirs = openClaimsStore(linked);
    await theirs.claim("T1", { worktreeRoot: linked });
    await theirs.hold("T1", { worktreeRoot: linked }, "uncommitted-work");

    // Held, so the liveness gate passes — but it is not this worktree's to free.
    await expect(run(["release", "T1"])).rejects.toThrow(/another worktree/);
    expect(await theirs.readClaims()).toHaveLength(1);

    expect(await run(["release", "T1"], { force: "true" })).toContain("Released");
    expect(await theirs.readClaims()).toEqual([]);
  });

  it("reports a task nobody holds rather than pretending to free it", async () => {
    await expect(run(["release", "absent"])).rejects.toThrow(/no live claim/);
  });

  it("needs a task id unless --all is given", async () => {
    await expect(run(["release"])).rejects.toThrow(/needs a task id/);
  });
});

describe("rex claim release --all", () => {
  it("frees this worktree's claims and leaves other worktrees alone", async () => {
    const mine = openClaimsStore(repo);
    const theirs = openClaimsStore(linked);
    await mine.claim("T-mine", { worktreeRoot: repo });
    await mine.hold("T-mine", { worktreeRoot: repo }, "uncommitted-work");
    await theirs.claim("T-theirs", { worktreeRoot: linked });
    await theirs.hold("T-theirs", { worktreeRoot: linked }, "uncommitted-work");

    const out = await run(["release"], { all: "true" });
    expect(out).toContain("Released 1 of 1");
    expect(out).toContain("T-mine");

    expect((await mine.readClaims()).map((c) => c.taskId)).toEqual(["T-theirs"]);
  });

  it("keeps a claim whose run is still alive, and says which", async () => {
    const mine = openClaimsStore(repo);
    await mine.claim("T-live", { worktreeRoot: repo });

    const out = await run(["release"], { all: "true" });
    expect(out).toContain("Released 0 of 1");
    expect(out).toContain("kept");
    expect(await mine.readClaims()).toHaveLength(1);
  });

  it("says so when this worktree holds nothing", async () => {
    expect(await run(["release"], { all: "true" })).toContain("No claims are held");
  });
});

describe("rex claim help", () => {
  it("documents both subcommands and what a held claim means", async () => {
    const out = await run([]);
    expect(out).toContain("rex claim list");
    expect(out).toContain("rex claim release <taskId>");
    expect(out).toContain("--force");
    expect(out).toContain("uncommitted");
  });

  it("rejects an unknown subcommand", async () => {
    await expect(run(["frobnicate"])).rejects.toThrow(/Unknown claim subcommand/);
  });
});
