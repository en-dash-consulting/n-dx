/**
 * A registry saved by an older hub names a binary per project (`ndxBin`). The
 * hub must never spawn it: on start it drops the field, writes the healed
 * registry back, and spawns every project server from its own entry — and a
 * live server that older record left running is replaced, not adopted.
 *
 * Children are the compiled `dist/cli/index.js serve`, so this needs a fresh
 * build (see built-server-guard.ts).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { startHub, isPidAlive, registryPath } from "../../src/hub/index.js";
import type { HubHandle } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const NDX_BIN = join(WEB_PKG, "dist/cli/index.js");

let scratch: string;
let planted: string;
let marker: string;
const hubs: HubHandle[] = [];
const strays: ChildProcess[] = [];

function legacyRecord(id: string, repoRoot: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, repoRoot, worktrees: [repoRoot], ndxBin: planted, port: null, pid: null, lastSeen: null, ...extra };
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not met in time");
}

/** A separate process answering `/api/status` for `dir`, as a server an older hub started would. */
async function startStaleServer(dir: string): Promise<{ child: ChildProcess; port: number }> {
  const script = `
    const http = require("node:http");
    const s = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ projectDir: ${JSON.stringify(dir)} }));
    });
    s.listen(0, "127.0.0.1", () => process.stdout.write(String(s.address().port) + "\\n"));
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  strays.push(child);
  const port = await new Promise<number>((resolvePort, reject) => {
    child.stdout!.once("data", (chunk: Buffer) => resolvePort(parseInt(chunk.toString(), 10)));
    child.once("exit", () => reject(new Error("stale server exited early")));
  });
  return { child, port };
}

beforeAll(() => {
  assertFreshServerBuild();
  scratch = mkdtempSync(join(tmpdir(), "ndx-hub-heal-"));
  marker = join(scratch, "planted-ran");
  // Shaped like an entry the hub would run with Node; proves it ran by leaving a file.
  planted = join(scratch, "planted.js");
  writeFileSync(planted, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
});

afterEach(async () => {
  while (hubs.length) await hubs.pop()!.close({ stopChildren: true });
  for (const child of strays.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("hub registry healing", () => {
  it("spawns its own binary for a record that names another, and saves the registry without it", async () => {
    const home = mkdtempSync(join(scratch, "home-"));
    const repo = mkdtempSync(join(scratch, "repo-"));
    writeFileSync(registryPath(home), JSON.stringify({ version: 1, projects: { alpha: legacyRecord("alpha", repo) } }));

    const logs: string[] = [];
    const hub = await startHub({
      port: 0, homeDir: home, selfBin: NDX_BIN, healthIntervalMs: 60_000,
      supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 },
      log: (m) => logs.push(m),
    });
    hubs.push(hub);

    const res = await fetch(`http://127.0.0.1:${hub.port}/api/hub/projects/alpha`);
    const { project } = await res.json() as { project: { status: { state: string }; port: number; ndxBin?: string } };
    expect(project.status.state).toBe("healthy");
    // The v1 API reports the hub binary; only persistence and input selection are removed.
    expect(project.ndxBin).toBe(NDX_BIN);
    const status = await (await fetch(`http://127.0.0.1:${project.port}/api/status`)).json() as { projectDir: string };
    expect(status.projectDir).toBe(repo);

    expect(existsSync(marker)).toBe(false);
    const saved = readFileSync(registryPath(home), "utf-8");
    expect(saved).not.toContain("ndxBin");
    expect(saved).not.toContain(planted);
    expect(logs.filter((l) => l.includes("alpha") && l.includes("recorded binary"))).toHaveLength(1);
  }, 60_000);

  it("replaces a live server an older record left running instead of adopting it", async () => {
    const home = mkdtempSync(join(scratch, "home-"));
    const repo = mkdtempSync(join(scratch, "repo-"));
    const stale = await startStaleServer(repo);
    writeFileSync(registryPath(home), JSON.stringify({
      version: 1,
      projects: { beta: legacyRecord("beta", repo, { pid: stale.child.pid, port: stale.port }) },
    }));

    const hub = await startHub({
      port: 0, homeDir: home, selfBin: NDX_BIN, healthIntervalMs: 60_000,
      supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 },
    });
    hubs.push(hub);

    await waitFor(() => !isPidAlive(stale.child.pid!));
    const { project } = await (await fetch(`http://127.0.0.1:${hub.port}/api/hub/projects/beta`)).json() as {
      project: { status: { state: string; attached: boolean }; pid: number; port: number };
    };
    expect(project.status.state).toBe("healthy");
    expect(project.status.attached).toBe(false);
    expect(project.pid).not.toBe(stale.child.pid);
    expect(project.port).not.toBe(stale.port);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(registryPath(home), "utf-8")).not.toContain("ndxBin");
  }, 60_000);
});
