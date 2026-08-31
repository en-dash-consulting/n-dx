import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFakeCli } from "../helpers/fake-cli.js";
import {
  mapSandboxToCodexFlag,
  mapApprovalToCodexFlag,
  compileCodexPolicyFlags,
  createCodexCliClient,
} from "../../src/codex-cli-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import { DEFAULT_EXECUTION_POLICY } from "../../src/runtime-contract.js";
import type { ExecutionPolicy, SandboxMode, ApprovalPolicy } from "../../src/runtime-contract.js";

describe("Codex policy flag compilation", () => {
  describe("mapSandboxToCodexFlag", () => {
    it("maps read-only to read-only", () => {
      expect(mapSandboxToCodexFlag("read-only")).toBe("read-only");
    });

    it("maps workspace-write to workspace-write", () => {
      expect(mapSandboxToCodexFlag("workspace-write")).toBe("workspace-write");
    });

    it("maps danger-full-access to danger-full-access", () => {
      expect(mapSandboxToCodexFlag("danger-full-access")).toBe("danger-full-access");
    });

    it("covers all SandboxMode values", () => {
      const modes: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
      for (const mode of modes) {
        expect(typeof mapSandboxToCodexFlag(mode)).toBe("string");
      }
    });
  });

  describe("mapApprovalToCodexFlag", () => {
    // These used to expect "default" and "full-auto" — the names of `codex
    // exec` flags, not `approval_policy` config values. Both are gone from
    // the exec surface; `--full-auto` in particular was killing every
    // unattended spawn on argument parsing.
    it("maps on-request to the on-request approval policy", () => {
      expect(mapApprovalToCodexFlag("on-request")).toBe("on-request");
    });

    it("maps never to the never approval policy", () => {
      expect(mapApprovalToCodexFlag("never")).toBe("never");
    });

    it("only returns values codex accepts for approval_policy", () => {
      // Read off codex-cli 0.147.0's own rejection of a bogus value:
      //   unknown variant `x`, expected one of `untrusted`, `on-failure`,
      //   `on-request`, `granular`, `never`
      const accepted = ["untrusted", "on-failure", "on-request", "granular", "never"];
      for (const policy of ["on-request", "never"] as ApprovalPolicy[]) {
        expect(accepted).toContain(mapApprovalToCodexFlag(policy));
      }
    });

    it("covers all ApprovalPolicy values", () => {
      const policies: ApprovalPolicy[] = ["on-request", "never"];
      for (const policy of policies) {
        expect(typeof mapApprovalToCodexFlag(policy)).toBe("string");
      }
    });
  });

  describe("compileCodexPolicyFlags", () => {
    it("states sandbox and approvals explicitly for the default unattended policy", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      expect(flags).toEqual(["--sandbox", "workspace-write", "-c", "approval_policy=never"]);
    });

    it("never emits --full-auto, which codex exec no longer accepts", () => {
      const policies: ExecutionPolicy[] = [
        DEFAULT_EXECUTION_POLICY,
        { ...DEFAULT_EXECUTION_POLICY, approvals: "on-request" },
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "read-only", approvals: "on-request" },
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", approvals: "never" },
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", approvals: "on-request" },
      ];
      for (const policy of policies) {
        expect(compileCodexPolicyFlags(policy)).not.toContain("--full-auto");
      }
    });

    it("compiles read-only + on-request policy to a plain sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "read-only",
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--sandbox", "read-only", "-c", "approval_policy=on-request"]);
    });

    it("compiles workspace-write + on-request policy to a plain sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--sandbox", "workspace-write", "-c", "approval_policy=on-request"]);
    });

    it("compiles danger-full-access + never policy", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        approvals: "never",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    });

    it("compiles danger-full-access + on-request to an explicit sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual([
        "--sandbox",
        "danger-full-access",
        "-c",
        "approval_policy=on-request",
      ]);
    });

    it("keeps the one preset that is still on the exec surface", () => {
      // danger-full-access + never is the only combination that stays a
      // single flag: it is the only way to express "no sandbox at all".
      expect(
        compileCodexPolicyFlags({
          ...DEFAULT_EXECUTION_POLICY,
          sandbox: "danger-full-access",
          approvals: "never",
        }),
      ).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);

      // Everything else is the explicit sandbox + approval_policy pair.
      expect(compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY)).toHaveLength(4);
      expect(
        compileCodexPolicyFlags({
          ...DEFAULT_EXECUTION_POLICY,
          approvals: "on-request",
        }),
      ).toHaveLength(4);
    });
  });
});

