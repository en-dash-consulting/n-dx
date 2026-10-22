import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repoCommandEnv } from "../../src/repo-command-env.js";
import { recordRepoTrust } from "../../src/repo-trust.js";

/**
 * The environment a repository-owned command (test gate, audit, verify) gets.
 * Assertions are on presence only; no value is ever printed.
 */

const SENTINEL = "NDX_SENTINEL_TOKEN";
const OTHER = "NDX_SENTINEL_PLAIN";

let repo: string;
let home: string;

function writeJson(rel: string, data: unknown): void {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

function parent(): NodeJS.ProcessEnv {
  return { NDX_HOME: home, PATH: "/usr/bin", [SENTINEL]: "sentinel", [OTHER]: "plain" };
}

function visible(env: NodeJS.ProcessEnv, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, name);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ndx-cmd-env-repo-"));
  home = mkdtempSync(join(tmpdir(), "ndx-cmd-env-home-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("repoCommandEnv", () => {
  it("strips credential-shaped names and keeps the rest, without a config", () => {
    const env = repoCommandEnv(repo, { env: parent() });
    expect(visible(env, SENTINEL)).toBe(false);
    expect(visible(env, OTHER)).toBe(true);
    expect(visible(env, "PATH")).toBe(true);
  });

  it("ignores a repository-supplied allow entry while the repository is untrusted", () => {
    writeJson(".hench/config.json", { guard: { env: { allow: [SENTINEL] } } });
    expect(visible(repoCommandEnv(repo, { env: parent() }), SENTINEL)).toBe(false);
  });

  it("honours the repository's allow entry once the user trusts it, and drops it again when it changes", () => {
    writeJson(".hench/config.json", { guard: { env: { allow: [SENTINEL] } } });
    recordRepoTrust(repo, { env: { NDX_HOME: home } });
    expect(visible(repoCommandEnv(repo, { env: parent() }), SENTINEL)).toBe(true);

    writeJson(".hench/config.json", { guard: { env: { allow: [SENTINEL, "OTHER_TOKEN"] } } });
    expect(visible(repoCommandEnv(repo, { env: parent() }), SENTINEL)).toBe(false);
  });

  it("ignores an allow entry in the tracked project config while untrusted", () => {
    writeJson(".n-dx.json", { hench: { guard: { env: { allow: [SENTINEL] } } } });
    expect(visible(repoCommandEnv(repo, { env: parent() }), SENTINEL)).toBe(false);
  });

  it("always honours the user's git-ignored local config", () => {
    writeJson(".hench/config.json", { guard: { env: { allow: ["SOMETHING_ELSE_TOKEN"] } } });
    writeJson(".n-dx.local.json", { hench: { guard: { env: { allow: [SENTINEL] } } } });
    expect(visible(repoCommandEnv(repo, { env: parent() }), SENTINEL)).toBe(true);
  });

  it("applies a repository deny entry whatever the trust state", () => {
    writeJson(".hench/config.json", { guard: { env: { deny: [OTHER] } } });
    expect(visible(repoCommandEnv(repo, { env: parent() }), OTHER)).toBe(false);
  });

  it("never mutates the parent environment", () => {
    const env = parent();
    repoCommandEnv(repo, { env });
    expect(visible(env, SENTINEL)).toBe(true);
  });
});
