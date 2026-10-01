import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { initGitFixtureRepoSync } from "../../helpers/index.js";
import {
  ensureRunLogsIgnored,
  openRunLog,
  persistRunLog,
  runLogPath,
} from "../../../src/store/run-log.js";

/**
 * Read `path` until it satisfies `predicate`, or give up after `timeoutMs`.
 *
 * The incremental writer hands each line to Node's stream buffer and returns
 * without awaiting the disk, so a reader has to poll. The timeout doubles as
 * the acceptance bound: a tail must see new lines within a second.
 */
async function readUntil(
  path: string,
  predicate: (content: string) => boolean,
  timeoutMs = 1000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let content = "";
  for (;;) {
    content = await readFile(path, "utf-8");
    if (predicate(content)) return content;
    if (Date.now() >= deadline) return content;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("persistRunLog", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-runlog-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates .run-logs/ directory automatically", async () => {
    await persistRunLog(projectDir, "run-id-1", "2026-04-08T23:21:17Z", ["line 1"]);

    // Directory must exist after the call
    await expect(access(join(projectDir, ".run-logs"))).resolves.toBeUndefined();
  });

  it("writes all lines to the log file", async () => {
    const lines = ["[Agent]   thinking", "[Tool]    read_file", "[Result]  contents"];
    await persistRunLog(projectDir, "run-id-2", "2026-04-08T10:00:00Z", lines);

    const logDir = join(projectDir, ".run-logs");
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(logDir)).filter((name) => name.endsWith(".log"));
    expect(files).toHaveLength(1);

    const content = await readFile(join(logDir, files[0]!), "utf-8");
    expect(content).toBe(lines.join("\n") + "\n");
  });

  it("names the file with ISO timestamp (colons replaced) and run ID", async () => {
    const runId = "abc123ef-0000-0000-0000-000000000000";
    const logPath = await persistRunLog(projectDir, runId, "2026-04-08T23:21:17Z", []);

    expect(logPath).toContain("2026-04-08T23-21-17");
    expect(logPath).toContain(runId);
    expect(logPath.endsWith(".log")).toBe(true);
  });

  it("strips fractional seconds from the timestamp in the filename", async () => {
    const logPath = await persistRunLog(
      projectDir,
      "run-id-3",
      "2026-04-08T23:21:17.999Z",
      [],
    );

    // basename, not split("/"): on Windows the separator is a backslash, so
    // split("/") returns the whole path as a single element and `.at(-1)` yields
    // the full path. The assertions below then passed by accident — the path
    // happens to contain the timestamp and not "999" — while never actually
    // checking the filename. Not one of this task's six failures; a latent bug
    // of the same class, found while fixing the line below.
    const filename = basename(logPath);
    expect(filename).not.toContain("999");
    expect(filename).toContain("2026-04-08T23-21-17");
  });

  it("resolves a relative project directory to an absolute path", () => {
    // The path goes on the run record, where a reader in another process has
    // a different cwd to resolve it against. Asserted on the pure path helper
    // rather than by chdir-ing the test process, which is shared.
    expect(isAbsolute(runLogPath("some/project", "run-id-rel", "2026-04-08T00:00:00Z"))).toBe(true);
  });

  it("returns the absolute path of the written file", async () => {
    const logPath = await persistRunLog(projectDir, "run-id-4", "2026-04-08T00:00:00Z", []);

    // isAbsolute, not a leading-slash check: an absolute Windows path starts with
    // a drive letter ("C:\..."), so startsWith("/") could never hold there.
    expect(isAbsolute(logPath)).toBe(true);
    await expect(access(logPath)).resolves.toBeUndefined();
  });

  it("produces distinct files for different run IDs", async () => {
    await persistRunLog(projectDir, "run-a", "2026-04-08T10:00:00Z", ["a"]);
    await persistRunLog(projectDir, "run-b", "2026-04-08T10:00:01Z", ["b"]);

    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(join(projectDir, ".run-logs"))).filter((name) => name.endsWith(".log"));
    expect(files).toHaveLength(2);
  });

  it("writes an empty file when lines array is empty", async () => {
    const logPath = await persistRunLog(projectDir, "run-id-5", "2026-04-08T00:00:00Z", []);
    const content = await readFile(logPath, "utf-8");
    expect(content).toBe("");
  });

  describe("gitignore management", () => {
    it("adds .run-logs/ to .gitignore when file does not exist", async () => {
      await persistRunLog(projectDir, "run-id-6", "2026-04-08T00:00:00Z", []);

      const gitignore = await readFile(join(projectDir, ".gitignore"), "utf-8");
      expect(gitignore).toContain(".run-logs/");
    });

    it("appends .run-logs/ to an existing .gitignore", async () => {
      const gitignorePath = join(projectDir, ".gitignore");
      await writeFile(gitignorePath, "node_modules/\ndist/\n", "utf-8");

      await persistRunLog(projectDir, "run-id-7", "2026-04-08T00:00:00Z", []);

      const content = await readFile(gitignorePath, "utf-8");
      expect(content).toContain("node_modules/");
      expect(content).toContain("dist/");
      expect(content).toContain(".run-logs/");
    });

    it("does not duplicate .run-logs/ when already present with trailing slash", async () => {
      const gitignorePath = join(projectDir, ".gitignore");
      await writeFile(gitignorePath, "node_modules/\n.run-logs/\n", "utf-8");

      await persistRunLog(projectDir, "run-id-8", "2026-04-08T00:00:00Z", []);

      const content = await readFile(gitignorePath, "utf-8");
      const matches = content.split("\n").filter((l) => l.trim() === ".run-logs/");
      expect(matches).toHaveLength(1);
    });

    it("does not duplicate .run-logs/ when already present without trailing slash", async () => {
      const gitignorePath = join(projectDir, ".gitignore");
      await writeFile(gitignorePath, ".run-logs\n", "utf-8");

      await persistRunLog(projectDir, "run-id-9", "2026-04-08T00:00:00Z", []);

      const content = await readFile(gitignorePath, "utf-8");
      // Must not contain ".run-logs/" (with slash) since ".run-logs" (without) was already there
      const lines = content.split("\n").filter(Boolean);
      const runLogEntries = lines.filter(
        (l) => l.trim() === ".run-logs" || l.trim() === ".run-logs/",
      );
      expect(runLogEntries).toHaveLength(1);
    });
  });
});

