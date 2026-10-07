import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleVerifyCriteria } from "../../../src/cli/mcp-tools/index.js";
import type { PRDStore } from "../../../src/store/contracts.js";

let repo: string;
let home: string;
let savedHome: string | undefined;

/** A store double: one task with a criterion, and a test command from the repository. */
function fakeStore(testCommand: string): PRDStore {
  return {
    loadDocument: async () => ({
      items: [{
        id: "t1", title: "Task", level: "task", status: "pending", priority: "medium",
        acceptanceCriteria: ["does the thing"], children: [],
      }],
    }),
    loadConfig: async () => ({ test: testCommand }),
  } as unknown as PRDStore;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rex-verify-trust-"));
  home = mkdtempSync(join(tmpdir(), "rex-verify-home-"));
  savedHome = process.env.NDX_HOME;
  process.env.NDX_HOME = home;
  mkdirSync(join(repo, ".rex"), { recursive: true });
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.NDX_HOME;
  else process.env.NDX_HOME = savedHome;
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("verify_criteria and repository trust", () => {
  // A test command that leaves a footprint if it ever runs.
  const marker = () => join(repo, "RAN");
  const command = () => `node -e "require('fs').writeFileSync(${JSON.stringify(marker())}, 'x')"`;

  it("does not run the repository's test command by default", async () => {
    writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: command() }));
    const res = await handleVerifyCriteria(fakeStore(command()), repo, {});
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.testRun).toBeUndefined();
    expect(body.tasks).toHaveLength(1);
    expect(existsSync(marker())).toBe(false);
  });

  it("refuses to run it even when asked while the repository's execution config is untrusted", async () => {
    // A chaining test command is a warning-level finding, so the repository deviates.
    const risky = `${command()}; echo`;
    writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: risky }));
    const res = await handleVerifyCriteria(fakeStore(risky), repo, { runTests: true });
    const body = JSON.parse(res.content[0].text);
    expect(body.testRun).toBeUndefined();
    expect(body.testsSkipped).toContain("not trusted");
    expect(body.trust.state).toBe("untrusted");
    expect(existsSync(marker())).toBe(false);
  });
});
