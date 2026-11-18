/** Candidate flag/path contracts only; these do not prove native confinement. */
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { vendorSessionDriver } from "@n-dx/llm-client";
import { candidateCodexHubSpawn, hubVendorRefusal, type CodexHubCandidateOptions } from "../../src/server/sidecar/spawn-policy.js";
import { sidecarSessionConnect } from "../../src/server/sidecar/session-registry.js";

let root: string;
let options: CodexHubCandidateOptions;
const endpoint = { url: "http://127.0.0.1:3117/mcp", headers: { "x-ndx-sidecar-key": "disposable-header" } };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hub-candidate-"));
  const cwd = join(root, "hub");
  const repository = join(root, "repository");
  mkdirSync(cwd);
  mkdirSync(repository);
  const snapshot = join(cwd, "snapshot");
  writeFileSync(snapshot, "disposable snapshot");
  options = { cwd, snapshot, repositories: [repository], version: "0.167.0-alpha.3.2", platform: "darwin" };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("replaces legacy policy on fresh and resumed driver spawns without exposing broker headers", () => {
  const candidate = candidateCodexHubSpawn(endpoint, 65_000, options);
  for (const sessionId of [undefined, "resumed-thread"]) {
    const spawn = vendorSessionDriver("codex")!.turnSpawn({ systemPrompt: "", prompt: "snapshot", resume: sessionId ? { sessionId } : undefined, codex: candidate.codex }, "darwin");
    expect(spawn.args.includes("resume")).toBe(!!sessionId);
    const args = spawn.args.join(" ");
    expect(args).toContain('--strict-config');
    expect(args).toContain('default_permissions="ndx-hub-candidate"');
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain('permissions.ndx-hub-candidate.network.enabled=false');
    expect(args).not.toContain("sandbox_mode");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("disposable-header");
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('mcp_servers.ndx-sidecar.default_tools_approval_mode="approve"');
    expect(args).toContain('mcp_servers.ndx-sidecar.tool_timeout_sec=65');
  }
  expect(candidate.codex.hiddenEnv).toEqual(["NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY"]);
  const flags = candidate.codex.policyFlags!.join(" ");
  expect(flags).toContain(`${JSON.stringify(realpathSync(options.snapshot))}="read"`);
  expect(flags).not.toContain(`${JSON.stringify(realpathSync(options.cwd))}="read"`);
  expect(flags).toContain(`${JSON.stringify(options.repositories[0])}="deny"`);
  for (const key of [":root", ":tmpdir", ":slash_tmp"]) expect(flags).toContain(`"${key}"="deny"`);
});

it.each([
  { platform: "linux" as const }, { platform: "win32" as const }, { version: "0.166.0" }, { version: "unknown" },
])("refuses unverified capability %j", (change) => {
  expect(() => candidateCodexHubSpawn(endpoint, 1000, { ...options, ...change })).toThrow(/unverified/);
});

it("rejects repository snapshots, symlink snapshots and hardlinks", () => {
  const file = join(options.repositories[0], "secret");
  writeFileSync(file, "disposable repository canary");
  expect(() => candidateCodexHubSpawn(endpoint, 1000, { ...options, snapshot: file })).toThrow(/outside/);
  rmSync(options.snapshot);
  symlinkSync(file, options.snapshot);
  expect(() => candidateCodexHubSpawn(endpoint, 1000, options)).toThrow(/outside/);
  rmSync(options.snapshot);
  linkSync(file, options.snapshot);
  expect(() => candidateCodexHubSpawn(endpoint, 1000, options)).toThrow(/snapshot/);
});

it("rechecks aliases before later turns and refuses a substituted snapshot", () => {
  const candidate = candidateCodexHubSpawn(endpoint, 1000, options);
  expect(candidate.codex.turnConfigFlags!()).toEqual([]);
  const file = join(options.repositories[0], "secret");
  writeFileSync(file, "disposable repository canary");
  rmSync(options.snapshot);
  symlinkSync(file, options.snapshot);
  expect(() => candidate.codex.turnConfigFlags!()).toThrow(/identity changed/);
});

it("rereads hostile project MCP declarations every turn without granting their tools", () => {
  const candidate = candidateCodexHubSpawn(endpoint, 1000, options);
  mkdirSync(join(options.cwd, ".git"));
  mkdirSync(join(options.cwd, ".codex"));
  writeFileSync(join(options.cwd, ".codex/config.toml"), '[mcp_servers.hostile]\ncommand="never-run"\n');
  expect(candidate.codex.turnConfigFlags!()).toContain("mcp_servers.hostile.enabled=false");
});

it("cannot admit Codex without the production host and broker", async () => {
  candidateCodexHubSpawn(endpoint, 1000, options);
  expect(hubVendorRefusal("codex")).toMatch(/cannot run/);
  const at = new Date().toISOString();
  await expect(sidecarSessionConnect(options.cwd)({
    id: "fixture", scope: "hub", worktree: options.cwd, vendor: "codex", name: "fixture",
    cursor: 0, turns: 0, tokens: { input: 0, output: 0 }, createdAt: at, lastActivityAt: at,
  })).rejects.toThrow(/requires/);
});
