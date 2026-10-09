/**
 * `rex backfill-commit-attribution` reports trailer coverage and writes nothing.
 *
 * Runs against a real fixture repository: the thing under test is how commit
 * messages written by real tools parse, which a hand-built fixture object
 * cannot exercise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { cmdBackfillCommitAttribution } from "../../src/cli/commands/backfill-commit-attribution.js";
import { scanCoverageCommits } from "../../src/core/trailer-coverage.js";
import type { TrailerCoverageReport } from "../../src/core/trailer-coverage.js";

const ITEM_A = "9f1c2a3b-0000-4000-8000-00000000000a";
const ITEM_B = "9f1c2a3b-0000-4000-8000-00000000000b";

let root: string;
let repo: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let clock = 0;

function git(...args: string[]): string {
  // A fixed, increasing clock keeps `git log` order and the month grouping
  // deterministic wherever the suite runs.
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}

/** Commit `file` with `message`, written through a file so blank lines survive. */
async function commit(file: string, message: string): Promise<string> {
  await writeFile(join(repo, file), `${file} ${clock}\n`, "utf-8");
  git("add", file);
  const msgFile = join(root, `msg-${clock}.txt`);
  await writeFile(msgFile, message, "utf-8");
  git("commit", "-q", "-F", msgFile);
  return git("rev-parse", "HEAD");
}

