/**
 * The reviewer's shell test command runs with a filtered environment.
 *
 * `runShellTestCommand` spawns the project's test command with `shell: true`.
 * It must never hand the child the raw parent environment: llm-client's
 * `repoCommandEnv` builds it, so the project's `hench.guard.env` policy applies
 * without a vendor CLI's authentication exceptions, and the repository's own
 * `allow` entries count only once the checkout is trusted.
 * When that policy cannot be loaded — which is also what sends
 * `runCrossVendorReview` to this fallback — malformed fields are ignored while valid denies apply
 * and the result says so. Assertions are made in the real child process.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  runShellTestCommand,
  runCrossVendorReview,
  formatReviewBanner,
} from "../../packages/core/pair-programming.js";

const { collectRepoExecutionConfig, recordRepoTrust } = await import("../../packages/llm-client/dist/public.js");
const CLI = fileURLToPath(new URL("../../packages/core/cli.js", import.meta.url));

const FIXTURE_ENV = {
  NDX_REVIEW_FIXTURE_SECRET: "fixture-secret",
  NDX_REVIEW_FIXTURE_ALLOWED_TOKEN: "fixture-allowed",
  ANTHROPIC_API_KEY: "fixture-anthropic",
  OPENAI_API_KEY: "fixture-openai",
};

let tmpDir;
let savedEnv;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ndx-pair-shell-env-"));
  savedEnv = Object.fromEntries(Object.keys(FIXTURE_ENV).map((name) => [name, process.env[name]]));
  Object.assign(process.env, FIXTURE_ENV);
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeProjectConfig(config) {
  writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify(config), "utf-8");
}

/** `.hench/config.json` denies `name`; `.n-dx.json` carries a guard with only blockedPaths. */
function writeHenchAndProjectGuards(name) {
  mkdirSync(join(tmpDir, ".hench"));
  writeFileSync(
    join(tmpDir, ".hench", "config.json"),
    JSON.stringify({ guard: { allowedCommands: ["npm", "node"], allowedGitSubcommands: ["status"], env: { deny: [name] } } }),
    "utf-8",
  );
  writeProjectConfig({ hench: { guard: { blockedPaths: [".git/**"] } } });
}

/** A test command that prints which fixture variables reached it. */
function probeCommand() {
  const probe = join(tmpDir, "probe.js");
  writeFileSync(
    probe,
    `const names = ${JSON.stringify(Object.keys(FIXTURE_ENV))};\n`
      + "console.log('PROBE ' + JSON.stringify(names.filter((n) => n in process.env)));\n",
    "utf-8",
  );
  return `"${process.execPath}" "${probe}"`;
}

function probedNames(output) {
  const line = output.split(/\r?\n/).find((l) => l.startsWith("PROBE "));
  expect(line, output).toBeDefined();
  return JSON.parse(line.slice("PROBE ".length));
}

/** Executable reviewer stub that answers `--version`, so the reviewer counts as available. */
function writeMockReviewer() {
  const jsPath = join(tmpDir, "mock-reviewer.js");
  writeFileSync(
    jsPath,
    "#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('mock 1.0.0'); process.exit(0); }\nprocess.exit(0);\n",
    "utf-8",
  );
  if (process.platform === "win32") {
    const cmdPath = join(tmpDir, "mock-reviewer.cmd");
    writeFileSync(cmdPath, `@"${process.execPath}" "${jsPath}" %*\r\n`, "utf-8");
    return cmdPath;
  }
  chmodSync(jsPath, 0o755);
  return jsPath;
}

