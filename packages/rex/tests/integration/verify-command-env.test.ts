import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify } from "../../src/core/verify.js";
import type { PRDItem } from "../../src/schema/index.js";

/**
 * #686 finding 3: `verify_criteria`'s test command is the repository's own,
 * so it runs with the sanitized environment rather than the parent's. The
 * probe reports only whether a sentinel credential is visible (its exit
 * code); the value is never printed.
 */

const SENTINEL = "NDX_SENTINEL_TOKEN";
const PROBE = `node -e "process.exit(process.env.${SENTINEL} === undefined ? 0 : 3)"`;

let projectDir: string;
let ndxHome: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "rex-verify-env-"));
  ndxHome = mkdtempSync(join(tmpdir(), "rex-verify-env-home-"));
  mkdirSync(join(projectDir, "tests"));
  writeFileSync(join(projectDir, "tests", "login.test.ts"), "// test\n");
  saved = { [SENTINEL]: process.env[SENTINEL], NDX_HOME: process.env.NDX_HOME };
  process.env[SENTINEL] = "sentinel";
  process.env.NDX_HOME = ndxHome;
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(ndxHome, { recursive: true, force: true });
});

describe("verify_criteria test command environment", () => {
  const items: PRDItem[] = [
    { id: "t1", title: "Login", level: "task", status: "pending", acceptanceCriteria: ["login works"] },
  ];

  it("does not show the parent's credentials to the test command", async () => {
    const result = await verify({ projectDir, items, testCommand: PROBE, runTests: true, timeout: 20_000 });
    expect(result.testRun?.passed).toBe(true);
  });

  it("a probe exit of 3 is reported as a failure (control: the pass above is not vacuous)", async () => {
    const result = await verify({
      projectDir,
      items,
      testCommand: `node -e "process.exit(3)"`,
      runTests: true,
      timeout: 20_000,
    });
    expect(result.testRun?.passed).toBe(false);
  });
});
