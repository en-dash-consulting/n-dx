/**
 * Every child `ndx graview` spawns — a graview on PATH, the `npx -y
 * graview@<pinned>` fallback (a binary fetched from the registry) and the
 * product face's server — gets the sanitized environment, never the whole of
 * `process.env` (#635 follow-up). Each stub records the environment it was
 * given; nothing is fetched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../../src/cli/index.js";
import { makeProject } from "../helpers/project.js";

const CREDENTIAL = "GRAVIEW_TEST_SECRET_TOKEN";
const USER_DENIED = "GRAVIEW_TEST_USER_DENIED";

let root: string;
let home: string;
let stubs: string;

const envFile = () => join(stubs, "child.env");

function executable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** The environment the last stub ran with, as name → value. */
function childEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(envFile(), "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** The user's own local config: `graview.app` (or nowhere) and a deny of their own. */
function localConfig(app: string): void {
  writeFileSync(
    join(root, ".n-dx.local.json"),
    JSON.stringify({ graview: { app }, hench: { guard: { env: { deny: [USER_DENIED] } } } }),
  );
}

beforeEach(() => {
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-env-home-"));
  stubs = mkdtempSync(join(tmpdir(), "graview-env-stubs-"));
  localConfig(join(root, "no-face"));

  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("NDX_GRAVIEW_BIN", "");
  vi.stubEnv("PATH", `${stubs}:/usr/bin:/bin`);
  vi.stubEnv(CREDENTIAL, "placeholder-credential");
  vi.stubEnv(USER_DENIED, "placeholder-user-denied");
  vi.stubEnv("npm_config_registry", "https://registry.example.test/");
  vi.stubEnv("NPM_CONFIG_USERCONFIG", join(home, "npmrc"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home, stubs]) rmSync(dir, { recursive: true, force: true });
});

function expectSanitized(env: Record<string, string>): void {
  expect(env[CREDENTIAL]).toBeUndefined();
  expect(env[USER_DENIED]).toBeUndefined();
  expect(env.PATH).toBe(`${stubs}:/usr/bin:/bin`);
  expect(env.NDX_HOME).toBe(home);
}

describe.skipIf(process.platform === "win32")("the environment graview's children get", () => {
  it("a graview on PATH does not receive a credential", async () => {
    executable(join(stubs, "graview"), `#!/bin/sh\nenv > ${JSON.stringify(envFile())}\n`);
    expect(await main(["check", root, "--quiet"])).toBe(0);
    expectSanitized(childEnv());
  });

  it("the npx fallback does not receive a credential, and keeps npm's own config", async () => {
    executable(join(stubs, "npx"), `#!/bin/sh\nenv > ${JSON.stringify(envFile())}\n`);
    expect(await main(["check", root, "--quiet"])).toBe(0);
    const env = childEnv();
    expectSanitized(env);
    expect(env.npm_config_registry).toBe("https://registry.example.test/");
    expect(env.NPM_CONFIG_USERCONFIG).toBe(join(home, "npmrc"));
  });

  it("the product face's server does not receive a credential, and still gets its own variables", async () => {
    const face = mkdtempSync(join(tmpdir(), "graview-env-face-"));
    try {
      mkdirSync(join(face, "bin"));
      writeFileSync(
        join(face, "bin", "serve.js"),
        `const { writeFileSync } = require("node:fs");\n` +
          `writeFileSync(${JSON.stringify(envFile())}, Object.entries(process.env).map(([k, v]) => k + "=" + v).join("\\n"));\n`,
      );
      writeFileSync(join(face, "package.json"), JSON.stringify({ name: "face", type: "commonjs" }));
      localConfig(face);
      expect(await main(["serve", root, "--quiet"])).toBe(0);
      const env = childEnv();
      expectSanitized(env);
      expect(env.NDX_GRAVIEW_DIR).toBeTruthy();
      expect(env.NDX_PROJECT_ROOT).toBe(root);
    } finally {
      rmSync(face, { recursive: true, force: true });
    }
  });
});
