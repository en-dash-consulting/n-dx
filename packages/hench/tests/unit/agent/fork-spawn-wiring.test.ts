/**
 * Wiring-level checks for warm-parent forking.
 *
 * The behavior that matters here is not "does the flag get set" but the two
 * decisions around it: a task spawn must *fork* the parent rather than
 * continue it (continuing would consume the session the next task needs),
 * and a parent the vendor CLI has forgotten must degrade to a cold spawn
 * instead of failing every task in the loop.
 */

import { describe, it, expect } from "vitest";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { resolveSessionStrategy } from "../../../src/agent/lifecycle/session-cache.js";

const POLICY = {
  sandbox: "workspace-write",
  approvals: "never",
  allowedCommands: ["git"],
} as never;

const ENVELOPE = {
  sections: [
    { name: "system", content: "SYS" },
    { name: "brief", content: "TASK" },
  ],
} as never;

describe("task spawns fork the warm parent", () => {
  it("forks rather than continues, so the parent survives for the next task", () => {
    const config = claudeCliAdapter.buildSpawnConfig(ENVELOPE, POLICY, {
      model: "claude-sonnet-5",
      permissionMode: "acceptEdits",
      resumeSessionId: "parent-1",
      forkSession: true,
    });

    expect(config.args).toContain("--fork-session");
    expect(config.args[config.args.indexOf("--resume") + 1]).toBe("parent-1");
  });

  it("spawns cold when no parent was established", () => {
    const config = claudeCliAdapter.buildSpawnConfig(ENVELOPE, POLICY, {
      model: "claude-sonnet-5",
      permissionMode: "acceptEdits",
      resumeSessionId: undefined,
      forkSession: undefined,
    });

    expect(config.args).not.toContain("--resume");
    expect(config.args).not.toContain("--fork-session");
  });

  it("keeps the task's own permission mode — forking must not relax or restrict it", () => {
    // Orientation runs in plan mode; the tasks forked from it still need to
    // be able to edit, so the fork must not inherit the parent's posture.
    const config = claudeCliAdapter.buildSpawnConfig(ENVELOPE, POLICY, {
      permissionMode: "acceptEdits",
      resumeSessionId: "parent-1",
      forkSession: true,
    });

    expect(config.args[config.args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  });
});

describe("strategy gating for the run path", () => {
  it("enables forking only for the Claude CLI provider", () => {
    expect(resolveSessionStrategy({ vendor: "claude", provider: "cli" })).toBe("fork");
    expect(resolveSessionStrategy({ vendor: "codex", provider: "cli" })).toBe("cold");
    expect(resolveSessionStrategy({ vendor: "claude", provider: "api" })).toBe("cold");
  });

  it("lets a project opt out without touching code", () => {
    expect(
      resolveSessionStrategy({ vendor: "claude", provider: "cli", configured: "cold" }),
    ).toBe("cold");
  });
});
