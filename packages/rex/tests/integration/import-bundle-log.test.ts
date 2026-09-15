/**
 * An import leaves a trace in the execution log.
 *
 * CLAUDE.md documents `.rex/execution-log.jsonl` as the append-only record of
 * PRD activity, and sixteen command modules write to it — every other write
 * path, including add, update, move, remove, prune, reshape, reorganize, fix,
 * smart-add and sync. `import-bundle` wrote nothing, so after an import nobody
 * could answer where the items came from, who ran it, or whether it was a merge
 * or a replace: the dashboard's activity view showed a PRD that had changed
 * size with no cause. It matters most on `--replace`, the one command that can
 * discard the whole tree.
 *
 * The entry has to be earned, not unconditional — a rejected bundle or a
 * declined replace changed nothing and must say nothing. These tests pin both
 * halves.
 *
 * The log is read as the raw file rather than through `store.readLog()`, since
 * the claim is that the entry lands in the documented location.
 *
 * @see packages/rex/src/cli/commands/import-bundle.ts
 * @see packages/rex/src/store/contracts.ts — appendLog, which stamps the actor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdImportBundle } from "../../src/cli/commands/import-bundle.js";
import { resolveStore } from "../../src/store/index.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import type { LogEntry, PRDItem } from "../../src/schema/index.js";

const { promptAnswers } = vi.hoisted(() => ({ promptAnswers: [] as string[] }));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (answer: string) => void) => {
      cb(promptAnswers.shift() ?? "n");
    },
    close: () => {},
  }),
}));

function epic(id: string, title: string): PRDItem {
  return { id, title, level: "epic", status: "pending", priority: "medium", acceptanceCriteria: [] };
}

describe("rex import-bundle execution log", () => {
  let projectDir: string;
  let bundlePath: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    promptAnswers.length = 0;
    projectDir = await mkdtemp(join(tmpdir(), "rex-bundle-log-"));
    await cmdInit(projectDir, {});

    const store = await resolveStore(join(projectDir, REX_DIR));
    await store.withTransaction(async (doc) => {
      doc.items = [epic("local-1", "Local Epic")];
    });

    bundlePath = join(projectDir, "bundle.json");
    await writeBundle({});

    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeBundle(overrides: Record<string, unknown>): Promise<void> {
    await writeFile(
      bundlePath,
      JSON.stringify({
        bundle: "rex/prd-bundle",
        bundleVersion: 1,
        schema: SCHEMA_VERSION,
        title: "Bundle PRD",
        exportedAt: "2026-01-01T00:00:00.000Z",
        items: [epic("bundle-1", "Bundle Epic")],
        ...overrides,
      }),
      "utf-8",
    );
  }

  /** Every entry currently in the log file. */
  async function logEntries(): Promise<LogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(join(projectDir, REX_DIR, "execution-log.jsonl"), "utf-8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as LogEntry);
  }

  async function importEntries(): Promise<LogEntry[]> {
    return (await logEntries()).filter((e) => e.event === "bundle_imported");
  }

  it("records a merge with its counts and the bundle's provenance", async () => {
    await cmdImportBundle(projectDir, { in: bundlePath });

    const entries = await importEntries();
    expect(entries).toHaveLength(1);

    const entry = entries[0];
    expect(entry.mode).toBe("merge");
    expect(entry.added).toBe(1);
    expect(entry.replaced).toBe(0);
    expect(entry.bundleExportedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.timestamp as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // appendLog stamps the actor, which is the "who ran it" half of the record.
    expect(entry.actor).toBeTruthy();
  });

  it("records a replace, including how many items it discarded", async () => {
    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true", yes: "true" });

    const entries = await importEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].mode).toBe("replace");
    expect(entries[0].added).toBe(1);
    // The local tree that was discarded — the number the log exists to preserve.
    expect(entries[0].replaced).toBe(1);
  });

  it("carries exportedFrom provenance when the bundle has it", async () => {
    await writeBundle({ exportedFrom: { branch: "feat/x", commit: "abc1234" } });

    await cmdImportBundle(projectDir, { in: bundlePath });

    expect((await importEntries())[0].exportedFrom).toEqual({
      branch: "feat/x",
      commit: "abc1234",
    });
  });

  it("names the merge's collisions, so a no-op import is distinguishable", async () => {
    // Importing the same bundle twice: the second changes nothing, and the log
    // has to say so rather than reading like a second successful import.
    await cmdImportBundle(projectDir, { in: bundlePath });
    await cmdImportBundle(projectDir, { in: bundlePath });

    const entries = await importEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1].added).toBe(0);
    expect(entries[1].collisions).toBe(1);
  });

  it("appends nothing when the bundle is rejected", async () => {
    await writeFile(bundlePath, "{ not json", "utf-8");

    await expect(cmdImportBundle(projectDir, { in: bundlePath })).rejects.toThrow();

    expect(await importEntries()).toEqual([]);
  });

  it("appends nothing when a replace is declined at the prompt", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    promptAnswers.push("n");

    await expect(
      cmdImportBundle(projectDir, { in: bundlePath, replace: "true" }),
    ).rejects.toThrow(/Replace declined/);

    expect(await importEntries()).toEqual([]);
  });
});
