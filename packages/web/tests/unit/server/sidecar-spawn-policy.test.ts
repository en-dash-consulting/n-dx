/**
 * A Sidecar session's vendor CLI gets the read-only built-ins, the broker as
 * its only MCP server, the broker's tools pre-approved, and no settings file
 * that could carry a `permissions.allow` rule. Asserted on the argv a real
 * session spawns, fresh and resumed.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startVendorSession, type VendorSessionOptions } from "@n-dx/llm-client";
import { sidecarSessionConnect, type SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;
let spawned: Array<{ binary: string; args: string[] }>;

/** A CLI that names a session and exits; records each spawn's argv. */
const recordingSpawn: NonNullable<VendorSessionOptions["spawn"]> = (binary, args) => {
  spawned.push({ binary, args });
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
  spawned = [];
});

afterEach(async () => {
  await removeTestDir(root);
});

describe("Claude spawn", () => {
  it("allows only Read, Grep and Glob, loads no settings, and names only the broker, on every turn", async () => {
    const dir = join(root, ".hench", "sidecar");
    const connect = sidecarSessionConnect(dir, (id) => ({
      url: `http://127.0.0.1:3117/api/sidecar/sessions/${id}/mcp`,
      headers: { "X-Ndx-Token": "tok", "x-ndx-workspace": "main" },
    }));
    const session = startVendorSession({ ...connect(record("claude")), vendor: "claude", cwd: root, spawn: recordingSpawn });
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
          headers: { "X-Ndx-Token": "tok", "x-ndx-workspace": "main" },
        },
      },
    });
    if (process.platform !== "win32") expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("names no MCP server at all when there is no broker endpoint", () => {
    const dir = join(root, "sidecar");
    const options = sidecarSessionConnect(dir)(record("claude"));
    expect(JSON.parse(readFileSync(options.claude!.mcpConfigPath!, "utf-8"))).toEqual({ mcpServers: {} });
  });
});

describe("Codex spawn", () => {
  it("runs in a read-only sandbox that never asks for approval", async () => {
    const connect = sidecarSessionConnect(join(root, "sidecar"));
    const session = startVendorSession({ ...connect(record("codex")), vendor: "codex", cwd: root, spawn: recordingSpawn });
    await session.sendTurn("one");
    const { args } = spawned[0];
    expect(flagValue(args, "--sandbox")).toBe("read-only");
    expect(flagValue(args, "-c")).toBe("approval_policy=never");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});
