/**
 * The session-cache decision as it reaches a reader.
 *
 * Covers the three acceptance criteria of "record the session strategy, hit or
 * miss reason and token-data provenance on every run":
 *
 * 1. Every run record reports a strategy and a decision reason.
 * 2. Cache token data reads as measured / estimated / unavailable, never as a
 *    zero standing in for an unknown.
 * 3. Run records written before any of this still load.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { saveRun, loadRun } from "../../../src/store/runs.js";
import { formatSessionDecision } from "../../../src/cli/session-report.js";
import { formatTokenReport } from "../../../src/cli/token-logging.js";
import { cacheEntryAgeMs } from "../../../src/agent/lifecycle/session-cache.js";
import type { RunRecord, RunSessionRecord } from "../../../src/schema/index.js";

const FIXTURE = fileURLToPath(
  new URL("../../fixtures/run-record-pre-session-decision.json", import.meta.url),
);

describe("session decision", () => {
  describe("formatSessionDecision", () => {
    const decision = (over: Partial<RunSessionRecord> = {}): RunSessionRecord => ({
      strategy: "fork",
      outcome: "hit",
      reason: "cached",
      ...over,
    });

    it("names the strategy, the outcome and the reason in prose", () => {
      expect(formatSessionDecision(decision())).toBe(
        "Session: fork hit — reused the cached orientation",
      );
    });

    it("includes the session age when one was measured", () => {
      expect(formatSessionDecision(decision({ ageMs: 3_720_000 }))).toContain("(age 1h 2m)");
      expect(formatSessionDecision(decision({ ageMs: 900_000 }))).toContain("(age 15m)");
      expect(formatSessionDecision(decision({ ageMs: 7_200_000 }))).toContain("(age 2h)");
      expect(formatSessionDecision(decision({ ageMs: 5_000 }))).toContain("(age under a minute)");
    });

    it("says nothing about age when there was nothing cached to measure", () => {
      // Not "age 0" — an absent entry has no age, and printing one would be a
      // claim about a session that never existed.
      expect(formatSessionDecision(decision({ outcome: "miss", reason: "no-entry" })))
        .toBe("Session: fork miss — nothing was cached");
    });

    it("prints an unrecognised reason verbatim rather than swallowing it", () => {
      // The reason field is deliberately a bare string so a record naming a
      // code this build has never heard of still loads; the display has to
      // hold the same line.
      expect(formatSessionDecision(decision({ outcome: "miss", reason: "ref-rewritten" })))
        .toBe("Session: fork miss — ref-rewritten");
    });

    it("distinguishes a configured cold run from a degraded one", () => {
      expect(
        formatSessionDecision({ strategy: "cold", outcome: "miss", reason: "configured-cold" }),
      ).toContain("cold spawns are configured");
      expect(
        formatSessionDecision({ strategy: "cold", outcome: "miss", reason: "fork-unsupported" }),
      ).toContain("cannot resume a session by id");
    });
  });

  describe("cacheEntryAgeMs", () => {
    it("measures from the stamp", () => {
      expect(cacheEntryAgeMs("2026-07-14T09:00:00.000Z", Date.parse("2026-07-14T10:30:00.000Z")))
        .toBe(5_400_000);
    });

    it("returns undefined — not zero — for a stamp it cannot read", () => {
      expect(cacheEntryAgeMs("not a date")).toBeUndefined();
    });

    it("never reports a negative age for a stamp from the future", () => {
      expect(cacheEntryAgeMs("2026-07-14T10:00:00.000Z", Date.parse("2026-07-14T09:00:00.000Z")))
        .toBe(0);
    });
  });

  describe("token-data provenance in the CLI report", () => {
    it("says so when the vendor reported no cache accounting", () => {
      const report = formatTokenReport({ input: 1_500, output: 300 }, "unavailable");

      expect(report).toContain("unavailable");
      expect(report).toContain("no cache accounting");
    });

    it("stays exactly as it was when the caller knows no provenance", () => {
      expect(formatTokenReport({ input: 1_500, output: 300 })).toBe(
        formatTokenReport({ input: 1_500, output: 300 }, "measured"),
      );
    });

    it("marks an estimated cache figure as estimated", () => {
      const report = formatTokenReport(
        { input: 534, output: 120, cacheReadInput: 34_100 },
        "estimated",
      );

      expect(report).toContain("(estimated)");
    });
  });

  describe("records written before this change (acceptance criterion 3)", () => {
    let tmpBase: string;
    let henchDir: string;

    beforeEach(async () => {
      tmpBase = await mkdtemp(join(tmpdir(), "hench-session-decision-"));
      henchDir = join(tmpBase, ".hench");
      await mkdir(join(henchDir, "runs"), { recursive: true });
    });

    afterEach(async () => {
      await rm(tmpBase, { recursive: true, force: true });
    });

    async function seedLegacyRun(): Promise<RunRecord> {
      const raw = await readFile(FIXTURE, "utf-8");
      const record = JSON.parse(raw) as RunRecord;
      await writeFile(join(henchDir, "runs", `${record.id}.json`), raw, "utf-8");
      return record;
    }

    it("loads with every field it had, and no session decision invented", async () => {
      const seeded = await seedLegacyRun();

      const loaded = await loadRun(henchDir, seeded.id);

      expect(loaded.session).toBeUndefined();
      expect(loaded.tokens?.cachedProvenance).toBeUndefined();
      expect(loaded.turnTokenUsage?.[0].cacheProvenance).toBeUndefined();
      // Nothing else was dropped on the way through the schema.
      expect(loaded.tokens).toEqual({ input: 534, output: 2104, cached: 34976, total: 37614 });
      expect(loaded.parentSessionId).toBe(seeded.parentSessionId);
      expect(loaded.diagnostics?.parseMode).toBe("stream-json");
    });

    it("reads as unknown rather than as a measurement once re-saved", async () => {
      const seeded = await seedLegacyRun();
      const loaded = await loadRun(henchDir, seeded.id);

      // Re-saving re-derives the tuple. The record's turns predate the
      // provenance field, so the run does not get to claim its cache figure
      // was measured just because a newer build wrote the file.
      await saveRun(henchDir, loaded);

      expect(loaded.tokens?.cachedProvenance).toBe("unavailable");
      expect(loaded.tokens?.cached).toBe(34_976);
    });
  });
});
