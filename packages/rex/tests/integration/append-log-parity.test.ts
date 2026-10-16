/**
 * `append_log` (MCP) and `rex log` (CLI) must write through the same
 * entry-builder (`appendExecutionLogEntry`) into the same `PRDStore#appendLog`,
 * so a session with no rex MCP server connected can still produce an
 * execution-log entry indistinguishable from one written by the MCP tool.
 *
 * @see packages/rex/src/core/execution-log.ts — the shared writer
 * @see packages/rex/src/cli/mcp-tools/append-log.ts#handleAppendLog — MCP route
 * @see packages/rex/src/cli/commands/log.ts#cmdLog — CLI route
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/identity.js", () => ({
  resolveActor: vi.fn().mockResolvedValue("Test Actor <test@example.com>"),
}));

import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureRexDir } from "../../src/store/file-adapter.js";
import { resolveStore } from "../../src/store/index.js";
import { handleAppendLog } from "../../src/cli/mcp-tools/index.js";
import { cmdLog } from "../../src/cli/commands/log.js";
import type { LogEntry } from "../../src/schema/index.js";

const MAX_LOG_BYTES = 1_048_576;
const MAX_DETAIL_LENGTH = 2000;

const tmpDirs: string[] = [];

async function makeRexDir(): Promise<{ projectDir: string; rexDir: string }> {
  const tmp = await mkdtemp(join(tmpdir(), "rex-append-log-parity-"));
  tmpDirs.push(tmp);
  const rexDir = join(tmp, ".rex");
  await ensureRexDir(rexDir);
  return { projectDir: tmp, rexDir };
}

async function readLogLines(rexDir: string): Promise<LogEntry[]> {
  const raw = await readFile(join(rexDir, "execution-log.jsonl"), "utf-8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogEntry);
}

describe("append_log (MCP) and rex log (CLI) share one writer", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
    tmpDirs.length = 0;
  });

  it("produces entries that agree on every field but timestamp and actor", async () => {
    const { projectDir, rexDir } = await makeRexDir();
    const store = await resolveStore(rexDir);

    await handleAppendLog(store, { event: "mcp_event", itemId: "item-mcp", detail: "via MCP" });
    await cmdLog(projectDir, "cli_event", { item: "item-cli", detail: "via CLI" });

    const [mcpEntry, cliEntry] = await readLogLines(rexDir);

    expect(mcpEntry.event).toBe("mcp_event");
    expect(mcpEntry.itemId).toBe("item-mcp");
    expect(mcpEntry.detail).toBe("via MCP");

    expect(cliEntry.event).toBe("cli_event");
    expect(cliEntry.itemId).toBe("item-cli");
    expect(cliEntry.detail).toBe("via CLI");

    // Same shape from both routes — the only fields either omits are the
    // ones expected to vary per-call.
    expect(Object.keys(mcpEntry).sort()).toEqual(Object.keys(cliEntry).sort());
    expect(typeof mcpEntry.timestamp).toBe("string");
    expect(typeof mcpEntry.actor).toBe("string");
    expect(typeof cliEntry.timestamp).toBe("string");
    expect(typeof cliEntry.actor).toBe("string");
  });

  it("truncates detail to 2,000 characters identically on both routes", async () => {
    const { projectDir, rexDir } = await makeRexDir();
    const store = await resolveStore(rexDir);
    const longDetail = "d".repeat(MAX_DETAIL_LENGTH + 500);

    await handleAppendLog(store, { event: "mcp_long", detail: longDetail });
    await cmdLog(projectDir, "cli_long", { detail: longDetail });

    const [mcpEntry, cliEntry] = await readLogLines(rexDir);

    expect(mcpEntry.detail).toBe("d".repeat(MAX_DETAIL_LENGTH) + "...");
    expect(cliEntry.detail).toBe("d".repeat(MAX_DETAIL_LENGTH) + "...");
    expect(mcpEntry.detail).toBe(cliEntry.detail);
  });

  it("rotates execution-log.jsonl to execution-log.1.jsonl past 1 MB via the MCP route", async () => {
    const { rexDir } = await makeRexDir();
    const logPath = join(rexDir, "execution-log.jsonl");
    const rotatedPath = join(rexDir, "execution-log.1.jsonl");
    await writeFile(logPath, "x".repeat(MAX_LOG_BYTES + 10), "utf-8");

    const store = await resolveStore(rexDir);
    await handleAppendLog(store, { event: "mcp_rotate" });

    expect(existsSync(rotatedPath)).toBe(true);
    expect((await stat(rotatedPath)).size).toBeGreaterThanOrEqual(MAX_LOG_BYTES);

    const lines = await readLogLines(rexDir);
    expect(lines).toHaveLength(1);
    expect(lines[0].event).toBe("mcp_rotate");
  });

  it("rotates execution-log.jsonl to execution-log.1.jsonl past 1 MB via the CLI route", async () => {
    const { projectDir, rexDir } = await makeRexDir();
    const logPath = join(rexDir, "execution-log.jsonl");
    const rotatedPath = join(rexDir, "execution-log.1.jsonl");
    await writeFile(logPath, "y".repeat(MAX_LOG_BYTES + 10), "utf-8");

    await cmdLog(projectDir, "cli_rotate", {});

    expect(existsSync(rotatedPath)).toBe(true);
    expect((await stat(rotatedPath)).size).toBeGreaterThanOrEqual(MAX_LOG_BYTES);

    const lines = await readLogLines(rexDir);
    expect(lines).toHaveLength(1);
    expect(lines[0].event).toBe("cli_rotate");
  });

  /**
   * Rotation is a stat followed by a rename. Every `rex log` / `ndx log` call
   * is its own short-lived process, so two of them can both see an over-size
   * log: the first moves the history to `.1` and appends, then the second's
   * rename overwrites that `.1` with the single line the first just wrote,
   * and a megabyte of history is gone. The size is re-read under a lock to
   * stop it.
   */
  describe("concurrent appenders crossing the threshold", () => {
    /** A marker line that must survive rotation, written at the head of the history. */
    const HISTORY_MARKER = JSON.stringify({ event: "history_head", timestamp: "2026-01-01T00:00:00.000Z" });

    async function seedOverSizeLog(rexDir: string): Promise<void> {
      const filler = JSON.stringify({ event: "history_filler", detail: "z".repeat(200) });
      const lines = [HISTORY_MARKER];
      let bytes = HISTORY_MARKER.length + 1;
      while (bytes <= MAX_LOG_BYTES) {
        lines.push(filler);
        bytes += filler.length + 1;
      }
      await writeFile(join(rexDir, "execution-log.jsonl"), lines.join("\n") + "\n", "utf-8");
    }

    /** Every line of both the live log and the rotated backup. */
    async function allLines(rexDir: string): Promise<string[]> {
      const read = async (name: string): Promise<string[]> => {
        try {
          return (await readFile(join(rexDir, name), "utf-8")).split("\n").filter(Boolean);
        } catch {
          return [];
        }
      };
      return [...(await read("execution-log.1.jsonl")), ...(await read("execution-log.jsonl"))];
    }

    it("loses no history when two appends race in one process", async () => {
      const { rexDir } = await makeRexDir();
      await seedOverSizeLog(rexDir);
      const store = await resolveStore(rexDir);

      await Promise.all([
        handleAppendLog(store, { event: "racer_a" }),
        handleAppendLog(store, { event: "racer_b" }),
      ]);

      const lines = await allLines(rexDir);
      // The history survived: exactly one rotation happened, not two.
      expect(lines.filter((l) => l === HISTORY_MARKER)).toHaveLength(1);
      expect(lines.filter((l) => l.includes("history_filler")).length).toBeGreaterThan(100);
      // And both entries were written.
      expect(lines.filter((l) => l.includes("racer_a"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes("racer_b"))).toHaveLength(1);
    });

    it("loses no history when separate rex log processes race", async () => {
      const { projectDir, rexDir } = await makeRexDir();
      await seedOverSizeLog(rexDir);

      const cli = join(__dirname, "..", "..", "dist", "cli", "index.js");
      const events = ["proc_a", "proc_b", "proc_c", "proc_d"];
      await Promise.all(
        events.map(
          (event) =>
            new Promise<void>((done, fail) => {
              execFile(process.execPath, [cli, "log", event, projectDir], (err) =>
                err ? fail(err) : done(),
              );
            }),
        ),
      );

      const lines = await allLines(rexDir);
      expect(lines.filter((l) => l === HISTORY_MARKER)).toHaveLength(1);
      expect(lines.filter((l) => l.includes("history_filler")).length).toBeGreaterThan(100);
      for (const event of events) {
        expect(lines.filter((l) => l.includes(event)), event).toHaveLength(1);
      }
    });
  });
});
