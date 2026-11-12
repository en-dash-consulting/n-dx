/**
 * A Sidecar session's vendor CLI gets the read-only built-ins, the broker as
 * its only MCP server, the broker's tools pre-approved, and no settings file
 * that could carry a `permissions.allow` rule. Asserted on the argv a real
 * session spawns, fresh and resumed.
 */

import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordRepoTrust, startVendorSession, vendorSessionDriver, type VendorSessionOptions } from "@n-dx/llm-client";
import { SidecarSessionRegistry, sidecarSessionConnect, type SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;
let spawned: Array<{ binary: string; args: string[]; env?: NodeJS.ProcessEnv }>;

/** A CLI that names a session and exits; records each spawn's argv and environment. */
const recordingSpawn: NonNullable<VendorSessionOptions["spawn"]> = (binary, args, opts) => {
  spawned.push({ binary, args, env: opts.env });
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null, kill: () => true });
  stdin.on("finish", () => {
    stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "v-1" }) + "\n");
    stdout.write(JSON.stringify({ type: "thread.started", thread_id: "t-1" }) + "\n");
    stdout.end();
    Object.assign(child, { exitCode: 0 });
    setImmediate(() => { child.emit("exit", 0, null); child.emit("close", 0, null); });
  });
  return child as unknown as ChildProcess;
};

function record(vendor: string): SidecarSessionRecord {
  const at = new Date().toISOString();
  return {
    id: "sess-1", scope: "worktree", worktree: root, name: "s", vendor, cursor: 0, turns: 0,
    tokens: { input: 0, output: 0 }, createdAt: at, lastActivityAt: at,
  };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-spawn-"));
  // The repository root: a Codex turn reads project config up to here and no further.
  execFileSync("git", ["init", root], { stdio: "pipe", windowsHide: true });
  vi.stubEnv("NDX_HOME", join(root, "home"));
  spawned = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await removeTestDir(root);
});