describe("openRunLog", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-runlog-live-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates the file and the .run-logs/ directory before any line is written", async () => {
    const writer = await openRunLog(projectDir, "run-live-1", "2026-04-08T23:21:17Z");

    // The point of opening early: a reader can start tailing before the agent
    // has produced anything at all.
    await expect(access(writer.path)).resolves.toBeUndefined();
    expect(await readFile(writer.path, "utf-8")).toBe("");

    expect(await writer.close()).toBeNull();
  });

  it("uses the same path as the end-of-run writer", async () => {
    const writer = await openRunLog(projectDir, "run-live-2", "2026-04-08T23:21:17.999Z");

    expect(writer.path).toBe(runLogPath(projectDir, "run-live-2", "2026-04-08T23:21:17.999Z"));
    expect(isAbsolute(writer.path)).toBe(true);
    expect(basename(writer.path)).toBe("2026-04-08T23-21-17-run-live-2.log");

    await writer.close();
  });

  it("grows line by line while the run is still open", async () => {
    const writer = await openRunLog(projectDir, "run-live-3", "2026-04-08T10:00:00Z");

    writer.appendLine("  [Agent]   thinking");
    const afterFirst = await readUntil(writer.path, (c) => c.includes("thinking"));
    expect(afterFirst).toBe("  [Agent]   thinking\n");

    writer.appendLine("  [Tool]    read_file");
    const afterSecond = await readUntil(writer.path, (c) => c.includes("read_file"));
    expect(afterSecond).toBe("  [Agent]   thinking\n  [Tool]    read_file\n");

    await writer.close();
  });

  it("leaves a readable partial log when the run never closes it", async () => {
    const writer = await openRunLog(projectDir, "run-live-4", "2026-04-08T10:00:00Z");
    writer.appendLine("line 1");
    writer.appendLine("line 2");

    // No close() — stands in for a run that was killed mid-way.
    const partial = await readUntil(writer.path, (c) => c.includes("line 2"));
    expect(partial).toBe("line 1\nline 2\n");

    await writer.close();
  });

  it("writes prefix lines first, in order, ahead of streamed ones", async () => {
    const writer = await openRunLog(
      projectDir,
      "run-live-5",
      "2026-04-08T10:00:00Z",
      ["preamble a", "preamble b"],
    );
    writer.appendLine("streamed c");
    await writer.close();

    expect(await readFile(writer.path, "utf-8")).toBe("preamble a\npreamble b\nstreamed c\n");
  });

  it("writes an empty file for a run that produced no output", async () => {
    const writer = await openRunLog(projectDir, "run-live-6", "2026-04-08T10:00:00Z");
    await writer.close();

    expect(await readFile(writer.path, "utf-8")).toBe("");
  });

  it("does not touch .gitignore — that is the end of the run's job", async () => {
    // .gitignore is tracked, so writing it while the run is in flight shows
    // the run's own completion gate a modified file it did not expect.
    // `ensureRunLogsIgnored` runs after the gates instead.
    const writer = await openRunLog(projectDir, "run-live-7", "2026-04-08T10:00:00Z");
    await writer.close();

    await expect(access(join(projectDir, ".gitignore"))).rejects.toThrow();

    await ensureRunLogsIgnored(projectDir);
    expect(await readFile(join(projectDir, ".gitignore"), "utf-8")).toContain(".run-logs/");
  });

  it("rejects when the log file cannot be opened", async () => {
    // A directory where the log file should be: open(…, "w") cannot truncate
    // it, so the caller finds out at open time rather than via a stray event.
    await mkdir(join(projectDir, ".run-logs"), { recursive: true });
    await mkdir(runLogPath(projectDir, "run-live-8", "2026-04-08T10:00:00Z"), { recursive: true });

    await expect(
      openRunLog(projectDir, "run-live-8", "2026-04-08T10:00:00Z"),
    ).rejects.toThrow();
  });

  it("is byte-identical to the end-of-run writer for the same lines", async () => {
    // The regression this file exists to prevent: incremental writing must not
    // change the artifact. Same lines in, same bytes out — including the
    // trailing newline and the empty-run case.
    const cases: readonly (readonly string[])[] = [
      [],
      ["only line"],
      ["  [Agent]   thinking", "  [Tool]    read_file", "           42ms", ""],
      ["line with unicode — ✓ ✗ ❯", "line with \"quotes\" and \\backslashes\\"],
    ];

    for (const [index, lines] of cases.entries()) {
      const startedAt = "2026-04-08T10:00:00Z";
      const streamedDir = await mkdtemp(join(tmpdir(), "hench-runlog-cmp-a-"));
      const wholeDir = await mkdtemp(join(tmpdir(), "hench-runlog-cmp-b-"));
      try {
        const writer = await openRunLog(streamedDir, `cmp-${index}`, startedAt);
        for (const line of lines) writer.appendLine(line);
        expect(await writer.close()).toBeNull();

        const wholePath = await persistRunLog(wholeDir, `cmp-${index}`, startedAt, lines);

        expect(await readFile(writer.path)).toEqual(await readFile(wholePath));
      } finally {
        await rm(streamedDir, { recursive: true, force: true });
        await rm(wholeDir, { recursive: true, force: true });
      }
    }
  });
});

