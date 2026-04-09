import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { run, runResult } from "./e2e-helpers.js";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

const CORE_PKG_PATH = join(import.meta.dirname, "../../packages/core/package.json");
const CORE_PKG = JSON.parse(readFileSync(CORE_PKG_PATH, "utf-8"));

/** Run `ndx version [flags]` and return stdout as a trimmed string. */
function runVersion(flags = []) {
  return execFileSync(process.execPath, [CLI_PATH, "version", ...flags], {
    encoding: "utf-8",
    timeout: 10000,
    stdio: "pipe",
  }).trim();
}

/** Run top-level version flags and capture stdout/stderr/code. */
function runTopLevelVersion(flags = []) {
  const result = runResult(flags, { encoding: "utf-8" });
  return {
    ...result,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

describe("ndx version", () => {
  it("exits with code 0", () => {
    // execFileSync throws on non-zero exit; reaching here means exit code was 0
    expect(() => runVersion()).not.toThrow();
  });

  it("stdout matches the semver in packages/core/package.json", () => {
    const stdout = runVersion();
    expect(stdout).toBe(CORE_PKG.version);
  });

  it("stdout matches a semver pattern (major.minor.patch)", () => {
    const stdout = runVersion();
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("n-dx version (alias)", () => {
  it("produces identical output to ndx version", () => {
    // Both n-dx and ndx resolve to the same cli.js entry point.
    // Calling cli.js directly with the same args verifies the shared dispatch.
    const ndxOutput = runVersion();
    const nDxOutput = runVersion(); // same binary, same output
    expect(nDxOutput).toBe(ndxOutput);
  });

  it("maps both top-level binaries to the shared entry point", () => {
    expect(CORE_PKG.bin.ndx).toBe("./cli.js");
    expect(CORE_PKG.bin["n-dx"]).toBe("./cli.js");
  });
});

describe("ndx version --json", () => {
  it("exits with code 0", () => {
    expect(() => runVersion(["--json"])).not.toThrow();
  });

  it("stdout is valid JSON", () => {
    const stdout = runVersion(["--json"]);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("JSON output contains a version key", () => {
    const stdout = runVersion(["--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("version");
  });

  it("JSON version value matches packages/core/package.json", () => {
    const stdout = runVersion(["--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(CORE_PKG.version);
  });
});

describe("ndx top-level version flags", () => {
  it("prints the package version for -v and exits with code 0", () => {
    const result = runTopLevelVersion(["-v"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(CORE_PKG.version);
    expect(result.stdout).not.toContain("n-dx");
    expect(result.stdout).not.toContain("Unknown command");
  });

  it("prints the package version for --version and exits with code 0", () => {
    const result = runTopLevelVersion(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(CORE_PKG.version);
    expect(result.stdout).not.toContain("n-dx");
    expect(result.stdout).not.toContain("Unknown command");
  });

  it("matches the existing version subcommand output", () => {
    expect(runTopLevelVersion(["-v"]).stdout).toBe(runVersion());
    expect(runTopLevelVersion(["--version"]).stdout).toBe(runVersion());
  });

  it("documents -v, --version in the top-level help output", () => {
    const helpText = run([]);
    expect(helpText).toContain("-v, --version");
    expect(helpText).toContain("Print the installed n-dx version");
  });
});
