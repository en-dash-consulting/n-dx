/** Native exec with a local scripted provider, plus real stdio MCP checks.
 * Neither fixture is actual-account or external-model evidence.
 * Opt in with NDX_TEST_CODEX_BINARY pointing at the operator-selected binary.
 * Every auth/config home is disposable; no real login or global config is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
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

function projectedServers(args: string[]): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  for (const arg of args) {
    const match = /^mcp_servers\.([a-z]+)\.([a-z]+)=(.*)$/.exec(arg);
    if (match) (servers[match[1]] ??= {})[match[2]] = JSON.parse(match[3]);
  }
  return servers;
}

/** Real exec, using only a disposable home and local scripted Responses.
 * A denied listener is a failing/unavailable native probe, never a skip/pass. */
async function nativeExec(args: string[]): Promise<string> {
  const child = spawn(binary!, args, { cwd: assigned, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const timer = setTimeout(() => { void terminateProcessTree(child); }, 20000);
  try {
    const exited = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    child.stdin.end("Return the fixed fixture completion. Do not call tools.");
    expect(await exited, stderr).toBe(0);
    const started = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)).find(event => event.type === "thread.started");
    expect(started?.thread_id).toBeTruthy();
    return started.thread_id;
  } finally { clearTimeout(timer); await terminateProcessTree(child); }
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

  it.each(["fresh", "resume", "fork"])("preserves built-in login and the compiled %s policy with a parseable argv", async mode => {
    const operatorConfig = join(env.CODEX_HOME!, "config.toml");
    writeFileSync(operatorConfig, 'model="operator-pin"\ncli_auth_credentials_store="file"\n');
    const spawn = codexCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {
      mcpConfigPath: binding, ...(mode !== "fresh" ? { resumeSessionId: "fixture-thread" } : {}),
      ...(mode === "fork" ? { forkSession: true, codexForkSupported: true } : {}),
    }).withScratchDir!(root);
    const options = { binary: binary!, cwd: assigned, env };
    const args = await bindCodexMcp({ ...options, path: binding, args: spawn.args });
    expect(args.filter(arg => arg === "--strict-config")).toHaveLength(1);
    expect(args.filter(arg => arg === "--ignore-user-config")).toHaveLength(1);
    execFileSync(binary!, [...args, "--help"], { cwd: assigned, env, stdio: "pipe", windowsHide: true });
    if (mode === "fresh") expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace-write");

    // Decode the new overrides natively against an empty disposable config.
    // app-server cannot read an ignored exec invocation. This checks the TOML
    // projection only; the separate race tests exercise actual execution.
    writeFileSync(operatorConfig, "");
    const config = await readCodexEffectiveConfig({ ...options, args: args.filter(arg => arg !== "--ignore-user-config") });
    expect(config).toMatchObject({
      model: "operator-pin", model_provider: "openai", forced_login_method: null, cli_auth_credentials_store: "file",
      approval_policy: "never", ...(mode !== "fresh" ? { sandbox_mode: "workspace-write" } : {}),
      sandbox_workspace_write: { network_access: false, writable_roots: [root], exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
      shell_environment_policy: { set: { OPENAI_API_KEY: "", CODEX_API_KEY: "", CODEX_ACCESS_TOKEN: "", TMP: root, TEMP: root, TMPDIR: root } },
      features: { apps: false, plugins: false, shell_snapshot: false },
    });
  });

  it("refuses a native forced-login requirement before returning launch arguments", async () => {
    writeFileSync(join(env.CODEX_HOME!, "config.toml"), 'forced_login_method="chatgpt"\n');
    await expect(bindCodexMcp({ binary: binary!, cwd: assigned, env, path: binding, args: ["exec"] }))
      .rejects.toThrow(/managed requirements/);
  });

  it.each(["fresh", "resume", "fork", "retry"])("excludes registrations added after %s binding verification", async mode => {
    const requests: Array<{ model: string; tools: Array<{ name?: string }> }> = [];
    const listener = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        if (!req.url?.includes("/responses")) { res.writeHead(404); res.end("{}"); return; }
        requests.push(JSON.parse(body));
        const response = { id: "resp_fixture", object: "response", created_at: 0, status: "completed", model: "operator-model-pin",
          output: [{ id: "msg_fixture", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "Fixture complete.", annotations: [] }] }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
          { type: "response.output_item.added", output_index: 0, item: response.output[0] },
          { type: "response.output_item.done", output_index: 0, item: response.output[0] }, { type: "response.completed", response }]) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      });
    });
    await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
    try {
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("fixture listener unavailable");
    const operatorConfig = join(env.CODEX_HOME!, "config.toml");
    writeFileSync(operatorConfig, readFileSync(operatorConfig, "utf8").replace("127.0.0.1:9", `127.0.0.1:${address.port}`) +
      `\n[projects.${JSON.stringify(assigned)}]\ntrust_level="trusted"\n`);
    const marker = join(root, "foreign-starts");
    const foreign = join(root, "foreign.mjs");
    writeFileSync(foreign, 'import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], process.argv[3] + "\\n");');
    const registration = (name: string) => `\n[mcp_servers.${name}]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([foreign, marker, name])}\nstartup_timeout_sec=1\n`;
    mkdirSync(join(assigned, ".codex"));
    const projectConfig = join(assigned, ".codex/config.toml");
    writeFileSync(projectConfig, registration("project_foreign"));
    const policy = { ...DEFAULT_EXECUTION_POLICY, sandbox: "read-only" as const };
    let session: string | undefined;
    if (mode !== "fresh") {
      const seed = codexCliAdapter.buildSpawnConfig(createPromptEnvelope([]), policy, { mcpConfigPath: binding });
      session = await nativeExec(await bindCodexMcp({ path: binding, binary: binary!, args: seed.args, cwd: assigned, env }));
      requests.length = 0;
    }
    const spawn = codexCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {
      mcpConfigPath: binding, ...(session ? { resumeSessionId: session } : {}),
      ...(mode === "fork" ? { forkSession: true, codexForkSupported: true } : {}),
    });
    const args = await bindCodexMcp({ path: spawn.codexMcpBinding!.path, binary: binary!, args: spawn.args, cwd: assigned, env });
    // Both names appear AFTER admission. No second read can close this window.
    writeFileSync(operatorConfig, readFileSync(operatorConfig, "utf8") + registration("added_after_verification"));
    writeFileSync(projectConfig, readFileSync(projectConfig, "utf8") + registration("project_added_after_verification"));
    const actualSession = await nativeExec(args);
    if (mode === "fork") expect(actualSession).not.toBe(session);
    if (mode === "resume" || mode === "retry") expect(actualSession).toBe(session);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.model).toBe("operator-model-pin");
      expect(request.tools.map(tool => tool.name).filter(name => name?.startsWith("mcp__")).sort()).toEqual(["mcp__rex", "mcp__sourcevision"]);
    }
    expect(readdirSync(root)).not.toContain("foreign-starts");
    const servers = projectedServers(args);
    expect(servers.rex.args).toEqual([launcher, "rex", "mcp", assigned]);
    expect(servers.sourcevision.args).toEqual([launcher, "sv", "mcp", assigned]);
    // Positive control proves the trusted project and late registrations can
    // start on this native binary when the production isolation flag is absent.
    if (mode === "fresh") {
      await nativeExec(args.filter(arg => arg !== "--ignore-user-config"));
      expect(readFileSync(marker, "utf8").trim().split("\n").sort()).toEqual([
        "added_after_verification", "project_added_after_verification", "project_foreign",
      ]);
    }
    } finally {
      listener.closeAllConnections();
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
  }, 90000);

  it.each(["fresh", "resume", "fork"])("binds %s to assigned sentinels and confines PRD mutation there", async mode => {
    const before = [anchor, assigned, sibling].map(hashPrd);
    const configBefore = readFileSync(join(env.CODEX_HOME!, "config.toml"), "utf8");
    const spawn = codexCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {
      mcpConfigPath: binding, ...(mode !== "fresh" ? { resumeSessionId: "fixture-thread" } : {}),
      ...(mode === "fork" ? { forkSession: true, codexForkSupported: true } : {}),
    });
    const args = await bindCodexMcp({ path: spawn.codexMcpBinding!.path, binary: binary!, args: spawn.args, cwd: assigned, env });
    expect(args).toContain('model="operator-model-pin"');
    expect(args).toContain('model_provider="operator-provider"');
    expect(args).toContain("features.apps=false");
    expect(args).toContain("features.plugins=false");
    const servers = projectedServers(args);
    expect(Object.keys(servers).sort()).toEqual(["rex", "sourcevision"]);
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