/**
 * The log directory ignores itself.
 *
 * The live log exists from the start of the run, but the project `.gitignore`
 * line is added only at the end (`ensureRunLogsIgnored`). On a project's first
 * run that left the growing log visible to git: a review pass listed it as a
 * repair and committed it, and an agent's `git add -A` swept it into the task
 * commit. A `*` ignore file inside the directory hides it from the moment the
 * directory exists, without editing a tracked file mid-run.
 */
describe("run log directory ignore file", () => {
  let projectDir: string;

  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: projectDir, encoding: "utf-8" });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-runlog-ignore-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("is written with '*' when the live log creates the directory", async () => {
    const writer = await openRunLog(projectDir, "run-ign-1", "2026-04-08T10:00:00Z");
    await writer.close();

    expect(await readFile(join(projectDir, ".run-logs", ".gitignore"), "utf-8")).toBe("*\n");
  });

  it("is written when the end-of-run writer creates the directory", async () => {
    await persistRunLog(projectDir, "run-ign-2", "2026-04-08T10:00:00Z", ["x"]);

    expect(await readFile(join(projectDir, ".run-logs", ".gitignore"), "utf-8")).toBe("*\n");
  });

  it("leaves an existing ignore file in the directory alone", async () => {
    await mkdir(join(projectDir, ".run-logs"));
    await writeFile(join(projectDir, ".run-logs", ".gitignore"), "*.log\n");

    const writer = await openRunLog(projectDir, "run-ign-3", "2026-04-08T10:00:00Z");
    await writer.close();

    expect(await readFile(join(projectDir, ".run-logs", ".gitignore"), "utf-8")).toBe("*.log\n");
  });

  it("hides a growing first-run log from git status and git add -A", async () => {
    initGitFixtureRepoSync(projectDir);
    await writeFile(join(projectDir, "README.md"), "fixture\n");
    git("add", "-A");
    git("commit", "-m", "baseline");

    // No `.run-logs/` line in the project's .gitignore.
    const writer = await openRunLog(projectDir, "run-ign-4", "2026-04-08T10:00:00Z");
    writer.appendLine("[Agent]   working");
    await readUntil(writer.path, (content) => content.includes("working"));

    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
    git("add", "-A");
    expect(git("diff", "--cached", "--name-only")).toBe("");

    await writer.close();
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
  });
});
