/**
 * Retry-via-resume.
 *
 * A cold retry has to be told that files from the previous attempt are already
 * on disk — hence the retry notice, and its instruction to check the current
 * state before redoing work. A resumed retry *was* the previous attempt, so
 * that notice restates what the model just did and grows the prompt on every
 * retry. These tests pin that the notice and the resume are mutually
 * exclusive, and that resuming never turns into forking.
 */

import { describe, it, expect } from "vitest";
import {
  shouldSendRetryNotice,
  resolveRetryResume,
  buildRetryNotice,
} from "../../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";

const POLICY = { sandbox: "workspace-write", approvals: "never", allowedCommands: ["git"] } as never;
const ENVELOPE = {
  sections: [
    { name: "system", content: "SYS" },
    { name: "brief", content: "TASK" },
  ],
} as never;

describe("shouldSendRetryNotice", () => {
  it("sends nothing on the first attempt", () => {
    expect(shouldSendRetryNotice(0, undefined)).toBe(false);
    expect(shouldSendRetryNotice(0, "sess-1")).toBe(false);
  });

  it("sends the notice on a cold retry", () => {
    expect(shouldSendRetryNotice(1, undefined)).toBe(true);
    expect(shouldSendRetryNotice(3, undefined)).toBe(true);
  });

  it("suppresses the notice when the retry resumes the failed session", () => {
    expect(shouldSendRetryNotice(1, "sess-1")).toBe(false);
    expect(shouldSendRetryNotice(3, "sess-1")).toBe(false);
  });

  it("the notice it suppresses is the one that costs prompt growth", () => {
    // Guards the rationale: if the notice ever stopped telling the model to
    // re-inspect prior work, suppressing it would no longer be a saving.
    const notice = buildRetryNotice(1, 3, 12);
    expect(notice).toMatch(/still exist/i);
    expect(notice).toMatch(/check the current state/i);
  });
});

describe("resolveRetryResume", () => {
  it("resumes on the Claude CLI when a session was reported", () => {
    expect(resolveRetryResume("claude", "sess-1")).toBe("sess-1");
  });

  it("stays cold when no session was reported", () => {
    expect(resolveRetryResume("claude", undefined)).toBeUndefined();
  });

  it("stays cold on vendors with no resume on this path", () => {
    for (const vendor of ["codex", "google", "local"]) {
      expect(resolveRetryResume(vendor, "sess-1"), vendor).toBeUndefined();
    }
  });
});

describe("retry spawn shape", () => {
  it("continues the failed session rather than forking it", () => {
    // Forking would branch off the failure and leave the retry without the
    // very transcript it is meant to continue.
    const config = claudeCliAdapter.buildSpawnConfig(ENVELOPE, POLICY, {
      permissionMode: "acceptEdits",
      resumeSessionId: "failed-sess",
      forkSession: undefined,
    });

    expect(config.args[config.args.indexOf("--resume") + 1]).toBe("failed-sess");
    expect(config.args).not.toContain("--fork-session");
  });

  it("a cold retry passes no session at all", () => {
    const config = claudeCliAdapter.buildSpawnConfig(ENVELOPE, POLICY, {
      permissionMode: "acceptEdits",
      resumeSessionId: undefined,
    });

    expect(config.args).not.toContain("--resume");
    expect(config.args).not.toContain("--fork-session");
  });
});
