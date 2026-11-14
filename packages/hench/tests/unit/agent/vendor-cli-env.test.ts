import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnWithAdapter } from "../../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { resolveSessionCliEnv, resolveVendorCliEnv } from "../../../src/store/project-config.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { TEST_MAX_WORKERS_ENV } from "../../../src/process/test-workers.js";

const { spawnCli } = vi.hoisted(() => ({ spawnCli: vi.fn() }));
vi.mock("../../../src/prd/llm-gateway.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/prd/llm-gateway.js")>(),
  spawnCli,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("vendor CLI spawn environment", () => {
  it("spawns with the guard-filtered environment it is given", async () => {
    vi.stubEnv("FAKE_SERVICE_API_KEY", "fixture-api");
    vi.stubEnv("GITHUB_TOKEN", "fixture-token");
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture-vendor");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-oauth");
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 123,
    });
    spawnCli.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    await spawnWithAdapter({
      adapter: claudeCliAdapter,
      spawnConfig: { binary: "claude", args: [], env: {}, stdinContent: null, cwd: "." },
      cliBinary: "claude", cwd: ".", tokenMetadata: { vendor: "claude", model: "sonnet" },
      cliEnv: resolveVendorCliEnv({ vendor: "claude" }, { allow: ["GITHUB_TOKEN"] }),
    });
    const env: NodeJS.ProcessEnv = spawnCli.mock.calls[0][2].env;
    expect(env.FAKE_SERVICE_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBe("fixture-token");
    expect(env.ANTHROPIC_API_KEY).toBe("fixture-vendor");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("fixture-oauth");
    expect(process.env.GITHUB_TOKEN).toBe("fixture-token");
  });
});

/**
 * The session environment cli-loop hands the executor and a pair reviewer.
 * The cap is 1: the lower of the cap and a valid inherited value wins, so 1
 * is the result whatever the parent exports. Nothing here writes the variable.
 */
describe("resolveSessionCliEnv", () => {
  const llm = { vendor: "claude" as const };

  it("carries the worker cap when hench.testGate.maxWorkers is set", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), testGate: { maxWorkers: 1 } };
    expect(resolveSessionCliEnv(llm, config, "CLI environment", () => {})[TEST_MAX_WORKERS_ENV]).toBe("1");
  });

  it("is the plain vendor environment when no cap is set", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const env = resolveSessionCliEnv(llm, config, "CLI environment", () => {});
    expect(env).toEqual(resolveVendorCliEnv(llm, config.guard.env));
    expect(env[TEST_MAX_WORKERS_ENV]).toBe(process.env[TEST_MAX_WORKERS_ENV]);
  });

  it("reports what the guard stripped under its label", () => {
    vi.stubEnv("FAKE_SERVICE_API_KEY", "fixture-api");
    const lines: string[] = [];
    resolveSessionCliEnv(llm, DEFAULT_HENCH_CONFIG(), "codex reviewer environment", (line) => lines.push(line));
    expect(lines.join("\n")).toMatch(/^codex reviewer environment: stripped .*FAKE_SERVICE_API_KEY/m);
  });
});
