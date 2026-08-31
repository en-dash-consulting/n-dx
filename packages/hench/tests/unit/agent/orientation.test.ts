/**
 * Tests for the orientation pass — the one read-only session whose transcript
 * every task fork inherits.
 *
 * Two properties carry the whole mechanic and are asserted hardest here:
 * the orientation prompt must be *task-free* (a fork prefix that varies per
 * task earns no cache reads and leaks one task's framing into the next), and
 * orientation must never fail a run (a broken warm start is worth exactly one
 * wasted spawn, not a dead loop).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOrientationPrompt,
  buildOrientationSystemPrompt,
  ensureWarmParent,
} from "../../../src/agent/lifecycle/orientation.js";
import { writeSessionCache, readSessionCache } from "../../../src/agent/lifecycle/session-cache.js";

const POLICY = {
  sandbox: "workspace-write",
  approvals: "never",
  allowedCommands: ["git", "ls"],
} as never;

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    vendor: "claude",
    parseMode: "stream-json",
    buildSpawnConfig: vi.fn(() => ({ binary: "claude", args: [], env: {}, stdin: "" })),
    ...overrides,
  } as never;
}

describe("orientation prompts", () => {
  it("forbids modification in both the system and task prompt", () => {
    const system = buildOrientationSystemPrompt().toLowerCase();
    const prompt = buildOrientationPrompt().toLowerCase();

    expect(system).toMatch(/do not (modify|change|edit|write)/);
    expect(prompt).toMatch(/do not (modify|change|edit|write)/);
  });

  it("asks for the things a task would otherwise rediscover", () => {
    const prompt = buildOrientationPrompt().toLowerCase();

    expect(prompt).toContain("layout");
    expect(prompt).toMatch(/test/);
    expect(prompt).toMatch(/build/);
    expect(prompt).toMatch(/convention/);
  });

  it("is task-free, so every fork inherits a byte-identical prefix", () => {
    // Determinism is the whole cache-read mechanic: a prompt that varied per
    // task (or per clock tick) would give each fork a different prefix.
    expect(buildOrientationPrompt()).toBe(buildOrientationPrompt());
    expect(buildOrientationSystemPrompt()).toBe(buildOrientationSystemPrompt());

    const prompt = buildOrientationPrompt().toLowerCase();
    expect(prompt).not.toMatch(/\btask id\b|acceptance criteria/);
  });
});

describe("ensureWarmParent", () => {
  let henchDir: string;
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-orient-"));
    henchDir = join(projectDir, ".hench");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  function baseArgs(overrides: Record<string, unknown> = {}) {
    return {
      adapter: makeAdapter(),
      vendor: "claude",
      cliBinary: "claude",
      policy: POLICY,
      henchDir,
      projectDir,
      model: "claude-sonnet-5",
      ...overrides,
    } as never;
  }

  it("reuses a cached parent without spawning", async () => {
    const spawn = vi.fn();
    // Seed a cache entry whose fingerprint matches this project (no
    // .sourcevision here, so the fingerprint is the absent-manifest sentinel).
    const { sourcevisionFingerprint } = await import(
      "../../../src/agent/lifecycle/session-cache.js"
    );
    await writeSessionCache(henchDir, {
      parentId: "cached-parent",
      svFingerprint: await sourcevisionFingerprint(projectDir),
      vendor: "claude",
      model: "claude-sonnet-5",
    });

    const parentId = await ensureWarmParent(baseArgs({ spawn }));

    expect(parentId).toBe("cached-parent");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("orients once on a miss and caches the new parent", async () => {
    const spawn = vi.fn().mockResolvedValue({ sessionId: "new-parent" });

    const parentId = await ensureWarmParent(baseArgs({ spawn }));

    expect(parentId).toBe("new-parent");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect((await readSessionCache(henchDir))?.parentId).toBe("new-parent");
  });

  it("re-orients when --fresh is requested, replacing the cached parent", async () => {
    const { sourcevisionFingerprint } = await import(
      "../../../src/agent/lifecycle/session-cache.js"
    );
    await writeSessionCache(henchDir, {
      parentId: "stale-parent",
      svFingerprint: await sourcevisionFingerprint(projectDir),
      vendor: "claude",
      model: "claude-sonnet-5",
    });
    const spawn = vi.fn().mockResolvedValue({ sessionId: "fresh-parent" });

    const parentId = await ensureWarmParent(baseArgs({ spawn, fresh: true }));

    expect(parentId).toBe("fresh-parent");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect((await readSessionCache(henchDir))?.parentId).toBe("fresh-parent");
  });

  it("spawns the orientation read-only, with no session to resume", async () => {
    const buildSpawnConfig = vi.fn(() => ({ binary: "claude", args: [], env: {}, stdin: "" }));
    const spawn = vi.fn().mockResolvedValue({ sessionId: "p" });

    await ensureWarmParent(baseArgs({ adapter: makeAdapter({ buildSpawnConfig }), spawn }));

    const opts = buildSpawnConfig.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.permissionMode).toBe("plan");
    expect(opts.resumeSessionId).toBeUndefined();
    expect(opts.forkSession).toBeFalsy();
  });

  it("returns undefined when the orientation spawn reports no session id", async () => {
    const spawn = vi.fn().mockResolvedValue({ sessionId: undefined });

    expect(await ensureWarmParent(baseArgs({ spawn }))).toBeUndefined();
    expect(await readSessionCache(henchDir)).toBeUndefined();
  });

  it("returns undefined when the orientation spawn errors, without throwing", async () => {
    const spawn = vi.fn().mockResolvedValue({ sessionId: "p", error: "boom" });

    expect(await ensureWarmParent(baseArgs({ spawn }))).toBeUndefined();
    expect(await readSessionCache(henchDir)).toBeUndefined();
  });

  it("swallows a thrown spawn failure — a cold run beats a dead loop", async () => {
    const spawn = vi.fn().mockRejectedValue(new Error("CLI not found"));

    await expect(ensureWarmParent(baseArgs({ spawn }))).resolves.toBeUndefined();
  });

  it("writes the vendor and model it oriented under, so a switch invalidates", async () => {
    const spawn = vi.fn().mockResolvedValue({ sessionId: "p" });

    await ensureWarmParent(baseArgs({ spawn, model: "claude-opus-5" }));

    const cached = await readSessionCache(henchDir);
    expect(cached?.vendor).toBe("claude");
    expect(cached?.model).toBe("claude-opus-5");
  });

  it("records the sourcevision fingerprint so a re-analysis invalidates the parent", async () => {
    const { sourcevisionFingerprint } = await import(
      "../../../src/agent/lifecycle/session-cache.js"
    );
    const spawn = vi.fn().mockResolvedValue({ sessionId: "p" });

    await ensureWarmParent(baseArgs({ spawn }));

    expect((await readSessionCache(henchDir))?.svFingerprint).toBe(
      await sourcevisionFingerprint(projectDir),
    );
  });

  it("leaves a readable cache file behind", async () => {
    const spawn = vi.fn().mockResolvedValue({ sessionId: "p" });
    await ensureWarmParent(baseArgs({ spawn }));

    const raw = await readFile(join(henchDir, "session-cache.json"), "utf-8");
    expect(JSON.parse(raw).parentId).toBe("p");
  });
});
