import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeAgentMcpConfig } from "../../../src/process/agent-mcp-config.js";
import { bindCodexMcp } from "../../../src/agent/lifecycle/codex-mcp-binding.js";
import { fixtureSystemLayer } from "../../helpers/codex-system-layer.js";

const native = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../src/prd/llm-gateway.js", async original => ({
  ...await original<typeof import("../../../src/prd/llm-gateway.js")>(),
  readCodexEffectiveConfig: native.read,
}));

let root: string;
let path: string;
let cwd: string;
const cliPath = resolve(import.meta.dirname, "../../../../core/cli.js");
beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "codex-mcp-binding-")));
  // Exercise JSON-escaped path characters on POSIX as well as Windows.
  cwd = join(root, process.platform === "win32" ? "assigned" : "assigned\\tree");
  mkdirSync(cwd);
  vi.stubEnv("NDX_CLI_PATH", cliPath);
  path = await writeAgentMcpConfig({ henchDir: join(cwd, ".hench"), runId: "run", cliPath, projectDir: cwd });
  native.read.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

function options() { return { binary: "selected-codex", args: ["exec", "resume", "session", "-"], env: {}, cwd, path }; }
function snapshot(config: Record<string, unknown> = {}) {
  return { config, requirements: null, userAgent: "n-dx/0.167.0-alpha.3.2",
    layers: [{ name: { type: "user", file: "/fixture/config.toml", profile: null }, version: "fixture", config }, fixtureSystemLayer] };
}
describe("Codex executor MCP binding", () => {
  it("excludes mutable operator configuration while retaining selected pins", async () => {
    native.read.mockResolvedValue(snapshot({ model: "operator-model", mcp_servers: { rex: { command: "wrong" }, unrelated: { command: "never" } } }));
    const args = await bindCodexMcp(options());
    expect(args).not.toContain("mcp_servers.unrelated.enabled=false");
    expect(args).toContain("features.plugins=false");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain('model="operator-model"');
    expect(args).toContain(`mcp_servers.rex.args=${JSON.stringify([cliPath, "rex", "mcp", cwd])}`);
    expect(native.read).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ includeLayersAndRequirements: true }));
  });

  it("drops inherited transport/env and original config selectors instead of merging them", async () => {
    native.read.mockResolvedValue(snapshot({ mcp_servers: { rex: { url: "https://foreign.invalid", env: { CANARY: "private" } } } }));
    const args = await bindCodexMcp({ ...options(), args: ["exec", "-c", 'mcp_servers.rex.url="https://foreign.invalid"', "-"] });
    expect(args.join(" ")).not.toMatch(/foreign|CANARY/);
    expect(args).toContain("--ignore-user-config");
  });

  it.each(["missing", "malformed", "wrong-workspace", "unsafe", "unreadable"])("refuses %s binding before any native launch", async kind => {
    if (kind === "missing") rmSync(path);
    if (kind === "malformed") writeFileSync(path, "bad JSON");
    if (kind === "wrong-workspace") {
      const doc = JSON.parse(readFileSync(path, "utf8"));
      doc.mcpServers.rex.args[3] = join(root, "sibling");
      writeFileSync(path, JSON.stringify(doc));
    }
    if (kind === "unsafe") writeFileSync(path, readFileSync(path, "utf8").replace('"stdio"', '"http"'));
    if (kind === "unreadable") { rmSync(path); mkdirSync(path); }
    await expect(bindCodexMcp(options())).rejects.toThrow(/Codex MCP binding/);
    expect(native.read).not.toHaveBeenCalled();
  });

  it.each(["missing", "malformed", "foreign"])("revalidates a binding changed during native admission: %s", async kind => {
    native.read.mockImplementationOnce(() => {
      if (kind === "missing") rmSync(path);
      else writeFileSync(path, kind === "malformed" ? "not-json" : "{}");
      return snapshot();
    });
    await expect(bindCodexMcp(options())).rejects.toThrow(/Codex MCP binding/);
  });

  it.each(["during read", "during cleanup"])("preserves cancellation %s of final native verification", async when => {
    const { spawnWithAdapter } = await import("../../../src/agent/lifecycle/cli-loop.js");
    const { codexCliAdapter } = await import("../../../src/agent/lifecycle/adapters/codex-cli-adapter.js");
    const abort = new AbortController();
    native.read.mockImplementationOnce(() => {
      abort.abort(new Error("interrupted during verification"));
      if (when === "during cleanup") return snapshot();
    });
    const result = await spawnWithAdapter({
      adapter: codexCliAdapter, cliBinary: join(root, "absent-executor"), cwd, cliEnv: { CODEX_HOME: root },
      spawnConfig: { binary: "fixture", args: ["exec"], cwd, env: {}, stdinContent: null,
        codexMcpBinding: { path, disabled: false } },
      abortSignal: abort.signal, tokenMetadata: { vendor: "codex", model: "fixture" },
    });
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(result.aborted?.reason).toBe("interrupted during verification");
  });
});
