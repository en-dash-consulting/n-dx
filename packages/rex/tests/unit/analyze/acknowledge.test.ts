import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeFindingHash,
  loadAcknowledged,
  saveAcknowledged,
  acknowledgeFinding,
  isAcknowledged,
} from "../../../src/analyze/acknowledge.js";

describe("computeFindingHash", () => {
  it("produces stable hashes for the same input", () => {
    const finding = { type: "anti-pattern", scope: "core", text: "God object detected" };
    const hash1 = computeFindingHash(finding);
    const hash2 = computeFindingHash(finding);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
  });

  it("normalizes numbers so count changes don't alter the hash", () => {
    const a = { type: "anti-pattern", scope: "core", text: "Hub function called from 17 files" };
    const b = { type: "anti-pattern", scope: "core", text: "Hub function called from 23 files" };
    expect(computeFindingHash(a)).toBe(computeFindingHash(b));
  });

  it("produces different hashes for different scopes", () => {
    const a = { type: "anti-pattern", scope: "core", text: "Bad pattern" };
    const b = { type: "anti-pattern", scope: "utils", text: "Bad pattern" };
    expect(computeFindingHash(a)).not.toBe(computeFindingHash(b));
  });

  it("produces different hashes for different types", () => {
    const a = { type: "anti-pattern", scope: "core", text: "Some issue" };
    const b = { type: "suggestion", scope: "core", text: "Some issue" };
    expect(computeFindingHash(a)).not.toBe(computeFindingHash(b));
  });

  it("is case-insensitive", () => {
    const a = { type: "anti-pattern", scope: "core", text: "Hardcoded Secret" };
    const b = { type: "anti-pattern", scope: "core", text: "hardcoded secret" };
    expect(computeFindingHash(a)).toBe(computeFindingHash(b));
  });
});

describe("acknowledgeFinding / isAcknowledged", () => {
  it("adds an entry and marks it acknowledged", () => {
    const store = { version: 1 as const, findings: [] };
    const updated = acknowledgeFinding(store, "abc123", "test finding", "deferred", "user");
    expect(updated.findings).toHaveLength(1);
    expect(updated.findings[0].hash).toBe("abc123");
    expect(updated.findings[0].reason).toBe("deferred");
    expect(isAcknowledged(updated, "abc123")).toBe(true);
  });

  it("deduplicates on hash (updates existing)", () => {
    let store = { version: 1 as const, findings: [] };
    store = acknowledgeFinding(store, "abc123", "text v1", "deferred", "user");
    store = acknowledgeFinding(store, "abc123", "text v2", "architectural", "user");
    expect(store.findings).toHaveLength(1);
    expect(store.findings[0].reason).toBe("architectural");
    expect(store.findings[0].text).toBe("text v2");
  });

  it("returns false for unknown hashes", () => {
    const store = { version: 1 as const, findings: [] };
    expect(isAcknowledged(store, "unknown")).toBe(false);
  });
});

describe("loadAcknowledged / saveAcknowledged", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-ack-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty store when file does not exist", async () => {
    const store = await loadAcknowledged(tempDir);
    expect(store.version).toBe(1);
    expect(store.findings).toEqual([]);
  });

  it("round-trips save → load", async () => {
    let store = { version: 1 as const, findings: [] };
    store = acknowledgeFinding(store, "hash1", "finding text", "deferred", "hench");
    await saveAcknowledged(tempDir, store);

    const loaded = await loadAcknowledged(tempDir);
    expect(loaded.findings).toHaveLength(1);
    expect(loaded.findings[0].hash).toBe("hash1");
    expect(loaded.findings[0].reason).toBe("deferred");
    expect(loaded.findings[0].acknowledgedBy).toBe("hench");
  });

  it("produces valid JSON on disk", async () => {
    const store = acknowledgeFinding(
      { version: 1, findings: [] },
      "abc", "text", "false_positive", "user",
    );
    await saveAcknowledged(tempDir, store);
    const raw = await readFile(join(tempDir, "acknowledged-findings.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.findings).toHaveLength(1);
  });
});
