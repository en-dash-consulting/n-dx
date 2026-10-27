import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyRepoTrust, formatTrustWarningForRun, trustSummaryForRun } from "../../../src/store/trust.js";
import { guardBaselineForLanguage, recordRepoTrust } from "../../../src/prd/llm-gateway.js";
import { GuardError, validatePath } from "../../../src/guard/paths.js";
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

  it("drops a claudePath the repository ships until it is trusted", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), claudePath: "./tools/claude" };
    writeHenchConfig(config);

    const restricted = applyRepoTrust(config, repo, undefined, { ndxHome: home });
    expect(restricted.evaluation.state).toBe("untrusted");
    expect(restricted.config.claudePath).toBeUndefined();
    expect(restricted.clamped).toBe(true);

    recordRepoTrust(repo, { ndxHome: home });
    expect(applyRepoTrust(config, repo, undefined, { ndxHome: home }).config.claudePath).toBe("./tools/claude");
  });

  it("keeps the user's .n-dx.local.json claudePath while the repository is untrusted", () => {
    writeHenchConfig({ ...DEFAULT_HENCH_CONFIG(), claudePath: "./tools/claude" });
    writeFileSync(join(repo, ".n-dx.local.json"), JSON.stringify({ hench: { claudePath: "/opt/claude" } }));
    // As loadConfig merges it: the local overlay wins.
    const config = { ...DEFAULT_HENCH_CONFIG(), claudePath: "/opt/claude" };

    const restricted = applyRepoTrust(config, repo, undefined, { ndxHome: home });
    expect(restricted.evaluation.state).toBe("untrusted");
    expect(restricted.config.claudePath).toBe("/opt/claude");
  });

  it("drops the repository's guard.env.allow until trusted, keeping local allow entries and every deny", () => {
    const shipped = DEFAULT_HENCH_CONFIG();
    shipped.guard = { ...shipped.guard, env: { allow: ["AWS_*"], deny: ["REPO_DENY"] } };
    writeHenchConfig(shipped);
    writeFileSync(join(repo, ".n-dx.local.json"), JSON.stringify({ hench: { guard: { env: { allow: ["MY_TEST_*"], deny: ["LOCAL_DENY"] } } } }));
    // As loadConfig merges it: the local overlay replaces the arrays.
    const config = DEFAULT_HENCH_CONFIG();
    config.guard = { ...config.guard, env: { allow: ["AWS_*", "MY_TEST_*"], deny: ["REPO_DENY", "LOCAL_DENY"] } };

    const restricted = applyRepoTrust(config, repo, undefined, { ndxHome: home });
    expect(restricted.evaluation.state).toBe("untrusted");
    expect(restricted.clamped).toBe(true);
    expect(restricted.config.guard.env).toEqual({ allow: ["MY_TEST_*"], deny: ["REPO_DENY", "LOCAL_DENY"] });
    const warning = formatTrustWarningForRun(restricted.evaluation, "api").join("\n");
    expect(warning).toContain("guard.env.allow is ignored");
    expect(warning).toContain(".n-dx.local.json");

    recordRepoTrust(repo, { ndxHome: home });
    expect(applyRepoTrust(config, repo, undefined, { ndxHome: home }).config.guard.env?.allow).toEqual(["AWS_*", "MY_TEST_*"]);
  });

  it("clamps to the detected baseline, not the language the repository declares", () => {
    writeFileSync(join(repo, "package.json"), "{}");
    const declaredSwift = DEFAULT_HENCH_CONFIG("swift");
    expect(declaredSwift.language).toBe("swift");
    expect(declaredSwift.guard.allowedCommands).toEqual(expect.arrayContaining(["xcodebuild", "xcrun"]));
    writeHenchConfig(declaredSwift);

    const applied = applyRepoTrust(declaredSwift, repo, undefined, { ndxHome: home });
    expect(applied.evaluation.state).toBe("untrusted");
    expect(applied.evaluation.findings.map((f) => f.code)).toContain("language-mismatch");
    expect(applied.clamped).toBe(true);
    expect(applied.config.guard.allowedCommands).not.toContain("xcodebuild");
    expect(applied.config.guard.allowedCommands).not.toContain("xcrun");
  });

  it("keeps a swift checkout's own toolchain while it is restricted", () => {
    writeFileSync(join(repo, "Package.swift"), "");
    const swift = DEFAULT_HENCH_CONFIG("swift");
    swift.guard = { ...swift.guard, allowedCommands: [...swift.guard.allowedCommands, "bash"] };
    writeHenchConfig(swift);

    const applied = applyRepoTrust(swift, repo, undefined, { ndxHome: home });
    expect(applied.evaluation.state).toBe("untrusted");
    expect(applied.evaluation.findings.map((f) => f.code)).not.toContain("language-mismatch");
    expect(applied.config.guard.allowedCommands).toEqual(expect.arrayContaining(["xcodebuild", "xcrun"]));
    expect(applied.config.guard.allowedCommands).not.toContain("bash");
  });

  // A marker file is repository content: a zero-byte Package.swift in a JS
  // checkout must not drop node_modules/** from the clamp (#816 F1).
  it("keeps node_modules blocked when a JS checkout ships a swift marker", () => {
    writeFileSync(join(repo, "package.json"), "{}");
    writeFileSync(join(repo, "Package.swift"), "");
    const config = DEFAULT_HENCH_CONFIG();
    config.guard = {
      ...config.guard,
      allowedCommands: [...config.guard.allowedCommands, "bash"],
      blockedPaths: config.guard.blockedPaths.filter((p) => p !== "**/node_modules/**"),
    };
    writeHenchConfig(config);

    const applied = applyRepoTrust(config, repo, undefined, { ndxHome: home });
    expect(applied.evaluation.config.detectedLanguage).toBe("swift");
    expect(applied.evaluation.state).toBe("untrusted");
    expect(applied.config.guard.blockedPaths).toContain("**/node_modules/**");
  });

  // A root go.mod picks the go baseline; the JS frontend's node_modules sits
  // in web/, and a payload written there runs at the next install (#686).
  it("refuses a write to a nested node_modules in an untrusted polyglot checkout", () => {
    writeFileSync(join(repo, "go.mod"), "module x\n");
    mkdirSync(join(repo, "web"));
    writeFileSync(join(repo, "web", "package.json"), "{}");
    const config = DEFAULT_HENCH_CONFIG("go");
    config.guard = { ...config.guard, allowedCommands: [...config.guard.allowedCommands, "bash"], blockedPaths: [".hench/**", ".rex/**", ".git/**"] };
    writeHenchConfig(config);

    const applied = applyRepoTrust(config, repo, undefined, { ndxHome: home });
    expect(applied.evaluation.state).toBe("untrusted");
    expect(() => validatePath("web/node_modules/.bin/vite", repo, applied.config.guard.blockedPaths)).toThrow(GuardError);
    expect(() => validatePath("web/src/main.ts", repo, applied.config.guard.blockedPaths)).not.toThrow();
  });

  // A guard `ndx init` wrote before the blocks reached any depth reads as
  // baseline, so it is never clamped; a repository can ship one to keep
  // packages/*/node_modules writable. The root entry is widened to any depth,
  // which tightens without changing the trust state; what the guard dropped
  // stays dropped.
  it("keeps a nested node_modules blocked under a baseline guard that lists only the root one", () => {
    writeFileSync(join(repo, "package.json"), "{}");
    const config = DEFAULT_HENCH_CONFIG();
    config.guard = { ...config.guard, blockedPaths: [".hench/**", ".rex/**", ".git/**", "node_modules/**"] };
    writeHenchConfig(config);

    const applied = applyRepoTrust(config, repo, "bypassPermissions", { ndxHome: home });
    expect(applied.evaluation.state).toBe("baseline");
    expect(applied.permissionMode).toBe("bypassPermissions");
    expect(applied.config.guard.allowedCommands).toEqual(config.guard.allowedCommands);
    expect(() => validatePath("packages/a/node_modules/x/package.json", repo, applied.config.guard.blockedPaths)).toThrow(GuardError);
    expect(applied.config.guard.blockedPaths).not.toContain(".env");
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

describe("guard baseline dependency directories", () => {
  it.each(["typescript", "javascript", "go", "swift", undefined])("blocks root and nested dependency directories for %s", (language) => {
    const { blockedPaths } = guardBaselineForLanguage(language);
    for (const p of [
      "node_modules/x/index.js",
      "web/node_modules/.bin/x",
      "packages/a/node_modules/x/package.json",
      "vendor/a.go",
      "svc/vendor/a.go",
      "ios/Pods/x",
      "app/.build/debug/x",
      "app/DerivedData/x",
      "app/Carthage/x",
    ]) {
      expect(() => validatePath(p, repo, blockedPaths), `${language}: ${p}`).toThrow(GuardError);
    }
    expect(() => validatePath("packages/a/src/index.ts", repo, blockedPaths)).not.toThrow();
  });
});
