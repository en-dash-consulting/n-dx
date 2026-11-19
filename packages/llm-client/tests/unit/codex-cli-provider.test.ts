import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { writeFakeCli } from "../helpers/fake-cli.js";
import {
  mapSandboxToCodexFlag,
  mapApprovalToCodexFlag,
  compileCodexPolicyFlags,
  codexShellEnvFlags,
  CODEX_AGENT_HIDDEN_ENV,
  createCodexCliClient,
  createCodexScratch,
} from "../../src/codex-cli-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import { DEFAULT_EXECUTION_POLICY } from "../../src/runtime-contract.js";
import type { ExecutionPolicy, SandboxMode, ApprovalPolicy } from "../../src/runtime-contract.js";

/** Spelled out, not derived: the exact argv codex receives. */
const SHELL_ENV = [
  "-c", "shell_environment_policy.set.OPENAI_API_KEY=''",
  "-c", "shell_environment_policy.set.CODEX_API_KEY=''",
  "-c", "shell_environment_policy.set.CODEX_ACCESS_TOKEN=''",
];

const WORKSPACE = ["--strict-config", "-c", 'sandbox_workspace_write={network_access=false,writable_roots=[],exclude_tmpdir_env_var=true,exclude_slash_tmp=true}'];

describe("Codex provider scratch lifecycle", () => {
  it("disposes only its own directory and does not reclaim a reused path", async () => {
    const scratch = createCodexScratch();
    const other = createCodexScratch();
    try {
      await writeFile(join(other.dir, "keep"), "owned by another spawn");
      await symlink(other.dir, join(scratch.dir, "link"), process.platform === "win32" ? "junction" : "dir");
      scratch.dispose();
      expect(await readFile(join(other.dir, "keep"), "utf-8")).toBe("owned by another spawn");
      await mkdir(scratch.dir);
      await writeFile(join(scratch.dir, "keep"), "reused path");
      scratch.dispose();
      expect(await readFile(join(scratch.dir, "keep"), "utf-8")).toBe("reused path");
    } finally {
      scratch.dispose();
      other.dispose();
      await rm(scratch.dir, { recursive: true, force: true });
    }
  });

  it.each([0, 1])("supplies normal temp APIs a private bounded directory and cleans exit %s", async exitCode => {
    const dir = await mkdtemp(join(tmpdir(), "codex-scratch-test-"));
    try {
      const capture = join(dir, "capture.json");
      const binary = writeFakeCli(dir, { name: "scratch-cli", script: `
        import fs from 'node:fs';
        import os from 'node:os';
        import path from 'node:path';
        const args = process.argv.slice(2);
        if (!args.includes('-o')) process.exit(0);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-api-'));
        fs.writeFileSync(path.join(temporary, 'file'), 'ok');
        fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, tmp: os.tmpdir(),
          temp: process.env.TEMP, tmpEnv: process.env.TMP, mode: fs.statSync(os.tmpdir()).mode & 0o777 }));
        fs.writeFileSync(args[args.indexOf('-o') + 1], 'done');
        process.exit(${exitCode});
      ` });
      const client = createCodexCliClient({ codexConfig: { cli_path: binary }, maxRetries: 0 });
      const result = client.complete({ prompt: "test" });
      if (exitCode) await expect(result).rejects.toThrow();
      else await result;
      const observed = JSON.parse(await readFile(capture, "utf-8"));
      expect(observed.tmp).not.toBe(tmpdir());
      expect(observed.temp).toBe(observed.tmp);
      expect(observed.tmpEnv).toBe(observed.tmp);
      if (process.platform !== "win32") expect(observed.mode).toBe(0o700);
      expect(observed.args).toContain(`sandbox_workspace_write={network_access=false,writable_roots=[${JSON.stringify(observed.tmp)}],exclude_tmpdir_env_var=true,exclude_slash_tmp=true}`);
      expect(observed.args).toContain(`shell_environment_policy.set.TMPDIR=${JSON.stringify(observed.tmp)}`);
      const output = observed.args[observed.args.indexOf("-o") + 1];
      const relativeOutput = relative(observed.tmp, output);
      expect(isAbsolute(relativeOutput) || relativeOutput.startsWith(`..${sep}`)).toBe(true);
      expect(existsSync(output)).toBe(false);
      expect(existsSync(observed.tmp)).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

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

  describe("codexShellEnvFlags", () => {
    it("blanks each Codex credential in the agent's commands with a dotted set override", () => {
      expect(codexShellEnvFlags()).toEqual(SHELL_ENV);
    });

    it("covers the key resolveVendorCliEnv writes and the tokens codex accepts", () => {
      const names = codexShellEnvFlags()
        .filter((arg) => arg !== "-c")
        .map((arg) => /^shell_environment_policy\.set\.([A-Z_]+)=''$/.exec(arg)?.[1]);
      expect(names).toEqual([...CODEX_AGENT_HIDDEN_ENV]);
      expect(names).toContain("OPENAI_API_KEY");
    });

    it("blanks extra names after the credentials, once each", () => {
      expect(codexShellEnvFlags(["NDX_X", "OPENAI_API_KEY", "NDX_X"])).toEqual([
        ...SHELL_ENV, "-c", "shell_environment_policy.set.NDX_X=''",
      ]);
    });

    it("refuses an extra name that is not a bare key", () => {
      expect(() => codexShellEnvFlags(["A.B"])).toThrow(/not an environment variable name/);
      expect(() => codexShellEnvFlags(["A=''"])).toThrow(/not an environment variable name/);
    });
  });

  describe("compileCodexPolicyFlags", () => {
    it("refuses limits that the selected sandbox cannot express on fresh and continuation turns", () => {
      for (const resume of [false, true]) {
        for (const approvals of ["never", "on-request"] as const) {
          const policy = { ...DEFAULT_EXECUTION_POLICY, approvals };
          expect(() => compileCodexPolicyFlags({ ...policy, sandbox: "danger-full-access", writableRoots: [] }, { resume }))
            .toThrow(/networkAccess=false/);
          expect(() => compileCodexPolicyFlags({ ...policy, sandbox: "danger-full-access", networkAccess: true }, { resume }))
            .toThrow(/writableRoots/);
          expect(() => compileCodexPolicyFlags({ ...policy, sandbox: "read-only", networkAccess: true }, { resume }))
            .toThrow(/networkAccess=true/);
        }
      }
    });

    it("requires strict config validation for every sandbox and continuation", () => {
      for (const sandbox of ["read-only", "workspace-write", "danger-full-access"] as const) {
        for (const approvals of ["never", "on-request"] as const) {
          for (const resume of [false, true]) {
            const policy = { ...DEFAULT_EXECUTION_POLICY, sandbox, approvals, networkAccess: sandbox === "danger-full-access", writableRoots: sandbox === "danger-full-access" ? [] : ["."] };
            expect(compileCodexPolicyFlags(policy, { resume }).filter(flag => flag === "--strict-config"))
              .toEqual(["--strict-config"]);
          }
        }
      }
    });

    it("replaces ambient network and writable-root grants on fresh and resumed turns", () => {
      const policy = { ...DEFAULT_EXECUTION_POLICY, writableRoots: [".", "build output"] };
      for (const resume of [false, true]) {
        expect(compileCodexPolicyFlags(policy, { resume })).toContain(
          'sandbox_workspace_write={network_access=false,writable_roots=["build output"],exclude_tmpdir_env_var=true,exclude_slash_tmp=true}',
        );
        expect(compileCodexPolicyFlags({ ...policy, networkAccess: true }, { resume })).toContain(
          'sandbox_workspace_write={network_access=true,writable_roots=["build output"],exclude_tmpdir_env_var=true,exclude_slash_tmp=true}',
        );
      }
    });

    it("refuses to pretend workspace-write can restrict writes to a subdirectory", () => {
      for (const writableRoots of [[], ["src"]]) {
        expect(() => compileCodexPolicyFlags({ ...DEFAULT_EXECUTION_POLICY, writableRoots }))
          .toThrow(/workspace-write.*project root/);
      }
    });

    it("accepts equivalent relative spellings of the project root on every turn", () => {
      for (const root of ["./", "././", process.platform === "win32" ? ".\\" : ".//"]) {
        for (const resume of [false, true]) {
          expect(compileCodexPolicyFlags({ ...DEFAULT_EXECUTION_POLICY, writableRoots: [root] }, { resume }))
            .toEqual(compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY, { resume }));
        }
      }
    });

    it("states sandbox and approvals explicitly for the default unattended policy", () => {
      const flags = compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY);
      expect(flags).toEqual(["--sandbox", "workspace-write", "-c", "approval_policy=never", ...WORKSPACE, ...SHELL_ENV]);
    });

    it("ends every policy with the shell-environment overrides", () => {
      for (const sandbox of ["read-only", "workspace-write", "danger-full-access"] as SandboxMode[]) {
        for (const approvals of ["on-request", "never"] as ApprovalPolicy[]) {
          const flags = compileCodexPolicyFlags({ ...DEFAULT_EXECUTION_POLICY, sandbox, approvals, networkAccess: sandbox === "danger-full-access", writableRoots: sandbox === "danger-full-access" ? [] : ["."] });
          expect(flags.slice(-SHELL_ENV.length)).toEqual(SHELL_ENV);
        }
      }
    });

    it("re-applies the policy on resume with -c overrides and no --sandbox", () => {
      // codex exec resume rejects --sandbox, and a resumed thread does not keep
      // its starting policy, so both halves travel as config overrides.
      expect(compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY, { resume: true })).toEqual([
        "-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"', ...WORKSPACE, ...SHELL_ENV,
      ]);
      expect(compileCodexPolicyFlags({ ...DEFAULT_EXECUTION_POLICY, sandbox: "read-only" }, { resume: true })).toEqual([
        "-c", 'sandbox_mode="read-only"', "-c", 'approval_policy="never"', "--strict-config", ...SHELL_ENV,
      ]);
    });

    it("uses the same two overrides for danger-full-access + never on resume, never the bypass flag", () => {
      const flags = compileCodexPolicyFlags(
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", networkAccess: true, writableRoots: [], approvals: "never" },
        { resume: true },
      );
      expect(flags).toEqual(["-c", 'sandbox_mode="danger-full-access"', "-c", 'approval_policy="never"', "--strict-config", ...SHELL_ENV]);
      expect(flags).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(flags).not.toContain("--sandbox");
    });

    it("never emits --full-auto, which codex exec no longer accepts", () => {
      const policies: ExecutionPolicy[] = [
        DEFAULT_EXECUTION_POLICY,
        { ...DEFAULT_EXECUTION_POLICY, approvals: "on-request" },
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "read-only", approvals: "on-request" },
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", networkAccess: true, writableRoots: [], approvals: "never" },
        { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", networkAccess: true, writableRoots: [], approvals: "on-request" },
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
      expect(flags).toEqual(["--sandbox", "read-only", "-c", "approval_policy=on-request", "--strict-config", ...SHELL_ENV]);
    });

    it("compiles workspace-write + on-request policy to a plain sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--sandbox", "workspace-write", "-c", "approval_policy=on-request", ...WORKSPACE, ...SHELL_ENV]);
    });

    it("compiles danger-full-access + never policy", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        networkAccess: true,
        writableRoots: [],
        approvals: "never",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual(["--dangerously-bypass-approvals-and-sandbox", "--strict-config", ...SHELL_ENV]);
    });

    it("compiles danger-full-access + on-request to an explicit sandbox flag", () => {
      const policy: ExecutionPolicy = {
        ...DEFAULT_EXECUTION_POLICY,
        sandbox: "danger-full-access",
        networkAccess: true,
        writableRoots: [],
        approvals: "on-request",
      };
      const flags = compileCodexPolicyFlags(policy);
      expect(flags).toEqual([
        "--sandbox",
        "danger-full-access",
        "-c",
        "approval_policy=on-request",
        "--strict-config", ...SHELL_ENV,
      ]);
    });

    it("keeps the one preset that is still on the exec surface", () => {
      // danger-full-access + never is the only combination that stays a
      // single flag: it is the only way to express "no sandbox at all".
      expect(
        compileCodexPolicyFlags({
          ...DEFAULT_EXECUTION_POLICY,
          sandbox: "danger-full-access",
        networkAccess: true,
        writableRoots: [],
          approvals: "never",
        }),
      ).toEqual(["--dangerously-bypass-approvals-and-sandbox", "--strict-config", ...SHELL_ENV]);

      // Everything else is the explicit sandbox + approval_policy pair.
      expect(compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY)).toHaveLength(4 + WORKSPACE.length + SHELL_ENV.length);
      expect(
        compileCodexPolicyFlags({
          ...DEFAULT_EXECUTION_POLICY,
          approvals: "on-request",
        }),
      ).toHaveLength(4 + WORKSPACE.length + SHELL_ENV.length);
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
  it.each(["read-only", "workspace-write", "danger-full-access"] as const)(
    "does not retry without strict config when an older CLI rejects it in %s mode", async (sandbox) => {
      const dir = await mkdtemp(join(tmpdir(), "ndx-policy-version-"));
      try {
        const binary = writeFakeCli(dir, {
          name: "unsupported-codex",
          script: `
            for await (const chunk of process.stdin) { void chunk; }
            if (process.argv.includes('--strict-config')) {
              process.stderr.write('error: unexpected argument --strict-config');
              process.exit(2);
            }
            process.stdout.write('UNSAFE FALLBACK');
          `,
        });
        const retries: number[] = [];
        const client = createCodexCliClient({
          codexConfig: { cli_path: binary },
          policy: { ...DEFAULT_EXECUTION_POLICY, sandbox,
            networkAccess: sandbox === "danger-full-access",
            writableRoots: sandbox === "danger-full-access" ? [] : ["."] },
          maxRetries: 2,
          onRetry: () => { retries.push(1); },
        });
        await expect(client.complete({ prompt: "test", model: "test-model" }))
          .rejects.toThrow(/strict-config/);
        expect(retries).toEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

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
