/**
 * `rex release stamp` on real fixture repositories: the v1 no-op, idempotence,
 * parity with the release-tag fallback, what is left unstamped, and
 * `rex.applyOn: release`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { cmdRelease } from "../../src/cli/commands/release.js";
import { CLIError } from "../../src/cli/errors.js";
import { computeLandings, resolveShippedIn } from "../../src/core/change-landing.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { V2_FIXTURE, editText } from "../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const CHANGE_STATE = "changes/add-apple-pay/state.yaml";

let root: string;
let repo: string;
let rexDir: string;
let output: string[];
let clock = 0;

function git(...args: string[]): string {
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}

async function commit(file: string, message: string): Promise<void> {
  await writeFile(join(repo, file), `${file} ${clock}\n`, "utf-8");
  git("add", file);
  const msgFile = join(root, `msg-${clock}.txt`);
  await writeFile(msgFile, message, "utf-8");
  git("commit", "-q", "-F", msgFile);
}

/** Merge a branch carrying the change's trailer into main with a merge commit. */
async function landChange(): Promise<void> {
  git("checkout", "-q", "-b", "feature");
  await commit("work.txt", `Add Apple Pay\n\nN-DX-Item: ${CHANGE}`);
  git("checkout", "-q", "main");
  git("merge", "--no-ff", "-q", "-m", "Merge feature", "feature");
}

