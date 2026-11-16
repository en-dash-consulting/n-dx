import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codexSessionDriver, DEFAULT_EXECUTION_POLICY } from "../../../src/prd/llm-gateway.js";
import { realGitOriginProbe } from "../../../src/process/git-origin.js";
import { codexReuseIdentity, sameCodexSessionIdentity, type CodexReuseInput } from "../../../src/agent/lifecycle/codex-session-reuse.js";

describe("Codex work-session identity", () => {
  const input: CodexReuseInput = { binary: "selected-codex", cwd: "/project", env: {},
    model: "pinned", permissionMode: "acceptEdits", policy: DEFAULT_EXECUTION_POLICY };
  beforeEach(() => {
    vi.spyOn(codexSessionDriver, "probeResume").mockReturnValue({ supported: true,
      reusable: true, identity: "account/config", version: "0.167", reason: "fixture" });
    vi.spyOn(realGitOriginProbe, "worktreeRoot").mockReturnValue("/project");
    vi.spyOn(realGitOriginProbe, "branch").mockReturnValue("work");
    vi.spyOn(realGitOriginProbe, "head").mockReturnValue("commit");
  });
  afterEach(() => vi.restoreAllMocks());
  it("permits own commits but rejects a branch or worktree switch", () => {
    const before = codexReuseIdentity(input);
    vi.mocked(realGitOriginProbe.head).mockReturnValue("own-commit");
    expect(codexReuseIdentity(input)).toBe(before);
    vi.mocked(realGitOriginProbe.branch).mockReturnValue("other");
    expect(codexReuseIdentity(input)).not.toBe(before);
    vi.mocked(realGitOriginProbe.branch).mockReturnValue("work");
    vi.mocked(realGitOriginProbe.worktreeRoot).mockReturnValue("/other");
    expect(codexReuseIdentity(input)).not.toBe(before);
  });
  it("invalidates model, environment, binary and execution-policy changes", () => {
    const before = codexReuseIdentity(input);
    for (const change of [
      { model: "other" }, { env: { CODEX_API_KEY: "fixture-only" } }, { binary: "other" },
      { permissionMode: "plan" },
      { policy: { ...input.policy, sandbox: "read-only" as const } },
      { policy: { ...input.policy, writableRoots: ["/other"] } },
    ]) expect(codexReuseIdentity({ ...input, ...change })).not.toBe(before);
  });
  it("requires observable capability, account and checkout identity", () => {
    expect(sameCodexSessionIdentity(undefined, undefined)).toBe(false);
    vi.mocked(codexSessionDriver.probeResume!).mockReturnValue({ supported: false, reason: "unavailable" });
    expect(codexReuseIdentity(input)).toBeUndefined();
    vi.mocked(codexSessionDriver.probeResume!).mockReturnValue({ supported: true, reusable: false, reason: "opaque" });
    expect(codexReuseIdentity(input)).toBeUndefined();
  });
});
