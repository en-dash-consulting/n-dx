import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { writeFileSync } from "node:fs";
import type { SpawnCliOptions } from "../../src/exec.js";
import { createCliClient } from "../../src/cli-provider.js";
import { createCodexCliClient } from "../../src/codex-cli-provider.js";

const { spawnCli } = vi.hoisted(() => ({ spawnCli: vi.fn() }));
vi.mock("../../src/exec.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/exec.js")>(), spawnCli,
}));

beforeEach(() => {
  vi.stubEnv("FAKE_SERVICE_API_KEY", "fixture-secret");
  vi.stubEnv("GITHUB_TOKEN", "fixture-github");
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-claude");
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-oauth");
  vi.stubEnv("OPENAI_API_KEY", "fixture-openai");
  vi.stubEnv("CODEX_HOME", "/fixture/codex");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function mockSpawn(authFailure = false): void {
  let calls = 0;
  spawnCli.mockImplementation((_binary: string, args: string[], _options: SpawnCliOptions) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    });
    const failing = authFailure && calls++ === 0;
    queueMicrotask(() => {
      if (failing) child.stderr.emit("data", Buffer.from("unauthorized"));
      else {
        const outputIndex = args.indexOf("-o");
        if (outputIndex >= 0) writeFileSync(args[outputIndex + 1], "done");
        else child.stdout.emit("data", Buffer.from(JSON.stringify({ result: "done" })));
      }
      child.emit("close", failing ? 1 : 0);
    });
    return child;
  });
}

describe("foundation vendor CLI spawn containment", () => {
  it.each(["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"])("retains active %s credentials at the provider spawn boundary", async (mode) => {
    vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "");
    vi.stubEnv("CLAUDE_CODE_USE_VERTEX", "");
    vi.stubEnv(mode, "1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "fixture-access");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "fixture-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "fixture-session");
    vi.stubEnv("AWS_PROFILE", "fixture-profile");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/fixture/google.json");
    vi.stubEnv("CLOUD_ML_REGION", "global");
    mockSpawn();
    const client = createCliClient({ claudeConfig: {}, maxRetries: 0 });
    expect((await client.complete({ prompt: "test", model: "test" })).text).toBe("done");
    const env: NodeJS.ProcessEnv = spawnCli.mock.calls[0][2].env;
    for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_REGION"]) {
      expect(env[name]).toBe(mode === "CLAUDE_CODE_USE_BEDROCK" ? process.env[name] : undefined);
    }
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(mode === "CLAUDE_CODE_USE_VERTEX" ? "/fixture/google.json" : undefined);
    expect(env.CLOUD_ML_REGION).toBe("global");
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.FAKE_SERVICE_API_KEY).toBeUndefined();
  });

  // One-shot completions take no project policy (D1, #623): the default filter applies.
  it.each(["claude", "codex"] as const)("filters %s spawns with the default policy", async (vendor) => {
    mockSpawn();
    const client = vendor === "claude"
      ? createCliClient({ claudeConfig: {}, maxRetries: 0 })
      : createCodexCliClient({ codexConfig: {}, maxRetries: 0 });
    expect((await client.complete({ prompt: "test", model: "test" })).text).toBe("done");
    const env: NodeJS.ProcessEnv = spawnCli.mock.calls[0][2].env;
    expect(env.FAKE_SERVICE_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    if (vendor === "claude") {
      expect(env.ANTHROPIC_API_KEY).toBe("fixture-claude");
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("fixture-oauth");
      expect(env.OPENAI_API_KEY).toBeUndefined();
    } else {
      expect(env.OPENAI_API_KEY).toBe("fixture-openai");
      expect(env.CODEX_HOME).toBe("/fixture/codex");
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    }
  });

  it("keeps the Codex login fallback filtered after an API-key auth failure", async () => {
    mockSpawn(true);
    const client = createCodexCliClient({ codexConfig: {}, maxRetries: 0 });
    expect((await client.complete({ prompt: "test", model: "test" })).text).toBe("done");
    expect(spawnCli).toHaveBeenCalledTimes(2);
    const first: NodeJS.ProcessEnv = spawnCli.mock.calls[0][2].env;
    const retry: NodeJS.ProcessEnv = spawnCli.mock.calls[1][2].env;
    expect(first.OPENAI_API_KEY).toBe("fixture-openai");
    expect(retry.OPENAI_API_KEY).toBeUndefined();
    expect(retry.CODEX_HOME).toBe("/fixture/codex");
    expect(retry.FAKE_SERVICE_API_KEY).toBeUndefined();
    expect(retry.GITHUB_TOKEN).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBe("fixture-openai");
  });
});
