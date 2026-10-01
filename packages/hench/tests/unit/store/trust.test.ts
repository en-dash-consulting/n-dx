import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyRepoTrust, formatTrustWarningForRun, trustSummaryForRun } from "../../../src/store/trust.js";
import { recordRepoTrust } from "../../../src/prd/llm-gateway.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";

let repo: string;
let home: string;

function writeHenchConfig(config: unknown): void {
  mkdirSync(join(repo, ".hench"), { recursive: true });
  writeFileSync(join(repo, ".hench", "config.json"), JSON.stringify(config));
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "hench-trust-repo-"));
  home = mkdtempSync(join(tmpdir(), "hench-trust-home-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("applyRepoTrust", () => {
  it("leaves a baseline repository alone", () => {
    const config = DEFAULT_HENCH_CONFIG();
    writeHenchConfig(config);
    const applied = applyRepoTrust(config, repo, "bypassPermissions", { ndxHome: home });
    expect(applied.evaluation.state).toBe("baseline");
    expect(applied.clamped).toBe(false);
    expect(applied.config).toBe(config);
    expect(applied.permissionMode).toBe("bypassPermissions");
  });

  it("clamps a widened guard and lowers bypassPermissions until the repository is trusted", () => {
    const widened = DEFAULT_HENCH_CONFIG();
    widened.guard = {
      ...widened.guard,
      allowedCommands: [...widened.guard.allowedCommands, "bash", "curl"],
      allowedGitSubcommands: [...widened.guard.allowedGitSubcommands, "push"],
      blockedPaths: ["node_modules/**"],
    };
    writeHenchConfig(widened);

    const restricted = applyRepoTrust(widened, repo, "bypassPermissions", { ndxHome: home });
    expect(restricted.evaluation.state).toBe("untrusted");
    expect(restricted.clamped).toBe(true);
    expect(restricted.permissionMode).toBe("acceptEdits");
    expect(restricted.config.guard.allowedCommands).not.toContain("bash");
    expect(restricted.config.guard.allowedGitSubcommands).not.toContain("push");
    expect(restricted.config.guard.blockedPaths).toContain(".hench/**");
    expect(restricted.config.guard.blockedPaths).toContain(".env");
    // Limits are not the trust question; they pass through.
    expect(restricted.config.guard.commandTimeout).toBe(widened.guard.commandTimeout);

    recordRepoTrust(repo, { ndxHome: home });
    const trusted = applyRepoTrust(widened, repo, "bypassPermissions", { ndxHome: home });
    expect(trusted.evaluation.state).toBe("trusted");
    expect(trusted.clamped).toBe(false);
    expect(trusted.config.guard.allowedCommands).toContain("bash");
    expect(trusted.permissionMode).toBe("bypassPermissions");
  });

  it("summarises for the run record and warns with the CLI-provider note", () => {
    const widened = DEFAULT_HENCH_CONFIG();
    widened.guard = { ...widened.guard, allowedCommands: ["bash"] };
    writeHenchConfig(widened);
    const applied = applyRepoTrust(widened, repo, undefined, { ndxHome: home });

    const summary = trustSummaryForRun(applied.evaluation);
    expect(summary.state).toBe("untrusted");
    expect(summary.restricted).toBe(true);
    expect(summary.digest).toBe(applied.evaluation.config.digest);
    expect(summary.findings.some((f) => f.includes("bash"))).toBe(true);

    const lines = formatTrustWarningForRun(applied.evaluation, "cli");
    expect(lines[0]).toContain("NOT TRUSTED");
    expect(lines.some((l) => l.includes("provider=cli"))).toBe(true);
    expect(formatTrustWarningForRun(applied.evaluation, "api").some((l) => l.includes("provider=cli"))).toBe(false);
  });
});
