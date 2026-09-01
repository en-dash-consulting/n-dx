import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { persistRunLog, ensureRunLogGitignored } from "../../../src/store/run-log.js";

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
    const files = await readdir(logDir);
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
    const files = await readdir(join(projectDir, ".run-logs"));
    expect(files).toHaveLength(2);
  });

  it("writes an empty file when lines array is empty", async () => {
    const logPath = await persistRunLog(projectDir, "run-id-5", "2026-04-08T00:00:00Z", []);
    const content = await readFile(logPath, "utf-8");
    expect(content).toBe("");
  });

  /**
   * The ignore entry is written by `ensureRunLogGitignored` at run START, not
   * by `persistRunLog` during finalize. persistRunLog runs after the commit
   * step, so a .gitignore write there left a modified tracked file with
   * nothing left to commit it — the residue this separation removes.
   */
  it("does not touch .gitignore", async () => {
    await persistRunLog(projectDir, "run-id-6", "2026-04-08T00:00:00Z", ["x"]);

    await expect(access(join(projectDir, ".gitignore"))).rejects.toThrow();
  });

  it("leaves an existing .gitignore byte-for-byte unchanged", async () => {
    const gitignorePath = join(projectDir, ".gitignore");
    const before = "node_modules/\ndist/\n";
    await writeFile(gitignorePath, before, "utf-8");

    await persistRunLog(projectDir, "run-id-7", "2026-04-08T00:00:00Z", ["x"]);

    expect(await readFile(gitignorePath, "utf-8")).toBe(before);
  });
});

describe("ensureRunLogGitignored", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-runlog-ignore-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates .gitignore with the entry when the file does not exist", async () => {
    await ensureRunLogGitignored(projectDir);

    const gitignore = await readFile(join(projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".run-logs/");
  });

  it("appends to an existing .gitignore without disturbing it", async () => {
    const gitignorePath = join(projectDir, ".gitignore");
    await writeFile(gitignorePath, "node_modules/\ndist/\n", "utf-8");

    await ensureRunLogGitignored(projectDir);

    const content = await readFile(gitignorePath, "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    expect(content).toContain(".run-logs/");
  });

  it("does not duplicate the entry when already present with trailing slash", async () => {
    const gitignorePath = join(projectDir, ".gitignore");
    await writeFile(gitignorePath, "node_modules/\n.run-logs/\n", "utf-8");

    await ensureRunLogGitignored(projectDir);

    const content = await readFile(gitignorePath, "utf-8");
    const matches = content.split("\n").filter((l) => l.trim() === ".run-logs/");
    expect(matches).toHaveLength(1);
  });

  it("does not duplicate the entry when already present without trailing slash", async () => {
    const gitignorePath = join(projectDir, ".gitignore");
    await writeFile(gitignorePath, ".run-logs\n", "utf-8");

    await ensureRunLogGitignored(projectDir);

    const content = await readFile(gitignorePath, "utf-8");
    // Must not add ".run-logs/" (with slash) when ".run-logs" (without) is there
    const lines = content.split("\n").filter(Boolean);
    const runLogEntries = lines.filter(
      (l) => l.trim() === ".run-logs" || l.trim() === ".run-logs/",
    );
    expect(runLogEntries).toHaveLength(1);
  });

  /**
   * Idempotence is what makes a run-start call safe in --loop and
   * --iterations, where it runs once per task rather than once per project.
   */
  it("is idempotent across repeated calls", async () => {
    const gitignorePath = join(projectDir, ".gitignore");
    await ensureRunLogGitignored(projectDir);
    const afterFirst = await readFile(gitignorePath, "utf-8");

    await ensureRunLogGitignored(projectDir);
    await ensureRunLogGitignored(projectDir);

    expect(await readFile(gitignorePath, "utf-8")).toBe(afterFirst);
  });
});