/** Every PRD file under the rex directory except the derived cache, by relative path. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(rexDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(rexDir, join(entry.parentPath, entry.name));
    if (path.startsWith(".cache")) continue;
    out[path] = await readFile(join(rexDir, path), "utf-8");
  }
  return out;
}

async function stamp(version: string, flags: Record<string, string> = {}): Promise<void> {
  output.length = 0;
  await cmdRelease(repo, ["stamp", version], flags);
}

async function stampJson(version: string): Promise<{ applied: string[]; stamped: string[]; skipped: Array<{ id: string; reason: string }> }> {
  await stamp(version, { format: "json" });
  return JSON.parse(output.join("\n"));
}

const change = async () => (await loadPrdModel(rexDir, { env: {}, warn: () => {} })).tree.changes[0];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rex-release-stamp-"));
  repo = join(root, "repo");
  rexDir = join(repo, ".rex");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  git("config", "commit.gpgsign", "false");
  await cp(V2_FIXTURE, rexDir, { recursive: true });
  await editText(join(rexDir, CHANGE_STATE), (t) => t.replace('status: "in_progress"', 'status: "completed"'));
  git("add", ".rex");
  await commit("base.txt", "Initial commit");
  output = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void output.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("v1 and no rex directory", () => {
  it("prints nothing to stamp and writes nothing on a v1 tree outside any git repository", async () => {
    const plain = join(root, "plain");
    await mkdir(join(plain, ".rex", "prd_tree"), { recursive: true });
    await writeFile(join(plain, ".rex", "prd_tree", "broken.md"), "not frontmatter at all\n");
    const before = await readdir(plain, { recursive: true });

    await cmdRelease(plain, ["stamp", "1.0.0"], {});
    expect(output).toEqual(["Nothing to stamp: this project is on the v1 tree; shippedIn is stamped on v2 changes."]);
    expect(await readdir(plain, { recursive: true })).toEqual(before);
  });

  it("succeeds with no rex directory, and with a version it would refuse on v2", async () => {
    const empty = join(root, "empty");
    await mkdir(empty);
    await cmdRelease(empty, ["stamp", "1.0.0-rc.1"], {});
    expect(output).toEqual([`Nothing to stamp: there is no rex directory in ${empty}.`]);
    expect(await readdir(empty)).toEqual([]);
  });
});

describe("version", () => {
  it("stores vX.Y.Z as X.Y.Z", async () => {
    await landChange();
    await stamp("v1.2.0");
    expect((await change()).shippedIn).toBe("1.2.0");
  });

  it.each(["1.2.0-rc.1", "1.2", "latest", ""])("refuses %j", async (version) => {
    await expect(stamp(version)).rejects.toBeInstanceOf(CLIError);
  });

  it("refuses a missing version", async () => {
    await expect(cmdRelease(repo, ["stamp"], {})).rejects.toThrow(/Missing release version/);
  });

  it("refuses an unknown subcommand", async () => {
    await expect(cmdRelease(repo, ["publish", "1.0.0"], {})).rejects.toThrow(/Unknown release subcommand: publish/);
  });
});

describe("stamping", () => {
  it("is idempotent: a second run, with the same or another version, changes no file", async () => {
    await landChange();
    const before = await snapshot();
    expect((await stampJson("1.0.0")).stamped).toEqual([CHANGE]);
    const stamped = await snapshot();
    expect(stamped).not.toEqual(before);
    expect(stamped[CHANGE_STATE]).toMatch(/shippedIn: "?1\.0\.0"?/);

    expect((await stampJson("1.0.0")).stamped).toEqual([]);
    expect(await snapshot()).toEqual(stamped);
    expect((await stampJson("1.1.0")).stamped).toEqual([]);
    expect(await snapshot()).toEqual(stamped);
  });

  it("matches the release-tag fallback once the release is tagged", async () => {
    await landChange();
    await stamp("1.0.0");
    git("tag", "v1.0.0");

    const stamped = await change();
    const { shippedIn, ...unstamped } = stamped;
    const landing = (await computeLandings({ product: [], changes: [unstamped] }, { repoDir: repo, cacheDir: join(rexDir, ".cache") }))[CHANGE];
    expect(shippedIn).toBe("1.0.0");
    expect(await resolveShippedIn(unstamped, landing, repo)).toBe(shippedIn);
  });

  it("leaves a change whose landing is already in an older release tag unstamped", async () => {
    await landChange();
    git("tag", "v0.9.0");
    const before = await snapshot();
    const report = await stampJson("1.0.0");
    expect(report).toMatchObject({ stamped: [], skipped: [] });
    expect(await snapshot()).toEqual(before);
  });

  it("reports a finished change that has not landed, with the reason, and leaves it unstamped", async () => {
    git("checkout", "-q", "-b", "unmerged");
    await commit("work.txt", `Add Apple Pay\n\nN-DX-Item: ${CHANGE}`);
    git("checkout", "-q", "main");
    const before = await snapshot();

    const report = await stampJson("1.0.0");
    expect(report.stamped).toEqual([]);
    expect(report.skipped).toEqual([{ id: CHANGE, reason: expect.stringMatching(/reachable from main/) }]);
    expect(await snapshot()).toEqual(before);
  });

  it("writes nothing on --dry-run", async () => {
    await landChange();
    const before = await snapshot();
    await stamp("1.0.0", { "dry-run": "true" });
    expect(output.join("\n")).toMatch(/Would stamp 1 change\(s\) as shipped in 1\.0\.0/);
    expect(await snapshot()).toEqual(before);
  });
});

describe("rex.applyOn", () => {
  const setApplyOn = (applyOn: string) => writeFile(join(repo, ".n-dx.json"), JSON.stringify({ rex: { applyOn } }));

  it("release: applies a completed, unapplied change and stamps it", async () => {
    await setApplyOn("release");
    await landChange();
    const report = await stampJson("1.0.0");
    expect(report).toMatchObject({ applied: [CHANGE], stamped: [CHANGE] });
    const after = await change();
    expect(after.appliedAt).toBeDefined();
    expect(after.shippedIn).toBe("1.0.0");
  });

  it("complete: applies nothing, still stamps the completed change", async () => {
    await setApplyOn("complete");
    await landChange();
    const report = await stampJson("1.0.0");
    expect(report).toMatchObject({ applied: [], stamped: [CHANGE] });
    expect((await change()).appliedAt).toBeUndefined();
  });
});
