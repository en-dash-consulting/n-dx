/** Native config/read + real stdio MCP evidence, not model/account evidence.
 * Opt in with NDX_TEST_CODEX_BINARY pointing at the operator-selected binary.
 * Every auth/config home is disposable; no real login or global config is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bindCodexMcp } from "../../src/agent/lifecycle/codex-mcp-binding.js";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import { prepareAgentMcpConfig } from "../../src/process/agent-mcp-config.js";
import { createPromptEnvelope, DEFAULT_EXECUTION_POLICY, readCodexEffectiveConfig, terminateProcessTree } from "../../src/prd/llm-gateway.js";

const binary = process.env.NDX_TEST_CODEX_BINARY;
const repo = resolve(import.meta.dirname, "../../../..");
const launcher = join(repo, "packages/core/cli.js");
const task = "c0000000-0000-4000-8000-000000000002";
const taskPath = ".rex/changes/add-apple-pay/wire-the-button.md";
let root: string;
let anchor: string;
let assigned: string;
let sibling: string;
let env: NodeJS.ProcessEnv;
let binding: string;

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe", windowsHide: true });
}

function hashPrd(dir: string): string {
  const hash = createHash("sha256");
  for (const part of ["product", "changes"]) {
    const base = join(dir, ".rex", part);
    for (const file of readdirSync(base, { recursive: true, withFileTypes: true })
      .filter(f => f.isFile()).map(f => join(f.parentPath, f.name)).sort()) {
      hash.update(file.slice(base.length)).update(readFileSync(file));
    }
  }
  return hash.digest("hex");
}

/** Minimal JSON-RPC client, exercising the actual server commands from Codex's
 * verified configuration rather than importing either domain's implementation.
 */
