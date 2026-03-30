import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSourceVision } from "../../../src/analyze/scanners.js";
import {
  computeFindingHash,
  acknowledgeFinding,
  saveAcknowledged,
} from "../../../src/analyze/acknowledge.js";

describe("scanSourceVision with acknowledgment", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-scan-ack-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const ZONES_DATA = {
    zones: [
      {
        id: "core",
        name: "Core",
        description: "Core module",
        files: ["src/core.ts"],
        entryPoints: [],
        cohesion: 0.9,
        coupling: 0.1,
      },
    ],
    findings: [
      {
        type: "anti-pattern",
        pass: 1,
        scope: "core",
        text: "Hardcoded secret in config",
        severity: "critical",
      },
      {
        type: "suggestion",
        pass: 2,
        scope: "core",
        text: "Add input validation",
        severity: "warning",
      },
    ],
  };

  it("skips acknowledged findings", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(join(tempDir, ".sourcevision", "zones.json"), JSON.stringify(ZONES_DATA));

    // Acknowledge the first finding
    const hash = computeFindingHash({
      type: "anti-pattern",
      scope: "core",
      text: "Hardcoded secret in config",
    });
    const rexDir = join(tempDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    let store = { version: 1 as const, findings: [] };
    store = acknowledgeFinding(store, hash, "Hardcoded secret in config", "architectural", "user");
    await saveAcknowledged(rexDir, store);

    const { results } = await scanSourceVision(tempDir, { rexDir });
    const tasks = results.filter((r) => r.kind === "task");

    // Only the unacknowledged finding should produce a task
    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toContain("Add input validation");
  });

  it("embeds finding:{hash} tags on unacknowledged findings", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(join(tempDir, ".sourcevision", "zones.json"), JSON.stringify(ZONES_DATA));

    const { results } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");

    expect(tasks.length).toBe(2);
    for (const task of tasks) {
      const findingTag = task.tags?.find((t) => t.startsWith("finding:"));
      expect(findingTag).toBeDefined();
      expect(findingTag!.slice("finding:".length)).toHaveLength(12);
    }
  });

  it("works without .rex directory (graceful degradation)", async () => {
    await mkdir(join(tempDir, ".sourcevision"), { recursive: true });
    await writeFile(join(tempDir, ".sourcevision", "zones.json"), JSON.stringify(ZONES_DATA));

    // No .rex directory — should still produce all findings
    const { results } = await scanSourceVision(tempDir);
    const tasks = results.filter((r) => r.kind === "task");
    expect(tasks.length).toBe(2);
  });
});
