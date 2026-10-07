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
});
