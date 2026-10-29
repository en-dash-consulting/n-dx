/**
 * The environment every extension process gets
 * (packages/core/extension-env.js): the contract variables, the state folder
 * and config file it creates, the hub when one runs, and never the token.
 * The same contract through the real CLI is in tests/e2e/cli-extensions.test.js.
 *
 * @see docs/architecture/extensions.md — "Environment every extension process gets"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  EXTENSION_API_VERSION,
  EXTENSION_CONFIG_PREFIX,
  EXTENSION_ENV_VARS,
  NDX_CLI_PATH,
  SIDECAR_CONFIG_FILENAME,
  extensionEnvironment,
  extensionStateDir,
  releaseExtensionConfig,
} from "../../packages/core/extension-env.js";

const CORE_CLI = join(import.meta.dirname, "../../packages/core/cli.js");
const TOKEN = "s3cret-token-value";

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-ext-env-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

const build = (overrides = {}) =>
  extensionEnvironment({ name: "recon", home, ndxVersion: "0.10.0", baseEnv: { PATH: "/bin", USER_VAR: "kept" }, ...overrides });

function startHub({ alive = true, token = true } = {}) {
  writeFileSync(join(home, "hub.pid"), JSON.stringify({ pid: 4242, port: 3999, startedAt: "2026-10-26T00:00:00Z" }));
  if (token) writeFileSync(join(home, "auth.token"), `${TOKEN}\n`);
  return (pid) => alive && pid === 4242;
}

describe("extensionEnvironment", () => {
  it("writes the merged config section to the file NDX_EXTENSION_CONFIG names", () => {
    const env = build({ config: { mode: "fast", depth: 3 } });
    expect(JSON.parse(readFileSync(env.NDX_EXTENSION_CONFIG, "utf-8"))).toEqual({ mode: "fast", depth: 3 });
    expect(JSON.parse(readFileSync(build().NDX_EXTENSION_CONFIG, "utf-8"))).toEqual({});
  });

  it("sets every contract variable but the hub's, on top of the user's environment", () => {
    const env = build();
    const stateDir = join(home, "ext", "recon");
    expect(env).toMatchObject({
      PATH: "/bin",
      USER_VAR: "kept",
      NDX_EXTENSION_API: String(EXTENSION_API_VERSION),
      NDX_VERSION: "0.10.0",
      NDX_BIN: NDX_CLI_PATH,
      NDX_HOME: home,
      NDX_EXTENSION_NAME: "recon",
      NDX_EXTENSION_STATE_DIR: stateDir,
    });
    expect(dirname(env.NDX_EXTENSION_CONFIG)).toBe(stateDir);
    expect(basename(env.NDX_EXTENSION_CONFIG)).toMatch(new RegExp(`^${EXTENSION_CONFIG_PREFIX}${process.pid}-[0-9a-f]+\\.json$`));
    expect(env).not.toHaveProperty("NDX_HUB_URL");
    expect(env).not.toHaveProperty("NDX_TOKEN_FILE");
    expect(EXTENSION_API_VERSION).toBe(1);
  });

  it("NDX_BIN is this install's cli.js", () => {
    expect(NDX_CLI_PATH).toBe(CORE_CLI);
  });

  it("creates the state folder on first run and writes the config file", () => {
    const stateDir = extensionStateDir(home, "recon");
    expect(existsSync(stateDir)).toBe(false);
    const env = build();
    expect(existsSync(stateDir)).toBe(true);
    expect(JSON.parse(readFileSync(env.NDX_EXTENSION_CONFIG, "utf-8"))).toEqual({});
    // A second run keeps what the extension wrote there.
    writeFileSync(join(stateDir, "mine.txt"), "x");
    build();
    expect(readFileSync(join(stateDir, "mine.txt"), "utf-8")).toBe("x");
  });

  it("names a running hub and its token file, never the token", () => {
    const isAlive = startHub();
    const env = build({ isAlive, baseEnv: {} });
    expect(env.NDX_HUB_URL).toBe("http://localhost:3999");
    expect(env.NDX_TOKEN_FILE).toBe(join(home, "auth.token"));
    for (const value of Object.values(env)) expect(value).not.toContain(TOKEN);
  });

  it("omits the token file when the hub runs without one", () => {
    const env = build({ isAlive: startHub({ token: false }) });
    expect(env.NDX_HUB_URL).toBe("http://localhost:3999");
    expect(env).not.toHaveProperty("NDX_TOKEN_FILE");
  });

  it("names no hub when hub.pid's process is gone, or hub.pid is not JSON", () => {
    expect(build({ isAlive: startHub({ alive: false }) })).not.toHaveProperty("NDX_HUB_URL");
    writeFileSync(join(home, "hub.pid"), "{");
    expect(build({ isAlive: () => true })).not.toHaveProperty("NDX_HUB_URL");
  });

  it("replaces inherited contract variables, so a stale hub URL never survives the hub", () => {
    const inherited = Object.fromEntries(EXTENSION_ENV_VARS.map((key) => [key, "stale"]));
    const env = build({ baseEnv: { ...inherited, USER_VAR: "kept" } });
    expect(env).not.toHaveProperty("NDX_HUB_URL");
    expect(env).not.toHaveProperty("NDX_TOKEN_FILE");
    for (const key of EXTENSION_ENV_VARS) expect(env[key]).not.toBe("stale");
    expect(env.USER_VAR).toBe("kept");
  });

  it("gives every command process a config file of its own, removed on release", () => {
    const first = build({ config: { who: "p1" } });
    const second = build({ config: { who: "p2" } });
    expect(first.NDX_EXTENSION_CONFIG).not.toBe(second.NDX_EXTENSION_CONFIG);
    expect(readJson(first.NDX_EXTENSION_CONFIG)).toEqual({ who: "p1" });
    releaseExtensionConfig(first);
    expect(existsSync(first.NDX_EXTENSION_CONFIG)).toBe(false);
    expect(readJson(second.NDX_EXTENSION_CONFIG)).toEqual({ who: "p2" });
    // No temp file is left behind by the write-then-rename.
    expect(readdirSync(extensionStateDir(home, "recon"))).toEqual([basename(second.NDX_EXTENSION_CONFIG)]);
  });

  it("writes a sidecar's config to its own file, which release keeps and command runs leave alone", () => {
    const sidecar = build({ sidecar: true, config: { mode: "deep" } });
    expect(sidecar.NDX_EXTENSION_CONFIG).toBe(join(extensionStateDir(home, "recon"), SIDECAR_CONFIG_FILENAME));
    releaseExtensionConfig(build({ config: { who: "p1" } }));
    releaseExtensionConfig(sidecar);
    expect(readJson(sidecar.NDX_EXTENSION_CONFIG)).toEqual({ mode: "deep" });
  });

  it("sweeps config and temp files whose n-dx process is gone, and the old shared file", () => {
    const stateDir = extensionStateDir(home, "recon");
    mkdirSync(stateDir, { recursive: true });
    const stale = ["ndx-config.json", "ndx-config-111-ab.json", "sidecar-config.json.111-cd.tmp"];
    const live = ["ndx-config-222-ef.json", "mine.txt"];
    for (const file of [...stale, ...live]) writeFileSync(join(stateDir, file), "{}");
    const env = build({ isAlive: (pid) => pid === 222 });
    expect(readdirSync(stateDir).sort()).toEqual([...live, basename(env.NDX_EXTENSION_CONFIG)].sort());
  });

  it("throws when the state folder cannot be created", () => {
    writeFileSync(join(home, "ext"), "a file where the folder should be");
    expect(() => build()).toThrow();
  });
});