describe("Claude spawn", () => {
  it("allows only Read, Grep and Glob, loads no settings, and names only the broker, on every turn", async () => {
    const dir = join(root, ".hench", "sidecar");
    const connect = sidecarSessionConnect(dir, (id) => ({
      url: `http://127.0.0.1:3117/api/sidecar/sessions/${id}/mcp`,
      headers: { "x-ndx-sidecar-key": "key", "x-ndx-workspace": "main" },
    }));
    const session = startVendorSession({ ...await connect(record("claude")), vendor: "claude", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    await session.sendTurn("two");

    expect(spawned).toHaveLength(2);
    for (const { args } of spawned) {
      expect(flagValue(args, "--tools")).toBe("Read,Grep,Glob");
      expect(flagValue(args, "--setting-sources")).toBe("");
      expect(flagValue(args, "--allowed-tools")).toBe("mcp__ndx-sidecar");
      expect(args.filter((a) => a === "--allowed-tools")).toHaveLength(1);
      expect(flagValue(args, "--mcp-config")).toBe(join(dir, "sess-1.mcp.json"));
      expect(args).toContain("--strict-mcp-config");
      expect(args).not.toContain("--disallowedTools");
      expect(args).not.toContain("--settings");
      expect(args).not.toContain("--permission-mode");
    }
    expect(flagValue(spawned[1].args, "--resume")).toBe("v-1");

    const configPath = join(dir, "sess-1.mcp.json");
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({
      mcpServers: {
        "ndx-sidecar": {
          type: "http",
          url: "http://127.0.0.1:3117/api/sidecar/sessions/sess-1/mcp",
          headers: { "x-ndx-sidecar-key": "key", "x-ndx-workspace": "main" },
        },
      },
    });
    if (process.platform !== "win32") expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("names no MCP server at all when there is no broker endpoint", async () => {
    const dir = join(root, "sidecar");
    const options = await sidecarSessionConnect(dir)(record("claude"));
    expect(JSON.parse(readFileSync(options.claude!.mcpConfigPath!, "utf-8"))).toEqual({ mcpServers: {} });
  });
});

describe("hub-scope Claude spawn", () => {
  const hubRecord = (vendor = "claude"): SidecarSessionRecord => ({ ...record(vendor), scope: "hub" });
  const endpoint = (id: string) => ({ url: `http://127.0.0.1:4000/api/sidecar/hub/sessions/${id}/mcp`, headers: { "x-ndx-sidecar-key": "key" } });

  it("gets no built-in tool and only the broker, fresh and resumed", async () => {
    const dir = join(root, "hub", "sidecar");
    const connect = sidecarSessionConnect(dir, endpoint, root);
    const session = startVendorSession({ ...await connect(hubRecord()), vendor: "claude", cwd: dir, spawn: recordingSpawn });
    await session.sendTurn("one");
    await session.sendTurn("two");

    expect(spawned).toHaveLength(2);
    for (const { args } of spawned) {
      // An empty value, never an omitted flag: omitted would mean every built-in.
      expect(flagValue(args, "--tools")).toBe("");
      expect(args.filter((a) => a === "--tools")).toHaveLength(1);
      for (const tool of ["Read", "Grep", "Glob"]) expect(args.join(" ")).not.toContain(tool);
      expect(flagValue(args, "--setting-sources")).toBe("");
      expect(flagValue(args, "--allowed-tools")).toBe("mcp__ndx-sidecar");
      expect(flagValue(args, "--mcp-config")).toBe(join(dir, "sess-1.mcp.json"));
      expect(args).toContain("--strict-mcp-config");
    }
    expect(JSON.parse(readFileSync(join(dir, "sess-1.mcp.json"), "utf-8"))).toEqual({
      mcpServers: { "ndx-sidecar": { type: "http", ...endpoint("sess-1") } },
    });
  });

  it.each(["linux", "win32"] as const)("on %s, keeps the empty tool list and sends the prompt on stdin only", async (platform) => {
    const dir = join(root, "hub", "sidecar");
    const options = await sidecarSessionConnect(dir, endpoint, root)(hubRecord());
    const prompt = "what merges next? (a & b | c)";
    const spawn = vendorSessionDriver("claude")!.turnSpawn(
      { systemPrompt: "SYSTEM", prompt, claude: options.claude },
      platform,
    );
    expect(flagValue(spawn.args, "--tools")).toBe("");
    expect(flagValue(spawn.args, "--allowed-tools")).toBe("mcp__ndx-sidecar");
    expect(spawn.args).not.toContain(prompt);
    expect(spawn.stdin).toContain(prompt);
    if (platform === "win32") {
      // cmd.exe: the system prompt travels on stdin too, and each list is one comma-joined token.
      expect(spawn.args).not.toContain("--system-prompt");
      expect(spawn.stdin.startsWith("SYSTEM")).toBe(true);
      expect(spawn.args.filter((a) => a.startsWith("mcp__"))).toEqual(["mcp__ndx-sidecar"]);
    } else {
      expect(flagValue(spawn.args, "--system-prompt")).toBe("SYSTEM");
      expect(spawn.stdin).toBe(prompt);
    }
  });

  it("refuses to open a hub session on Codex, naming that its sandbox can still read repositories", async () => {
    const connect = sidecarSessionConnect(join(root, "hub", "sidecar"), undefined, root);
    await expect(connect(hubRecord("codex"))).rejects.toThrow(/read-only sandbox can still read repositories/);
  });
});

describe("with an operator's connections declared", () => {
  /** A project whose .n-dx.local.json declares an http and a stdio connection. */
  function declareConnections(): void {
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({
      connections: {
        docs: { transport: "http", url: "http://127.0.0.1:9/docs-mcp", auth: "none" },
        local: { transport: "stdio", command: "local-mcp-server", args: [] },
      },
    }));
  }
  const brokerEndpoint = (id: string) => ({
    url: `http://127.0.0.1:3117/api/sidecar/sessions/${id}/mcp`,
    headers: { "x-ndx-sidecar-key": "key" },
  });

  it("Claude's MCP config still names only the ndx-sidecar broker", async () => {
    declareConnections();
    const dir = join(root, ".hench", "sidecar");
    const session = startVendorSession({ ...await sidecarSessionConnect(dir, brokerEndpoint)(record("claude")), vendor: "claude", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    const config = readFileSync(join(dir, "sess-1.mcp.json"), "utf-8");
    expect(Object.keys(JSON.parse(config).mcpServers)).toEqual(["ndx-sidecar"]);
    expect(flagValue(spawned[0].args, "--allowed-tools")).toBe("mcp__ndx-sidecar");
    for (const text of [config, spawned[0].args.join(" ")]) {
      expect(text).not.toContain("docs-mcp");
      expect(text).not.toContain("local-mcp-server");
    }
  });

  it("Codex's spawn names no connection: no MCP server override and neither server's address", async () => {
    declareConnections();
    const session = startVendorSession({ ...await sidecarSessionConnect(join(root, "sidecar"), brokerEndpoint)(record("codex")), vendor: "codex", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    const { args } = spawned[0];
    expect(args.filter((a) => a.startsWith("mcp_servers.") && !a.startsWith("mcp_servers.ndx-sidecar"))).toEqual([]);
    expect(args.join(" ")).not.toContain("docs-mcp");
    expect(args.join(" ")).not.toContain("local-mcp-server");
  });
});

describe("Codex spawn", () => {
  const KEY = "broker-credential-7f3a";
  const KEY_VAR = "NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY";
  const WORKSPACE_VAR = "NDX_SIDECAR_HEADER_X_NDX_WORKSPACE";
  const URL = "http://127.0.0.1:3117/api/sidecar/sessions/sess-1/mcp";
  const endpoint = (id: string) => ({
    url: `http://127.0.0.1:3117/api/sidecar/sessions/${id}/mcp`,
    headers: { "x-ndx-sidecar-key": KEY, "x-ndx-workspace": "main" },
  });

  /** The `-c` values of an argv. */
  const overrides = (args: string[]) => args.filter((_a, i) => args[i - 1] === "-c");

  async function twoTurns(connect: ReturnType<typeof sidecarSessionConnect>): Promise<void> {
    const session = startVendorSession({ ...await connect(record("codex")), vendor: "codex", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    await session.sendTurn("two");
    expect(spawned).toHaveLength(2);
  }

  it("runs in a read-only sandbox that never asks for approval, fresh and resumed", async () => {
    await twoTurns(sidecarSessionConnect(join(root, "sidecar")));
    const [fresh, resumed] = spawned.map((s) => s.args);
    expect(flagValue(fresh, "--sandbox")).toBe("read-only");
    expect(overrides(fresh)).toContain("approval_policy=never");
    expect(fresh).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    // `exec resume` rejects --sandbox, and the thread does not keep its
    // starting policy: the resumed turn re-applies it as overrides.
    expect(resumed.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(resumed).not.toContain("--sandbox");
    expect(overrides(resumed)).toEqual(expect.arrayContaining(['sandbox_mode="read-only"', 'approval_policy="never"']));
  });

  it("carries the broker on every turn through -c flags, its credential only in the child's environment", async () => {
    const dir = join(root, ".hench", "sidecar");
    await twoTurns(sidecarSessionConnect(dir, endpoint, undefined, () => 7_200_000));

    const [fresh, resumed] = spawned;
    expect(fresh.args.slice(0, 2)).toEqual(["exec", "--ignore-user-config"]);
    expect(resumed.args.slice(0, 3)).toEqual(["exec", "resume", "--ignore-user-config"]);
    expect(resumed.args).toContain("t-1");
    for (const { args, env } of spawned) {
      expect(overrides(args)).toEqual(expect.arrayContaining([
        "features.apps=false",
        "features.shell_snapshot=false",
        `mcp_servers.ndx-sidecar.url="${URL}"`,
        "mcp_servers.ndx-sidecar.required=true",
        "mcp_servers.ndx-sidecar.startup_timeout_sec=30",
        // The idle window, 2 h, in whole seconds.
        "mcp_servers.ndx-sidecar.tool_timeout_sec=7200",
        `mcp_servers.ndx-sidecar.env_http_headers={"x-ndx-sidecar-key"="${KEY_VAR}", "x-ndx-workspace"="${WORKSPACE_VAR}"}`,
        // The agent's commands read the header variables empty.
        `shell_environment_policy.set.${KEY_VAR}=''`,
        `shell_environment_policy.set.${WORKSPACE_VAR}=''`,
      ]));
      expect(args.join(" ")).not.toContain(KEY);
      expect(env?.[KEY_VAR]).toBe(KEY);
      expect(env?.[WORKSPACE_VAR]).toBe("main");
    }
    expect(process.env[KEY_VAR]).toBeUndefined();

    // The MCP config file a Codex session could read names no server.
    const config = readFileSync(join(dir, "sess-1.mcp.json"), "utf-8");
    expect(JSON.parse(config)).toEqual({ mcpServers: {} });
    expect(config).not.toContain(KEY);
  });

  it("follows a saved idle window for the tool timeout", async () => {
    await twoTurns(sidecarSessionConnect(join(root, "sidecar"), endpoint, undefined, () => 90_500));
    for (const { args } of spawned) expect(overrides(args)).toContain("mcp_servers.ndx-sidecar.tool_timeout_sec=91");
  });

  it("without a broker endpoint, names no MCP server but still skips the user config and both features", async () => {
    await twoTurns(sidecarSessionConnect(join(root, "sidecar")));
    for (const { args, env } of spawned) {
      expect(args).toContain("--ignore-user-config");
      expect(overrides(args)).toEqual(expect.arrayContaining(["features.apps=false", "features.shell_snapshot=false"]));
      expect(overrides(args).filter((o) => o.startsWith("mcp_servers."))).toEqual([]);
      expect(env?.[KEY_VAR]).toBeUndefined();
    }
  });

  it("turns off every project MCP server but the broker, re-reading the project config for each turn", async () => {
    mkdirSync(join(root, ".codex"));
    const config = join(root, ".codex", "config.toml");
    writeFileSync(config, [
      "[mcp_servers.rex]", 'command = "ndx"', 'args = ["rex", "mcp", "."]',
      "[mcp_servers.sourcevision]", 'command = "ndx"', 'args = ["sv", "mcp", "."]',
      "[mcp_servers.ndx-sidecar]", 'url = "http://elsewhere"',
    ].join("\n"));
    const session = startVendorSession({ ...await sidecarSessionConnect(join(root, "sidecar"), endpoint)(record("codex")), vendor: "codex", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    writeFileSync(config, '[mcp_servers.rex]\ncommand = "ndx"\n[mcp_servers.docs]\nurl = "u"\n');
    await session.sendTurn("two");

    // Each server's override is a complete disabled entry: valid whether or
    // not Codex loads the project file (0.166.0 skips it under --ignore-user-config).
    const project = (args: string[]) => overrides(args).filter((o) => o.startsWith("mcp_servers.") && !o.startsWith("mcp_servers.ndx-sidecar."));
    const [fresh, resumed] = spawned.map((s) => project(s.args));
    expect(fresh).toEqual([
      "mcp_servers.rex.enabled=false", 'mcp_servers.rex.command="ndx-sidecar-disabled"',
      "mcp_servers.sourcevision.enabled=false", 'mcp_servers.sourcevision.command="ndx-sidecar-disabled"',
    ]);
    expect(resumed).toEqual([
      "mcp_servers.rex.enabled=false", 'mcp_servers.rex.command="ndx-sidecar-disabled"',
      "mcp_servers.docs.enabled=false", 'mcp_servers.docs.url="http://127.0.0.1:9/ndx-sidecar-disabled"',
    ]);
    // The broker's own entry is untouched: its url is the session endpoint.
    expect(overrides(spawned[0].args)).toContain(`mcp_servers.ndx-sidecar.url="${URL}"`);
    expect(overrides(spawned[0].args).filter((o) => o.startsWith("mcp_servers.ndx-sidecar.enabled"))).toEqual([]);
    expect(spawned[1].args.slice(0, 2)).toEqual(["exec", "resume"]);
  });

  it.each([
    ["neither command nor url", '[mcp_servers.half]\nargs = ["x"]\n'],
    ["both command and url", '[mcp_servers.half]\ncommand = "x"\nurl = "https://x"\n'],
  ])("refuses a turn when a project server declares %s, naming the file and the server, and spawns nothing", async (found, text) => {
    mkdirSync(join(root, ".codex"));
    const config = join(root, ".codex", "config.toml");
    writeFileSync(config, text);
    const session = startVendorSession({ ...await sidecarSessionConnect(join(root, "sidecar"), endpoint)(record("codex")), vendor: "codex", cwd: root, spawn: recordingSpawn });
    const turn = session.sendTurn("one");
    await expect(turn).rejects.toThrow(config);
    await expect(turn).rejects.toThrow(`"half" with ${found}`);
    expect(spawned).toEqual([]);
  });

  it("refuses a turn, naming the file, when a project config cannot be read with confidence, and spawns nothing", async () => {
    mkdirSync(join(root, "pkg", ".codex"), { recursive: true });
    const config = join(root, "pkg", ".codex", "config.toml");
    writeFileSync(config, '[mcp_servers.rex]\ncommand = "ndx\n');
    const session = startVendorSession({ ...await sidecarSessionConnect(join(root, "sidecar"), endpoint)({ ...record("codex"), worktree: join(root, "pkg") }), vendor: "codex", cwd: root, spawn: recordingSpawn });
    await expect(session.sendTurn("one")).rejects.toThrow(config);
    expect(spawned).toEqual([]);
  });

  it.each(["a.b", "my server"])("refuses a turn when a project server is named %j, naming the file and the server, and spawns nothing", async (name) => {
    mkdirSync(join(root, ".codex"));
    const config = join(root, ".codex", "config.toml");
    writeFileSync(config, `[mcp_servers.rex]\ncommand = "ndx"\n[mcp_servers.${JSON.stringify(name)}]\ncommand = "x"\n`);
    const session = startVendorSession({ ...await sidecarSessionConnect(join(root, "sidecar"), endpoint)(record("codex")), vendor: "codex", cwd: root, spawn: recordingSpawn });
    const turn = session.sendTurn("one");
    await expect(turn).rejects.toThrow(config);
    await expect(turn).rejects.toThrow(JSON.stringify(name));
    expect(spawned).toEqual([]);
  });

  it("a Claude session's environment gets no broker header variable", async () => {
    const session = startVendorSession({ ...await sidecarSessionConnect(join(root, "sidecar"), endpoint)(record("claude")), vendor: "claude", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    expect(spawned[0].env?.[KEY_VAR]).toBeUndefined();
    expect(spawned[0].args).not.toContain("--ignore-user-config");
  });
});


describe.each(["codex", "claude"] as const)("%s executable selection", (vendor) => {
  function config(path: string, local = false, legacy = false): void {
    writeFileSync(join(root, local ? ".n-dx.local.json" : ".n-dx.json"), JSON.stringify(
      legacy ? { claude: { cli_path: path } } : { llm: { [vendor]: { cli_path: path } } },
    ));
  }

  async function assertSpawns(binary: string, hub = false): Promise<void> {
    const current = { ...record(vendor), ...(hub && { scope: "hub" as const, worktree: join(root, "hub") }) };
    const dir = join(root, "sidecar");
    const connect = sidecarSessionConnect(dir, undefined, hub ? root : undefined);
    const options = { dir, connect: async (record: SidecarSessionRecord) => ({ ...await connect(record), spawn: recordingSpawn }) };
    const first = new SidecarSessionRegistry(options);
    const { id } = first.create(current);
    expect((await first.sendTurn(id, "fresh")).status).toBe("completed");
    expect((await first.sendTurn(id, "continued")).status).toBe("completed");
    const resumeId = first.get(id)!.resumeId;
    expect(resumeId).toBe(vendor === "codex" ? "t-1" : "v-1");
    const restarted = new SidecarSessionRegistry(options);
    expect(restarted.get(id)?.resumeId).toBe(resumeId);
    expect((await restarted.sendTurn(id, "after restart")).status).toBe("completed");
    expect(spawned.map((call) => call.binary)).toEqual([binary, binary, binary]);
    expect(spawned[1].args).toContain(resumeId);
    expect(spawned[2].args).toContain(resumeId);
  }

  beforeEach(() => {
    const pathDir = join(root, "path-bin");
    mkdirSync(pathDir);
    writeFileSync(join(pathDir, process.platform === "win32" ? `${vendor}.cmd` : vendor),
      process.platform === "win32" ? "@exit /b 81\r\n" : "#!/bin/sh\nexit 81\n", { mode: 0o755 });
    vi.stubEnv("PATH", `${pathDir}${delimiter}${process.env.PATH}`);
  });

  it("uses an operator's untracked local path ahead of a competing PATH binary", async () => {
    const binary = join(root, "operator-chosen-cli");
    config(join(root, "untrusted-project-cli"));
    config(binary, true);
    await assertSpawns(binary);
  });

  it("uses the trusted project path, with the local path taking precedence", async () => {
    const project = join(root, "project-cli");
    config(project);
    execFileSync("git", ["add", "--", ".n-dx.json"], { cwd: root, windowsHide: true });
    recordRepoTrust(root);
    await assertSpawns(project);
    spawned = [];
    const local = join(root, "local-cli");
    config(local, true);
    await assertSpawns(local);
  });

  it("ignores untrusted project and tracked local paths and retains PATH discovery", async () => {
    config(join(root, "repository-cli"));
    config(join(root, "shipped-local-cli"), true);
    execFileSync("git", ["add", "--", ".n-dx.json", ".n-dx.local.json"], { cwd: root, windowsHide: true });
    await assertSpawns(vendor);
    spawned = [];
    recordRepoTrust(root);
    await assertSpawns(join(root, "shipped-local-cli"));
  });

  it("retains the bare command for PATH discovery without explicit config", async () => {
    await assertSpawns(vendor);
  });

  if (vendor === "claude") {
    it("honors the host project's legacy Claude path for hub sessions", async () => {
      const binary = join(root, "legacy-claude");
      config(binary, true, true);
      await assertSpawns(binary, true);
    });
  }
});
