/**
 * Tests for the warm-parent session cache.
 *
 * The cache holds one orientation session id per project so that task spawns
 * can fork it instead of re-paying cold-start context. Everything here is
 * best-effort by design: a miss costs one orientation spawn, but a *stale*
 * hit would fork a parent that no longer describes the repo — so the
 * invalidation paths are the part that matters.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSessionCache,
  writeSessionCache,
  clearSessionCache,
  isParentUsable,
  sourcevisionFingerprint,
  resolveSessionStrategy,
  DEFAULT_PARENT_MAX_AGE_HOURS,
} from "../../../src/agent/lifecycle/session-cache.js";

const PARENT = {
  parentId: "9af5cec8-c78d-4bd8-bfb6-4207314c9d8c",
  vendor: "claude",
  model: "claude-sonnet-5",
  svFingerprint: "fp-1",
};

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

describe("session cache — persistence", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-session-cache-"));
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  it("returns undefined when no cache file exists", async () => {
    expect(await readSessionCache(henchDir)).toBeUndefined();
  });

  it("round-trips a cache entry", async () => {
    await writeSessionCache(henchDir, PARENT);
    const cached = await readSessionCache(henchDir);

    expect(cached?.parentId).toBe(PARENT.parentId);
    expect(cached?.vendor).toBe("claude");
    expect(cached?.model).toBe("claude-sonnet-5");
    expect(cached?.svFingerprint).toBe("fp-1");
    expect(typeof cached?.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(cached!.createdAt))).toBe(false);
  });

  it("treats corrupt JSON as a miss rather than throwing", async () => {
    await writeFile(join(henchDir, "session-cache.json"), "{not json", "utf-8");
    expect(await readSessionCache(henchDir)).toBeUndefined();
  });

  it("treats a well-formed file missing parentId as a miss", async () => {
    await writeFile(
      join(henchDir, "session-cache.json"),
      JSON.stringify({ createdAt: new Date().toISOString() }),
      "utf-8",
    );
    expect(await readSessionCache(henchDir)).toBeUndefined();
  });

  it("creates the hench directory when it does not exist yet", async () => {
    const nested = join(henchDir, "does-not-exist-yet");
    await writeSessionCache(nested, PARENT);
    expect((await readSessionCache(nested))?.parentId).toBe(PARENT.parentId);
  });

  it("clearSessionCache removes the entry and is a no-op when absent", async () => {
    await writeSessionCache(henchDir, PARENT);
    await clearSessionCache(henchDir);
    expect(await readSessionCache(henchDir)).toBeUndefined();
    await expect(clearSessionCache(henchDir)).resolves.toBeUndefined();
  });

  it("writes valid JSON a human can inspect", async () => {
    await writeSessionCache(henchDir, PARENT);
    const raw = await readFile(join(henchDir, "session-cache.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe("session cache — parent usability", () => {
  const fresh = { ...PARENT, createdAt: new Date().toISOString() };

  it("accepts a recent parent whose fingerprint still matches", () => {
    const verdict = isParentUsable(fresh, { svFingerprint: "fp-1", vendor: "claude", model: "claude-sonnet-5" });
    expect(verdict.usable).toBe(true);
  });

  it("rejects when the sourcevision fingerprint changed", () => {
    const verdict = isParentUsable(fresh, { svFingerprint: "fp-2", vendor: "claude", model: "claude-sonnet-5" });
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toBe("sourcevision-changed");
  });

  it("rejects a parent older than the max age", () => {
    const old = { ...PARENT, createdAt: hoursAgo(DEFAULT_PARENT_MAX_AGE_HOURS + 1) };
    const verdict = isParentUsable(old, { svFingerprint: "fp-1", vendor: "claude", model: "claude-sonnet-5" });
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toBe("expired");
  });

  it("honors a custom max age", () => {
    const twoHoursOld = { ...PARENT, createdAt: hoursAgo(2) };
    expect(
      isParentUsable(twoHoursOld, {
        svFingerprint: "fp-1",
        vendor: "claude",
        model: "claude-sonnet-5",
        maxAgeHours: 1,
      }).usable,
    ).toBe(false);
    expect(
      isParentUsable(twoHoursOld, {
        svFingerprint: "fp-1",
        vendor: "claude",
        model: "claude-sonnet-5",
        maxAgeHours: 24,
      }).usable,
    ).toBe(true);
  });

  it("rejects when --fresh was requested", () => {
    const verdict = isParentUsable(fresh, {
      svFingerprint: "fp-1",
      vendor: "claude",
      model: "claude-sonnet-5",
      fresh: true,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toBe("fresh-requested");
  });

  it("rejects a parent created under a different vendor or model", () => {
    expect(
      isParentUsable(fresh, { svFingerprint: "fp-1", vendor: "codex", model: "claude-sonnet-5" }).reason,
    ).toBe("vendor-changed");
    expect(
      isParentUsable(fresh, { svFingerprint: "fp-1", vendor: "claude", model: "claude-opus-5" }).reason,
    ).toBe("model-changed");
  });

  it("rejects an entry with an unparseable createdAt instead of trusting it", () => {
    const bad = { ...PARENT, createdAt: "not-a-date" };
    expect(isParentUsable(bad, { svFingerprint: "fp-1", vendor: "claude", model: "claude-sonnet-5" }).usable).toBe(
      false,
    );
  });

  it("treats a missing cache entry as unusable", () => {
    expect(isParentUsable(undefined, { svFingerprint: "fp-1", vendor: "claude", model: "claude-sonnet-5" }).usable).toBe(
      false,
    );
  });
});

describe("sourcevisionFingerprint", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-sv-fingerprint-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeManifest(data: unknown): Promise<void> {
    await mkdir(join(projectDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(projectDir, ".sourcevision", "manifest.json"),
      JSON.stringify(data),
      "utf-8",
    );
  }

  it("is stable across reads when nothing changed", async () => {
    await writeManifest({ analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" });
    const a = await sourcevisionFingerprint(projectDir);
    const b = await sourcevisionFingerprint(projectDir);
    expect(a).toBe(b);
    expect(a).toBeTruthy();
  });

  it("changes when the analysis is re-run", async () => {
    await writeManifest({ analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" });
    const before = await sourcevisionFingerprint(projectDir);
    await writeManifest({ analyzedAt: "2026-08-28T09:00:00.000Z", gitSha: "abc123" });
    expect(await sourcevisionFingerprint(projectDir)).not.toBe(before);
  });

  it("changes when the analyzed commit changes", async () => {
    await writeManifest({ analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "abc123" });
    const before = await sourcevisionFingerprint(projectDir);
    await writeManifest({ analyzedAt: "2026-08-17T13:41:10.697Z", gitSha: "def456" });
    expect(await sourcevisionFingerprint(projectDir)).not.toBe(before);
  });

  it("returns a sentinel when no manifest exists, without throwing", async () => {
    const fp = await sourcevisionFingerprint(projectDir);
    expect(typeof fp).toBe("string");
    expect(fp).toBeTruthy();
  });
});

describe("resolveSessionStrategy", () => {
  it("defaults to fork for the Claude CLI provider", () => {
    expect(resolveSessionStrategy({ vendor: "claude", provider: "cli" })).toBe("fork");
  });

  it("falls back to cold for vendors with no resume equivalent", () => {
    for (const vendor of ["codex", "google", "local"]) {
      expect(resolveSessionStrategy({ vendor, provider: "cli", configured: "fork" })).toBe("cold");
    }
  });

  it("falls back to cold on the API provider, which owns its own conversation", () => {
    expect(resolveSessionStrategy({ vendor: "claude", provider: "api", configured: "fork" })).toBe("cold");
  });

  it("honors an explicitly configured strategy for the Claude CLI", () => {
    expect(resolveSessionStrategy({ vendor: "claude", provider: "cli", configured: "cold" })).toBe("cold");
    expect(resolveSessionStrategy({ vendor: "claude", provider: "cli", configured: "batch" })).toBe("batch");
  });

  it("ignores an unrecognized configured value rather than failing the run", () => {
    expect(resolveSessionStrategy({ vendor: "claude", provider: "cli", configured: "turbo" })).toBe("fork");
  });

  it("allows batch on non-Claude vendors — it needs no resume support", () => {
    expect(resolveSessionStrategy({ vendor: "codex", provider: "cli", configured: "batch" })).toBe("batch");
  });
});