/** Run the command and return what it printed. */
async function run(flags: Record<string, string> = {}): Promise<string> {
  logSpy.mockClear();
  await cmdBackfillCommitAttribution(repo, flags);
  return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

async function runJson(): Promise<TrailerCoverageReport> {
  return JSON.parse(await run({ json: "true" })) as TrailerCoverageReport;
}

/** Every file in the repository bar git's own internals, as relative paths. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out.sort();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rex-trailer-coverage-"));
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  git("config", "commit.gpgsign", "false");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("backfill-commit-attribution", () => {
  /**
   * The three shapes the report has to tell apart, in one history: a commit
   * that carries a trailer, one that carries none, and one that carries two.
   */
  async function buildFixture() {
    const covered = await commit("a.txt", `Do part A\n\nN-DX-Item: ${ITEM_A}\n`);
    const uncovered = await commit("b.txt", `Tidy up\n\nNo trailer here.\n`);
    const twoTrailers = await commit(
      "c.txt",
      `Close both tasks\n\nN-DX-Item: ${ITEM_A}\nN-DX-Item: ${ITEM_B}\n`,
    );
    return { covered, uncovered, twoTrailers };
  }

  it("counts a commit with a trailer, one without, and one with two", async () => {
    await buildFixture();

    const report = await runJson();

    expect(report.totals.commits).toBe(3);
    expect(report.totals.covered).toBe(2);
    expect(report.totals.uncovered).toBe(1);
    // A commit naming two items is still one commit, not two.
    expect(report.totals.covered + report.totals.uncovered).toBe(report.totals.commits);
  });

  it("groups the uncovered commits by author and by month", async () => {
    await buildFixture();
    // A second author, so the grouping has something to separate.
    git("config", "user.email", "other@example.com");
    git("config", "user.name", "Other");
    await commit("d.txt", "Unattributed work by someone else\n");

    const report = await runJson();

    expect(report.byAuthor).toHaveLength(2);
    const byEmail = new Map(report.byAuthor.map((a) => [a.authorEmail, a]));
    expect(byEmail.get("dev@example.com")).toMatchObject({ commits: 3, covered: 2, uncovered: 1 });
    expect(byEmail.get("other@example.com")).toMatchObject({ commits: 1, covered: 0, uncovered: 1 });
    // Most uncovered first; the two tie at 1, so the order falls to email.
    expect(report.byAuthor[0].uncovered).toBe(1);

    expect(report.byMonth).toHaveLength(1);
    expect(report.byMonth[0]).toMatchObject({ month: "2026-10", commits: 4, uncovered: 2 });
  });

  it("reads every N-DX-Item trailer on a commit, not just the first", async () => {
    const { twoTrailers } = await buildFixture();

    const scanned = await scanCoverageCommits(repo, "main");
    const both = scanned.find((c) => c.hash === twoTrailers);

    // Reading only the first trailer would lose ITEM_B entirely — and on this
    // project's own history that was better than half of all attributions.
    expect(both?.writtenItems).toEqual([ITEM_A, ITEM_B]);
    expect(both?.attributedItems).toEqual([ITEM_A, ITEM_B]);
  });

  it("counts an N-DX-Status trailer as covered, in either arrow form", async () => {
    await commit("a.txt", `Close it\n\nN-DX-Status: ${ITEM_A} in_progress → completed\n`);
    await commit("b.txt", `Close it the other way\n\nN-DX-Status: ${ITEM_B} pending -> completed\n`);

    const report = await runJson();

    expect(report.totals.commits).toBe(2);
    expect(report.totals.uncovered).toBe(0);
    // N-DX-Status names an item but is not what v2 attribution reads.
    expect(report.totals.attributed).toBe(0);
  });

  it("separates a trailer git's parser cannot see from one it can", async () => {
    // Written, but not in the final paragraph — the shape most of this
    // project's own history is in, which git classifies as prose.
    await commit(
      "a.txt",
      `Do the thing\n\nN-DX-Item: ${ITEM_A}\n\nThis paragraph ends the message.\n`,
    );
    await commit("b.txt", `Do another thing\n\nN-DX-Item: ${ITEM_B}\n`);

    const report = await runJson();

    expect(report.totals.covered).toBe(2);
    expect(report.totals.attributed).toBe(1);
    expect(report.totals.writtenOutsideTrailerBlock).toBe(1);
  });

  it("counts a merge commit separately so the headline can be read without it", async () => {
    await commit("base.txt", `Base\n\nN-DX-Item: ${ITEM_A}\n`);
    git("checkout", "-q", "-b", "feat");
    await commit("f.txt", `Feature work\n\nN-DX-Item: ${ITEM_B}\n`);
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "Merge feat", "feat");

    const report = await runJson();

    expect(report.totals.uncovered).toBe(1);
    expect(report.totals.uncoveredMerges).toBe(1);
  });

  it("writes nothing — not to .rex/, not a trailer cache, not anywhere", async () => {
    await buildFixture();
    // A rex directory that already exists is the case worth pinning: an empty
    // one proves only that nothing created it.
    await mkdir(join(repo, ".rex", ".cache"), { recursive: true });
    await writeFile(join(repo, ".rex", "config.json"), "{}\n", "utf-8");

    const before = filesUnder(repo);
    const beforeMtimes = before.map((f) => statSync(join(repo, f)).mtimeMs);

    await run();
    await run({ json: "true" });

    expect(filesUnder(repo)).toEqual(before);
    expect(before.map((f) => statSync(join(repo, f)).mtimeMs)).toEqual(beforeMtimes);
  });

  it("prints the same report as text and as JSON", async () => {
    await buildFixture();

    const report = await runJson();
    const text = await run();

    expect(text).toContain(`${report.totals.commits} commits`);
    expect(text).toContain(`${report.totals.covered} carry an item trailer`);
    expect(text).toContain(`${report.totals.uncovered} do not`);
    expect(text).toContain(report.ref);
    expect(text).toContain(report.tip.slice(0, 8));
    for (const author of report.byAuthor) {
      expect(text).toContain(`${author.author} <${author.authorEmail}>`);
      expect(text).toContain(`${author.uncovered} of ${author.commits} uncovered`);
    }
    for (const month of report.byMonth) expect(text).toContain(month.month);
  });

  it("reads a history whose log exceeds the default exec buffer", async () => {
    // The whole log is buffered in memory. At exec's 1 MiB default this
    // repository's own history overflowed and the predecessor reported
    // "could not read git history" and recorded nothing — a silent no-op.
    // One oversized body reproduces that without building a long history.
    const filler = Array.from(
      { length: 24_000 },
      (_, i) => `padding line ${i} ${"x".repeat(60)}`,
    ).join("\n");
    const message = `Do the thing\n\n${filler}\n\nN-DX-Item: ${ITEM_A}\n`;
    expect(Buffer.byteLength(message, "utf-8")).toBeGreaterThan(1024 * 1024);
    await commit("a.txt", message);

    const report = await runJson();

    expect(report.totals.commits).toBe(1);
    expect(report.totals.covered).toBe(1);
  });

  it("fails loudly when the branch does not exist", async () => {
    await buildFixture();

    await expect(cmdBackfillCommitAttribution(repo, { ref: "no-such-branch" })).rejects.toThrow(
      /Could not read git history/,
    );
  });
});
