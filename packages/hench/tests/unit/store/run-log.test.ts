import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { persistRunLog } from "../../../src/store/run-log.js";

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

    const filename = logPath.split("/").at(-1)!;
    expect(filename).not.toContain("999");
    expect(filename).toContain("2026-04-08T23-21-17");
  });

  it("returns the absolute path of the written file", async () => {
    const logPath = await persistRunLog(projectDir, "run-id-4", "2026-04-08T00:00:00Z", []);

    expect(logPath.startsWith("/")).toBe(true);
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
