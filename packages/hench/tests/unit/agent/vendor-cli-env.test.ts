import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnWithAdapter } from "../../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { resolveVendorCliEnv } from "../../../src/store/project-config.js";

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