// ── Rate limit retry behavior ────────────────────────────────────────────────

/**
 * Create a temporary fake `codex` that writes `stderr` to stderr and exits with
 * `exitCode`. The binary ignores all arguments so it can act as a stand-in for
 * any `codex exec ...` invocation.
 *
 * Delegates to the shared helper so the fake is launchable on Windows too — a
 * bare `#!/usr/bin/env node` script is not (see tests/helpers/fake-cli.ts).
 */
async function makeMockBinary(
  tmpDir: string,
  { stderr, exitCode }: { stderr: string; exitCode: number },
): Promise<string> {
  return writeFakeCli(tmpDir, { name: "mock-codex", stderr, exitCode });
}

describe("createCodexCliClient — rate limit retry", () => {
  it("calls onRetry with correct arguments when rate limited", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-test-"));
    try {
      const scriptPath = await makeMockBinary(tmpDir, {
        stderr: "error: 429 too many requests\n",
        exitCode: 1,
      });

      const retryEvents: Array<{ attempt: number; maxAttempts: number; delayMs: number }> = [];
      const client = createCodexCliClient({
        codexConfig: { cli_path: scriptPath },
        maxRetries: 1,
        baseDelayMs: 1,
        onRetry: (attempt, maxAttempts, delayMs) => {
          retryEvents.push({ attempt, maxAttempts, delayMs });
        },
      });

      await expect(client.complete({ prompt: "test", model: "test-model" })).rejects.toThrow();

      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0].attempt).toBe(2);    // 2nd attempt (first retry)
      expect(retryEvents[0].maxAttempts).toBe(2); // 2 total attempts (maxRetries=1)
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws an actionable ClaudeClientError after rate limit exhaustion", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-test-"));
    try {
      const scriptPath = await makeMockBinary(tmpDir, {
        stderr: "error: 429 too many requests\n",
        exitCode: 1,
      });

      const client = createCodexCliClient({
        codexConfig: { cli_path: scriptPath },
        maxRetries: 1,
        baseDelayMs: 1,
        onRetry: () => { /* suppress default stderr message */ },
      });

      try {
        await client.complete({ prompt: "test", model: "test-model" });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ClaudeClientError);
        const clientErr = err as ClaudeClientError;
        expect(clientErr.reason).toBe("rate-limit");
        expect(clientErr.retryable).toBe(false);
        expect(clientErr.message).toContain("Wait a few minutes");
        expect(clientErr.message).toContain("attempts failed");
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not call onRetry for non-retryable auth errors", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-test-"));
    try {
      const scriptPath = await makeMockBinary(tmpDir, {
        stderr: "error: unauthorized — invalid api key\n",
        exitCode: 1,
      });

      const retryEvents: number[] = [];
      const client = createCodexCliClient({
        codexConfig: { cli_path: scriptPath },
        maxRetries: 2,
        baseDelayMs: 1,
        onRetry: () => { retryEvents.push(1); },
      });

      await expect(client.complete({ prompt: "test", model: "test-model" })).rejects.toThrow(ClaudeClientError);
      expect(retryEvents).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not call onRetry for non-rate-limit transient errors", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "ndx-test-"));
    try {
      const scriptPath = await makeMockBinary(tmpDir, {
        stderr: "ECONNRESET\n",
        exitCode: 1,
      });

      const retryEvents: number[] = [];
      const client = createCodexCliClient({
        codexConfig: { cli_path: scriptPath },
        maxRetries: 1,
        baseDelayMs: 1,
        onRetry: () => { retryEvents.push(1); },
      });

      await expect(client.complete({ prompt: "test", model: "test-model" })).rejects.toThrow();
      expect(retryEvents).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