async function mcp(server: Record<string, unknown>, use: (call: (name: string, args?: Record<string, unknown>) => Promise<string>) => Promise<void>) {
  const child = spawn(server.command as string, server.args as string[], {
    cwd: server.cwd as string, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let next = 0;
  let buffer = "";
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const request = (method: string, params: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  child.stdout.on("data", data => {
    buffer += data.toString();
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const msg = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error("MCP request refused"));
        else waiter.resolve(msg.result);
      }
    }
  });
  const fail = () => { for (const waiter of pending.values()) waiter.reject(new Error("MCP process unavailable")); };
  child.on("error", fail); child.on("close", fail);
  const timer = setTimeout(fail, 15000);
  try {
    await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "n-dx-test", version: "1" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    await use(async (name, args = {}) => {
      const result = await request("tools/call", { name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return (result.content as Array<{ text: string }>).map(c => c.text).join("\n");
    });
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    await terminateProcessTree(child);
  }
}

describe.skipIf(!binary)("native Codex worktree MCP binding", () => {
  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "codex-mcp-native-")));
    anchor = join(root, "anchor"); assigned = join(root, "assigned"); sibling = join(root, "sibling");
    const home = join(root, "operator"); mkdirSync(home); mkdirSync(anchor);
    env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
      CODEX_HOME: home, TMPDIR: root, TMP: root, TEMP: root, NDX_HOME: join(root, "ndx-home") };
    git(anchor, "init", "--quiet", "--initial-branch=main");
    cpSync(join(repo, "packages/rex/tests/fixtures/v2-tree"), join(anchor, ".rex"), { recursive: true });
    writeFileSync(join(anchor, ".rex/config.json"), JSON.stringify({ schema: "rex/v1", project: "fixture", adapter: "file" }));
    git(anchor, "add", "."); git(anchor, "commit", "--quiet", "-m", "fixture");
    git(anchor, "worktree", "add", "--quiet", "-b", "assigned", assigned);
    git(anchor, "worktree", "add", "--quiet", "-b", "sibling", sibling);
    for (const [dir, sentinel] of [[anchor, "ANCHOR"], [assigned, "ASSIGNED"], [sibling, "SIBLING"]]) {
      const path = join(dir, taskPath);
      writeFileSync(path, readFileSync(path, "utf8").replace(/title: .*/, `title: "${sentinel}"`));
      mkdirSync(join(dir, ".sourcevision"));
      writeFileSync(join(dir, ".sourcevision/manifest.json"), JSON.stringify({ targetPath: dir }));
      writeFileSync(join(dir, ".sourcevision/inventory.json"), JSON.stringify({ files: [], summary: { totalFiles: 0, totalLines: 0, byLanguage: {} } }));
    }
    writeFileSync(join(home, "config.toml"), `model="operator-model-pin"\nmodel_provider="operator-provider"\n[model_providers.operator-provider]\nname="fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.rex]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([launcher, "rex", "mcp", anchor])}\n[mcp_servers.sourcevision]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([launcher, "sv", "mcp", sibling])}\n[mcp_servers.unrelated]\ncommand="must-never-start"\n`);
    vi.stubEnv("NDX_CLI_PATH", launcher);
    const prepared = await prepareAgentMcpConfig({ henchDir: join(assigned, ".hench"), runId: "fixture", projectDir: assigned });
    if (!prepared.ok) throw new Error("fixture launcher unavailable");
    binding = prepared.path;
  });
  afterEach(() => { vi.unstubAllEnvs(); if (root) rmSync(root, { recursive: true, force: true }); });

  it.each(["fresh", "resume", "fork"])("excludes registrations added after %s binding verification", async mode => {
    const spawn = codexCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {
      mcpConfigPath: binding, ...(mode !== "fresh" ? { resumeSessionId: "fixture-thread" } : {}),
      ...(mode === "fork" ? { forkSession: true, codexForkSupported: true } : {}),
    });
    const args = await bindCodexMcp({ path: spawn.codexMcpBinding!.path, binary: binary!, args: spawn.args, cwd: assigned, env });
    const operatorConfig = join(env.CODEX_HOME!, "config.toml");
    // Simulate an operator save after the final verification but before exec
    // loads its configuration. This name was absent from both preflight reads.
    writeFileSync(operatorConfig, readFileSync(operatorConfig, "utf8") +
      '\n[mcp_servers.added_after_verification]\ncommand="must-never-start"\nenabled=true\n');
    const effective = await readCodexEffectiveConfig({ binary: binary!, args, cwd: assigned, env });
    expect(effective?.model).toBe("operator-model-pin");
    expect(effective?.model_provider).toBe("operator-provider");
    const servers = effective!.mcp_servers as Record<string, Record<string, unknown>>;
    expect(Object.entries(servers).filter(([, server]) => server.enabled !== false)
      .map(([name]) => name).sort()).toEqual(["rex", "sourcevision"]);
    expect(servers.rex.args).toEqual([launcher, "rex", "mcp", assigned]);
    expect(servers.sourcevision.args).toEqual([launcher, "sv", "mcp", assigned]);
  });

  it.each(["fresh", "resume", "fork"])("binds %s to assigned sentinels and confines PRD mutation there", async mode => {
    const before = [anchor, assigned, sibling].map(hashPrd);
    const configBefore = readFileSync(join(env.CODEX_HOME!, "config.toml"), "utf8");
    const spawn = codexCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {
      mcpConfigPath: binding, ...(mode !== "fresh" ? { resumeSessionId: "fixture-thread" } : {}),
      ...(mode === "fork" ? { forkSession: true, codexForkSupported: true } : {}),
    });
    const args = await bindCodexMcp({ path: spawn.codexMcpBinding!.path, binary: binary!, args: spawn.args, cwd: assigned, env });
    const effective = await readCodexEffectiveConfig({ binary: binary!, args, cwd: assigned, env });
    expect(effective?.model).toBe("operator-model-pin");
    expect(effective?.model_provider).toBe("operator-provider");
    expect(effective?.features).toMatchObject({ apps: false, plugins: false });
    const servers = effective!.mcp_servers as Record<string, Record<string, unknown>>;
    expect(servers.unrelated.enabled).toBe(false);
    await mcp(servers.rex, async call => {
      expect(JSON.parse(await call("get_capabilities")).workspace.projectDir).toBe(assigned);
      expect(await call("get_item", { id: task })).toContain("ASSIGNED");
      await call("update_task_status", { id: task, status: "in_progress" });
      await call("append_log", { event: "binding_probe", itemId: task, detail: "Assigned only" });
    });
    await mcp(servers.sourcevision, async call => { expect(JSON.parse(await call("get_overview")).project).toBe("assigned"); });
    const after = [anchor, assigned, sibling].map(hashPrd);
    expect(after[0]).toBe(before[0]); expect(after[1]).not.toBe(before[1]); expect(after[2]).toBe(before[2]);
    expect(readFileSync(join(assigned, ".rex/execution-log.jsonl"), "utf8")).toContain("binding_probe");
    expect(readFileSync(join(env.CODEX_HOME!, "config.toml"), "utf8")).toBe(configBefore);
  });
});
