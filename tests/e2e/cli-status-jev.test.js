import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTmpDir, removeTmpDir, runResult, setupRexDir } from "./e2e-helpers.js";

// Placeholder only: a real-looking key would trip secret scanners.
const SECRET = "tsk-placeholder-status-0123456789";

let project;
let home;
beforeEach(async () => {
  project = await createTmpDir("ndx-status-jev-");
  await setupRexDir(project);
  home = await mkdtemp(join(tmpdir(), "ndx-status-jev-home-"));
});
afterEach(async () => {
  await removeTmpDir(project);
  await rm(home, { recursive: true, force: true });
});

function status(extraEnv = {}) {
  const env = { ...process.env, NDX_HOME: home, ...extraEnv };
  delete env.N_DX_HOME;
  if (!("TYPESAFE_API_KEY" in extraEnv)) delete env.TYPESAFE_API_KEY;
  return runResult(["status", project], { env });
}

function config(args, input) {
  return runResult(["config", ...args], {
    env: { ...process.env, NDX_HOME: home, TYPESAFE_API_KEY: "" },
    input,
  });
}

describe("ndx status jev line", () => {
  it("says unavailable and names the command when no key resolves", () => {
    const { stdout, code } = status();
    expect(code).toBe(0);
    expect(stdout).toContain("jev: unavailable");
    expect(stdout).toContain("ndx config credentials.typesafe");
  });

  it("reports env for an exported key, never the key", () => {
    const { stdout } = status({ TYPESAFE_API_KEY: SECRET });
    expect(stdout).toContain("jev: available (env)");
    expect(stdout).not.toContain(SECRET);
  });

  it("reports file for a stored key, never the key", () => {
    expect(config(["credentials.typesafe", "--stdin"], SECRET).code).toBe(0);
    const { stdout } = status();
    expect(stdout).toContain("jev: available (file)");
    expect(stdout).not.toContain(SECRET);
  });

  it.skipIf(process.platform === "win32")(
    "names a store readable by others and its chmod fix instead of asking for a key",
    async () => {
      expect(config(["credentials.typesafe", "--stdin"], SECRET).code).toBe(0);
      const store = join(home, "credentials.json");
      await chmod(store, 0o644);
      const { stdout, code } = status();
      expect(code).toBe(0);
      expect(stdout).toContain(`jev: unavailable (Refusing to read the credential store ${store}`);
      expect(stdout).toContain(`chmod 600 ${store}`);
      expect(stdout).not.toContain("store a key");
      expect(stdout).not.toContain(SECRET);
    },
  );

  it("--test with no key reports it without any request", () => {
    const { stderr, stdout, code } = config(["credentials.typesafe", "--test"]);
    expect(code).toBe(1);
    expect(stderr + stdout).toContain("no key");
  });
});
