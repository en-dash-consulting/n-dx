import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleVerifyCriteria } from "../../../src/cli/mcp-tools/index.js";
import type { PRDStore } from "../../../src/store/contracts.js";
import { recordRepoTrust } from "@n-dx/llm-client";

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
  // The command runs in the repository, so a relative marker path keeps the
  // quoting shell-neutral.
  const command = () => `node -e "require('fs').writeFileSync('RAN', 'x')"`;

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

  describe("a plain test command on a baseline checkout (#686 finding 2)", () => {
    // A criterion keyword ("thing") that maps to a test file, so a permitted
    // run actually launches the command.
    beforeEach(() => {
      mkdirSync(join(repo, "tests"), { recursive: true });
      writeFileSync(join(repo, "tests", "thing.test.js"), "");
      writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: command() }));
    });

    it("is refused until the user accepts it, and runs once they have", async () => {
      // No chaining or fetching: an info-level finding, so the checkout is baseline.
      const before = JSON.parse((await handleVerifyCriteria(fakeStore(command()), repo, { runTests: true })).content[0].text);
      expect(before.trust.state).toBe("baseline");
      expect(before.testRun).toBeUndefined();
      expect(before.testsSkipped).toContain("ndx trust accept .");
      expect(existsSync(marker())).toBe(false);

      recordRepoTrust(repo);

      const after = JSON.parse((await handleVerifyCriteria(fakeStore(command()), repo, { runTests: true })).content[0].text);
      expect(after.testsSkipped).toBeUndefined();
      expect(after.trust).toBeUndefined();
      expect(after.testRun, after.testRun?.output).toMatchObject({ ran: true, passed: true });
      expect(existsSync(marker())).toBe(true);
    });

    it("is refused again once the accepted config changes", async () => {
      recordRepoTrust(repo);
      const changed = `${command()} --`;
      writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ test: changed }));
      const body = JSON.parse((await handleVerifyCriteria(fakeStore(changed), repo, { runTests: true })).content[0].text);
      expect(body.testRun).toBeUndefined();
      expect(body.testsSkipped).toContain("ndx trust accept .");
      expect(existsSync(marker())).toBe(false);
    });
  });

  it("needs no acceptance when the repository has no test command", async () => {
    const res = await handleVerifyCriteria(fakeStore(""), repo, { runTests: true });
    const body = JSON.parse(res.content[0].text);
    expect(body.testsSkipped).toBeUndefined();
    expect(body.trust).toBeUndefined();
  });
});
