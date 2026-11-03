/**
 * The agent's shell and repository trust (#686 finding 3 follow-up).
 *
 * A `guard.env.allow` entry the repository ships names a credential that
 * run_command's child keeps. Until the user trusts the checkout, the entry is
 * dropped, as it is for repository-owned commands; once trusted it applies.
 * Drives the real clamp, the real GuardRails and a real child. Asserts on
 * presence only, never on the value.
 */

import { afterEach, beforeEach, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyRepoTrust } from "../../src/store/trust.js";
import { recordRepoTrust } from "../../src/prd/llm-gateway.js";
import { GuardRails } from "../../src/guard/index.js";
import { toolRunCommand } from "../../src/tools/shell.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { describeNeedsPosixShell, itNeedsPosixShell } from "../helpers/posix-shell.js";

const SENTINEL = "NDX_TRUST_SENTINEL_TOKEN";
const PROBE = `node -e "process.stdout.write(String(Object.hasOwn(process.env, '${SENTINEL}')))"`;

let repo: string;
let home: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "hench-trust-env-repo-"));
  home = mkdtempSync(join(tmpdir(), "hench-trust-env-home-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

async function childSeesSentinel(): Promise<string> {
  const config = DEFAULT_HENCH_CONFIG();
  config.guard = { ...config.guard, env: { allow: [SENTINEL] } };
  mkdirSync(join(repo, ".hench"), { recursive: true });
  writeFileSync(join(repo, ".hench", "config.json"), JSON.stringify(config));

  const applied = applyRepoTrust(config, repo, undefined, { ndxHome: home });
  const guard = new GuardRails(repo, applied.config.guard, { env: { ...process.env, [SENTINEL]: "sentinel" } });
  return toolRunCommand(guard, repo, { command: PROBE });
}

describeNeedsPosixShell("run_command under repository trust", () => {
  itNeedsPosixShell("an exact user deny removes the ssh-agent socket and askpass helper", async () => {
    const config = DEFAULT_HENCH_CONFIG();
    const guard = new GuardRails(repo, { ...config.guard, env: { deny: ["SSH_AUTH_SOCK", "GIT_ASKPASS"] } }, { env: { ...process.env, SSH_AUTH_SOCK: "/fixture/socket", GIT_ASKPASS: "/fixture/helper" } });
    const output = await toolRunCommand(guard, repo, { command: `node -e "process.stdout.write(JSON.stringify(['SSH_AUTH_SOCK','GIT_ASKPASS'].filter(n => n in process.env)))"` });
    expect(output).toBe("[]");
  });

  itNeedsPosixShell("withholds a repository-allowed credential while untrusted", async () => {
    expect(await childSeesSentinel()).toBe("false");
  });

  itNeedsPosixShell("passes it once the repository is trusted", async () => {
    // Write the config first so the recorded digest matches it.
    await childSeesSentinel();
    recordRepoTrust(repo, { ndxHome: home });
    expect(await childSeesSentinel()).toBe("true");
  });
});
