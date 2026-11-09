/**
 * The root setupFile hides ambient agent-run state from the suite, so a test
 * run inside an `ndx work` gate behaves as it does in CI.
 *
 * @see tests/setup-session-env.js
 */
import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SETUP = new URL("../setup-session-env.js", import.meta.url).href;

// Location values must be paths that do not exist, so nothing can act on a
// real repository if the setup failed to clear them.
const noSuchGitDir = join(tmpdir(), "ndx-no-such-git-dir");
const GIT_HOST_ENV = {
  GIT_CONFIG_PARAMETERS: "'safe.bareRepository=explicit' 'core.fsmonitor='",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "safe.bareRepository",
  GIT_CONFIG_VALUE_0: "explicit",
  GIT_DIR: noSuchGitDir,
  GIT_WORK_TREE: join(noSuchGitDir, "work-tree"),
  GIT_INDEX_FILE: join(noSuchGitDir, "index"),
  GIT_COMMON_DIR: join(noSuchGitDir, "common"),
};

describe("setup-session-env", () => {
  const names = ["NDX_AGENT_RUN", ...Object.keys(GIT_HOST_ENV)];
  const prev = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const name of names) {
      if (prev[name] === undefined) delete process.env[name];
      else process.env[name] = prev[name];
    }
  });

  it("clears NDX_AGENT_RUN, which an ndx work run's test gate inherits", async () => {
    process.env.NDX_AGENT_RUN = "1";
    // A query string makes a fresh module instance; the setupFile already ran the plain URL.
    await import(`${SETUP}?agent-run`);
    expect(process.env.NDX_AGENT_RUN).toBeUndefined();
  });

  it("clears git's command-line config and repository location inherited from the host", async () => {
    Object.assign(process.env, GIT_HOST_ENV);
    await import(`${SETUP}?git-local-env`);
    for (const name of Object.keys(GIT_HOST_ENV)) {
      expect(process.env[name], name).toBeUndefined();
    }
  });
});
