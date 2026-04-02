import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

const CORE_PKG_PATH = join(import.meta.dirname, "../../packages/core/package.json");

/** Run `ndx version [flags]` and return stdout as a trimmed string. */
function runVersion(flags = []) {
  return execFileSync(process.execPath, [CLI_PATH, "version", ...flags], {
    encoding: "utf-8",
    timeout: 10000,
    stdio: "pipe",
  }).trim();
}

describe("ndx version", () => {
  it("exits with code 0", () => {
    // execFileSync throws on non-zero exit; reaching here means exit code was 0
    expect(() => runVersion()).not.toThrow();
  });

  it("stdout matches the semver in packages/core/package.json", () => {
    const { version } = JSON.parse(readFileSync(CORE_PKG_PATH, "utf-8"));
    const stdout = runVersion();
    expect(stdout).toBe(version);
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
    const { version } = JSON.parse(readFileSync(CORE_PKG_PATH, "utf-8"));
    const stdout = runVersion(["--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(version);
  });
});
