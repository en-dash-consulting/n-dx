/**
 * A Sidecar session's vendor CLI is opened with the project's agent prompt
 * file as its system prompt, as every hench run gets it; with no file it gets
 * no system prompt at all. A hub session takes its host project's file.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidecarSessionConnect, type SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;

function record(scope: "worktree" | "hub" = "worktree"): SidecarSessionRecord {
  const at = new Date().toISOString();
  return {
    id: "sess-1", scope, worktree: root, name: "s", vendor: "claude", cursor: 0, turns: 0,
    tokens: { input: 0, output: 0 }, createdAt: at, lastActivityAt: at,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-agent-prompt-"));
  mkdirSync(join(root, ".ndx"), { recursive: true });
  vi.stubEnv("NDX_HOME", join(root, "home"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await removeTestDir(root);
});

describe("Sidecar agent prompt", () => {
  it("opens the session with no system prompt when the file is absent", async () => {
    const options = await sidecarSessionConnect(join(root, "sidecar"))(record());
    expect(options.systemPrompt).toBeUndefined();
  });

  it("opens the session with the file as its system prompt", async () => {
    writeFileSync(join(root, ".ndx", "agent-prompt.md"), "Answer tersely.\n");
    const options = await sidecarSessionConnect(join(root, "sidecar"))(record());
    expect(options.systemPrompt).toContain("## Project instructions from .ndx/agent-prompt.md");
    expect(options.systemPrompt).toContain("Answer tersely.");
  });

  it("takes a hub session's prompt from its host project", async () => {
    const host = mkdtempSync(join(tmpdir(), "sidecar-agent-prompt-host-"));
    try {
      mkdirSync(join(host, ".ndx"), { recursive: true });
      writeFileSync(join(host, ".ndx", "agent-prompt.md"), "Host rules.");
      const options = await sidecarSessionConnect(join(root, "hub"), undefined, host)(record("hub"));
      expect(options.systemPrompt).toContain("Host rules.");
    } finally {
      await removeTestDir(host);
    }
  });
});