describe("runShellTestCommand environment", () => {
  it("keeps a user deny when the repository allow field is malformed", async () => {
    const name = "NDX_REVIEW_FIXTURE_PLAIN";
    const previous = process.env[name];
    process.env[name] = "sentinel";
    try {
      writeProjectConfig({ hench: { guard: { env: { allow: 7 } } } });
      writeFileSync(join(tmpDir, ".n-dx.local.json"), JSON.stringify({ hench: { guard: { env: { deny: [name] } } } }));
      const probe = join(tmpDir, "denied.js");
      writeFileSync(probe, `console.log('PROBE ' + JSON.stringify('${name}' in process.env));`);
      const result = await runShellTestCommand(`"${process.execPath}" "${probe}"`, tmpDir, undefined, undefined, { ndxHome: join(tmpDir, "ndx-home") });
      expect(result.exitCode).toBe(0);
      expect(probedNames(result.output)).toBe(false);
      expect(result.envWarning).toContain("malformed");
      expect(result.envWarning).not.toContain("default environment filter");
    } finally {
      if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
    }
  });

  it("applies a trusted project's guard.env policy without vendor authentication exceptions", async () => {
    writeProjectConfig({ hench: { guard: { env: { allow: ["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"] } } } });
    const trust = { ndxHome: join(tmpDir, "ndx-home") };
    recordRepoTrust(tmpDir, trust);

    const result = await runShellTestCommand(probeCommand(), tmpDir, undefined, undefined, trust);

    expect(result.exitCode).toBe(0);
    expect(probedNames(result.output)).toEqual(["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"]);
    expect(result.envWarning).toBeUndefined();
  });

  it("drops a repository-supplied guard.env.allow while the checkout is untrusted (#686)", async () => {
    mkdirSync(join(tmpDir, ".hench"));
    writeFileSync(
      join(tmpDir, ".hench", "config.json"),
      JSON.stringify({ guard: { env: { allow: ["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"] } } }),
      "utf-8",
    );
    const trust = { ndxHome: join(tmpDir, "ndx-home") };

    const untrusted = await runShellTestCommand(probeCommand(), tmpDir, undefined, undefined, trust);
    expect(untrusted.exitCode).toBe(0);
    expect(probedNames(untrusted.output)).toEqual([]);

    recordRepoTrust(tmpDir, trust);
    const trusted = await runShellTestCommand(probeCommand(), tmpDir, undefined, undefined, trust);
    expect(probedNames(trusted.output)).toEqual(["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"]);
  });

  it("keeps the user's own .n-dx.local.json allow entry while the checkout is untrusted", async () => {
    writeFileSync(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ hench: { guard: { env: { allow: ["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"] } } } }),
      "utf-8",
    );

    const result = await runShellTestCommand(probeCommand(), tmpDir, undefined, undefined, { ndxHome: join(tmpDir, "ndx-home") });

    expect(probedNames(result.output)).toEqual(["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"]);
  });

  it("keeps .hench/config.json's guard.env.deny when .n-dx.json carries a guard section without env", async () => {
    // A plain name the default deny list does not cover, so only the user's deny strips it.
    const name = "NDX_REVIEW_FIXTURE_DB_URL";
    const saved = process.env[name];
    process.env[name] = "fixture-db";
    try {
      writeHenchAndProjectGuards(name);
      const probe = join(tmpDir, "deny-probe.js");
      writeFileSync(probe, `console.log('PROBE ' + JSON.stringify(${JSON.stringify(name)} in process.env));\n`, "utf-8");

      const result = await runShellTestCommand(`"${process.execPath}" "${probe}"`, tmpDir, undefined, undefined, { ndxHome: join(tmpDir, "ndx-home") });

      expect(result.exitCode).toBe(0);
      expect(probedNames(result.output)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  });

  it("collects the same merged guard that core's config loader resolves", () => {
    writeHenchAndProjectGuards("NDX_REVIEW_FIXTURE_DB_URL");
    const shown = spawnSync(process.execPath, [CLI, "config", "hench.guard", "--json", tmpDir], { encoding: "utf-8" });
    expect(shown.status, shown.stderr).toBe(0);
    const coreGuard = JSON.parse(shown.stdout.slice(shown.stdout.indexOf("{"), shown.stdout.lastIndexOf("}") + 1));

    const collected = collectRepoExecutionConfig(tmpDir);
    expect(collected.guard).toEqual({
      allowedCommands: coreGuard.allowedCommands,
      blockedPaths: coreGuard.blockedPaths,
      allowedGitSubcommands: coreGuard.allowedGitSubcommands ?? [],
    });
    expect(collected.envDeny).toEqual(coreGuard.env.deny);
  });

  it("ignores the malformed deny field, and says so, when the project policy is invalid", async () => {
    writeProjectConfig({ hench: { guard: { env: { deny: [42], allow: ["NDX_REVIEW_FIXTURE_ALLOWED_TOKEN"] } } } });

    const result = await runShellTestCommand(probeCommand(), tmpDir);

    expect(result.exitCode).toBe(0);
    expect(probedNames(result.output)).toEqual([]);
    expect(result.envWarning).toContain("guard.env policy could not be loaded");
  });
});

describe("runCrossVendorReview shell-test fallback environment", () => {
  it("runs the fallback under the sanitized filter when the project policy cannot be resolved", async () => {
    // deny: [42] fails the reviewer's env resolution (spawnError) and the shell test env alike.
    writeProjectConfig({ hench: { guard: { env: { deny: [42] } } } });
    // The user's own config: a repository's cli_path applies only once it is trusted.
    writeFileSync(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ llm: { claude: { cli_path: writeMockReviewer() } } }),
      "utf-8",
    );

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "claude", testCommand: probeCommand() });

    expect(result).toMatchObject({ mode: "shell-test-only", skipped: false, passed: true });
    expect(probedNames(result.output)).toEqual([]);
    expect(result.envWarning).toContain("guard.env policy could not be loaded");
    expect(formatReviewBanner("claude", result)).toContain("guard.env policy could not be loaded");
  });
});
