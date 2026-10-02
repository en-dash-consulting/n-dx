import { describe, expect, it } from "vitest";
import {
  compileEnvPolicy,
  envNameAllowed,
  sanitizeChildEnv,
  strippedEnvNames,
} from "../../../src/guard/env.js";
import { GuardRails } from "../../../src/guard/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";

const SAMPLE: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/home/x",
  GITHUB_TOKEN: "ghp_x",
  NPM_TOKEN: "npm_x",
  AWS_SECRET_ACCESS_KEY: "aws",
  AWS_REGION: "us-east-1",
  ANTHROPIC_API_KEY: "sk-ant",
  DB_PASSWORD: "pw",
  SSH_AUTH_SOCK: "/tmp/agent.sock",
  VITEST: "true",
  my_secret_thing: "lower",
  CI: "1",
};

describe("child environment policy", () => {
  it("strips credential-shaped names by default and keeps plumbing", () => {
    const out = sanitizeChildEnv(SAMPLE, compileEnvPolicy(undefined));
    expect(Object.keys(out).sort()).toEqual(["CI", "HOME", "PATH", "SSH_AUTH_SOCK", "VITEST"]);
  });

  it("matches case-insensitively", () => {
    const policy = compileEnvPolicy(undefined);
    expect(envNameAllowed("my_secret_thing", policy)).toBe(false);
    expect(envNameAllowed("Github_Token", policy)).toBe(false);
  });

  it("lets a project allow a variable its tests need, and deny more", () => {
    const policy = compileEnvPolicy({ allow: ["GITHUB_TOKEN"], deny: ["CI"] });
    const out = sanitizeChildEnv(SAMPLE, policy);
    expect(out.GITHUB_TOKEN).toBe("ghp_x");
    expect(out.CI).toBeUndefined();
    expect(out.NPM_TOKEN).toBeUndefined();
  });

  it("never mutates the input and skips undefined values", () => {
    const env = { ...SAMPLE, EMPTY: undefined };
    const out = sanitizeChildEnv(env, compileEnvPolicy(undefined));
    expect("EMPTY" in out).toBe(false);
    expect(env.GITHUB_TOKEN).toBe("ghp_x");
  });

  it("reports what it would strip", () => {
    expect(strippedEnvNames(SAMPLE, compileEnvPolicy(undefined))).toEqual([
      "ANTHROPIC_API_KEY", "AWS_REGION", "AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "GITHUB_TOKEN", "NPM_TOKEN", "my_secret_thing",
    ]);
  });

  it("is applied once by GuardRails from the injected environment", () => {
    const guard = new GuardRails("/tmp/p", DEFAULT_HENCH_CONFIG().guard, { env: SAMPLE, shellKind: "posix" });
    expect(guard.childEnv.GITHUB_TOKEN).toBeUndefined();
    expect(guard.childEnv.PATH).toBe("/usr/bin");
  });
});
