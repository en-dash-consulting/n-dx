/**
 * Every flag we hand `codex` must exist on the subcommand we hand it to.
 *
 * The codex arg surface has now drifted underneath this repo twice. Most
 * recently, codex-cli 0.147.0 removed `--full-auto` from `codex exec` while
 * `compileCodexPolicyFlags` kept emitting it for the autonomous default
 * (`workspace-write` + `never`), so every unattended codex spawn died on
 * argument parsing before reaching the model — silently, as far as the test
 * suite was concerned, because every test asserted our flags against our own
 * expectations rather than against the CLI.
 *
 * This test closes that loop: it scrapes `--help` from the *installed* codex
 * and asserts that each flag we emit is one that binary accepts. It fails when
 * codex changes, which is the whole point — a unit test on the compiler can
 * only catch us changing our minds.
 *
 * Skipped when codex is not installed (CI, most contributor machines). A
 * skipped drift check is honest; a passing one that checked nothing is not.
 *
 * @see packages/llm-client/src/codex-cli-provider.ts — compileCodexPolicyFlags
 * @see packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts
 */

import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import {
  compileCodexPolicyFlags,
  createPromptEnvelope,
  DEFAULT_EXECUTION_POLICY,
} from "../../src/prd/llm-gateway.js";
import type { ExecutionPolicy, PromptSection, PromptSectionName } from "../../src/prd/llm-gateway.js";

/** Is codex on PATH? */
function codexAvailable(): boolean {
  const probe = spawnSync("codex", ["--version"], { stdio: "ignore" });
  return probe.status === 0;
}

const HAS_CODEX = codexAvailable();

/** `codex <subcommand> --help`, or "" when it cannot be read. */
function helpText(subcommand: string[]): string {
  try {
    return execFileSync("codex", [...subcommand, "--help"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

/**
 * Flag tokens from an argv array — the things `--help` can be checked for.
 * Values are skipped: `-c approval_policy=never` is the `-c` flag plus a
 * config expression, and only `-c` appears in help.
 */
function flagsIn(args: readonly string[]): string[] {
  return args.filter((a) => a.startsWith("-") && a !== "-");
}

/**
 * Does this help text document `flag`? Matched at a word boundary so `-s`
 * does not match inside `--sandbox` or `--skip-git-repo-check`.
 */
function documents(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s,])${escaped}([\\s,=<\\[]|$)`, "m").test(help);
}

const envelope = createPromptEnvelope([
  { name: "system" as PromptSectionName, content: "sys" } as PromptSection,
  { name: "brief" as PromptSectionName, content: "task" } as PromptSection,
]);

const POLICIES: Array<[string, ExecutionPolicy]> = [
  ["default (workspace-write + never)", DEFAULT_EXECUTION_POLICY],
  ["read-only + on-request", { ...DEFAULT_EXECUTION_POLICY, sandbox: "read-only", approvals: "on-request" }],
  ["workspace-write + on-request", { ...DEFAULT_EXECUTION_POLICY, approvals: "on-request" }],
  ["danger-full-access + never", { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", approvals: "never" }],
  ["danger-full-access + on-request", { ...DEFAULT_EXECUTION_POLICY, sandbox: "danger-full-access", approvals: "on-request" }],
];

describe.skipIf(!HAS_CODEX)("codex flag surface (installed CLI)", () => {
  it("reports which codex it checked", () => {
    const version = execFileSync("codex", ["--version"], { encoding: "utf-8" }).trim();
    // Not an assertion about the version — a record of what the run verified.
    expect(version.length).toBeGreaterThan(0);
  });

  describe("codex exec accepts every flag a fresh spawn emits", () => {
    for (const [label, policy] of POLICIES) {
      it(label, () => {
        const help = helpText(["exec"]);
        expect(help.length).toBeGreaterThan(0);

        const config = codexCliAdapter.buildSpawnConfig(envelope, policy, {});
        expect(config.args[0]).toBe("exec");

        const unsupported = flagsIn(config.args).filter((f) => !documents(help, f));
        expect(
          unsupported,
          `codex exec does not accept: ${unsupported.join(", ")}. ` +
            `The installed CLI's arg surface has changed — update ` +
            `compileCodexPolicyFlags / codexCliAdapter to match it.`,
        ).toEqual([]);
      });
    }
  });

  it("codex exec resume accepts every flag a resumed spawn emits", () => {
    const help = helpText(["exec", "resume"]);
    expect(help.length).toBeGreaterThan(0);

    const config = codexCliAdapter.buildSpawnConfig(envelope, DEFAULT_EXECUTION_POLICY, {
      resumeSessionId: "01a05958-2931-73f1-9aba-38fa915bb8df",
      model: "gpt-5-codex",
    });

    const unsupported = flagsIn(config.args).filter((f) => !documents(help, f));
    expect(
      unsupported,
      `codex exec resume does not accept: ${unsupported.join(", ")}. ` +
        `Note resume has a narrower surface than exec — it takes neither ` +
        `-s/--sandbox nor --approve-for-me.`,
    ).toEqual([]);
  });

  it("the policy compiler alone emits nothing codex exec rejects", () => {
    const help = helpText(["exec"]);
    expect(help.length).toBeGreaterThan(0);

    for (const [label, policy] of POLICIES) {
      const unsupported = flagsIn(compileCodexPolicyFlags(policy)).filter(
        (f) => !documents(help, f),
      );
      expect(unsupported, `${label} emitted unsupported: ${unsupported.join(", ")}`).toEqual([]);
    }
  });

  it("--full-auto is gone from codex exec — the flag this test was written for", () => {
    // Pins the specific regression. If a future codex restores --full-auto
    // this fails, and the mapping can be reconsidered deliberately rather
    // than by accident.
    expect(documents(helpText(["exec"]), "--full-auto")).toBe(false);
  });
});

describe("codex flag surface (availability)", () => {
  it("states whether the drift check actually ran", () => {
    // Always-running marker so a fully skipped file is visible in output
    // rather than looking like the checks passed.
    expect(typeof HAS_CODEX).toBe("boolean");
  });
});
