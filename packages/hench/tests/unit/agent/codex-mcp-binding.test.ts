import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeAgentMcpConfig } from "../../../src/process/agent-mcp-config.js";
import { bindCodexMcp } from "../../../src/agent/lifecycle/codex-mcp-binding.js";

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
function expected() {
  const doc = JSON.parse(readFileSync(path, "utf8"));
  return Object.fromEntries(Object.entries(doc.mcpServers).map(([name, value]) => {
    const server = value as { command: string; args: string[] };
    return [name, { command: server.command, args: server.args, cwd, enabled: true, required: true }];
  }));
}
describe("Codex executor MCP binding", () => {
  it("disables unrelated registrations and verifies canonical required servers without dropping user config", async () => {
    native.read.mockResolvedValueOnce({ mcp_servers: { rex: { command: "wrong" }, unrelated: { command: "never" } } })
      .mockResolvedValueOnce({ features: { apps: false, plugins: false }, mcp_servers: { ...expected(), unrelated: { enabled: false } } });
    const args = await bindCodexMcp(options());
    expect(args).toContain("mcp_servers.unrelated.enabled=false");
    expect(args).toContain("features.plugins=false");
    expect(args).not.toContain("--ignore-user-config");
    expect(args).toContain(`mcp_servers.rex.args=${JSON.stringify([cliPath, "rex", "mcp", cwd])}`);
    expect(native.read).toHaveBeenCalledTimes(2);
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

  it.each(["extra-server", "wrong-workspace", "env", "url", "missing", "disabled"])("rejects an unsafe native result: %s", async kind => {
    const servers = expected();
    if (kind === "extra-server") Object.assign(servers, { surprise: { enabled: true } });
    if (kind === "wrong-workspace") servers.rex.args[3] = join(root, "anchor");
    if (kind === "env") Object.assign(servers.rex, { env: { NODE_OPTIONS: "--require=foreign" } });
    if (kind === "url") Object.assign(servers.rex, { url: "http://foreign.invalid" });
    if (kind === "missing") delete servers.sourcevision;
    if (kind === "disabled") servers.rex.enabled = false;
    native.read.mockResolvedValueOnce({ mcp_servers: {} }).mockResolvedValueOnce({ features: { apps: false, plugins: false }, mcp_servers: servers });
    await expect(bindCodexMcp(options())).rejects.toThrow(/Codex MCP binding/);
  });

  it("refuses a native config that keeps plugin tools enabled", async () => {
    native.read.mockResolvedValueOnce({}).mockResolvedValueOnce({
      features: { apps: false, plugins: true }, mcp_servers: expected(),
    });
    await expect(bindCodexMcp(options())).rejects.toThrow(/plugin tools/);
  });

  it.each(["during read", "during cleanup"])("preserves cancellation %s of final native verification", async when => {
    const { spawnWithAdapter } = await import("../../../src/agent/lifecycle/cli-loop.js");
    const { codexCliAdapter } = await import("../../../src/agent/lifecycle/adapters/codex-cli-adapter.js");
    const abort = new AbortController();
    native.read.mockResolvedValueOnce({}).mockImplementationOnce(() => {
      abort.abort(new Error("interrupted during verification"));
      if (when === "during cleanup") return { features: { apps: false, plugins: false }, mcp_servers: expected() };
    });
    const result = await spawnWithAdapter({
      adapter: codexCliAdapter, cliBinary: join(root, "absent-executor"), cwd, cliEnv: { CODEX_HOME: root },
      spawnConfig: { binary: "fixture", args: ["exec"], cwd, env: {}, stdinContent: null,
        codexMcpBinding: { path, disabled: false } },
      abortSignal: abort.signal, tokenMetadata: { vendor: "codex", model: "fixture" },
    });
    expect(native.read).toHaveBeenCalledTimes(2);
    expect(result.aborted?.reason).toBe("interrupted during verification");
  });
});
