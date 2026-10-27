/** Real process lifetime check; the agent/vendor stand-ins never call an LLM. */
import { spawn, type ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { terminateProcessTree } from "@n-dx/llm-client";
import type { RunningDashboard } from "../e2e-ui/helpers/fixture-project.js";
import { stopManualDashboard } from "../e2e-ui-manual/helpers/stop-dashboard.js";

interface Ready {
  port: number;
  agentPid: number;
  vendorPid: number;
}

// No detached groups: this is the topology in the manual suite. On Windows
// killing the dashboard alone is not a portable child-tree termination plan.
const AGENT = `
  const { spawn } = require('node:child_process');
  const vendor = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  process.on('SIGTERM', () => {
    vendor.once('exit', () => process.exit(0));
    vendor.kill('SIGTERM');
  });
  process.send({ vendorPid: vendor.pid });
`;
const DASHBOARD = `
  const { spawn } = require('node:child_process');
  const { createServer } = require('node:http');
  const agent = spawn(process.execPath, ['-e', ${JSON.stringify(AGENT)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let active = true;
  let terminated = false;
  agent.on('exit', () => { active = false; });
  agent.once('message', ({ vendorPid }) => {
    const server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/hench/execute/status') return res.end(JSON.stringify({ executions: [] }));
      if (req.url === '/api/hench/runs') return res.end(JSON.stringify({ runs: active ? [{ taskId: 'interrupted-task', status: 'running' }] : [] }));
      if (req.url === '/api/hench/execute/interrupted-task/terminate' && req.method === 'POST') {
        if (process.env.CLEANUP_API_FAIL === '1') {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: 'injected termination failure' }));
        }
        if (active) {
          await new Promise(resolve => { agent.once('exit', resolve); agent.kill('SIGTERM'); });
        }
        terminated = true;
        return res.end(JSON.stringify({ terminated: true }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    process.on('SIGTERM', () => {
      // A failing helper cannot pass by relying on an automatic shutdown
      // sweep: this stand-in deliberately leaves active children alone.
      process.exit(terminated ? 0 : 2);
    });
    server.on('error', () => {
      // Binding can be refused by the host. Do not orphan the stand-ins
      // before the parent has received their PIDs in the ready message.
      agent.once('exit', () => process.exit(1));
      agent.kill('SIGTERM');
    });
    server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port, agentPid: agent.pid, vendorPid }));
  });
`;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function startDashboard(apiFails: boolean): Promise<{ proc: ChildProcess; ready: Ready }> {
  const proc = spawn(process.execPath, ["-e", DASHBOARD], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, CLEANUP_API_FAIL: apiFails ? "1" : "0" },
    windowsHide: true,
  });
  const stderr: string[] = [];
  proc.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    const ready = await new Promise<Ready>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Dashboard stand-in never became ready: ${stderr.join("")}`)), 15_000);
      proc.once("message", (message) => { clearTimeout(timer); resolve(message as Ready); });
      proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Dashboard stand-in exited ${code}: ${stderr.join("")}`)); });
      proc.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    return { proc, ready };
  } catch (error) {
    await terminateProcessTree(proc, { freeze: true });
    throw error;
  }
}

describe("manual flow interrupted during an agent run", () => {
  it.each([false, true])("leaves no agent or vendor child alive (termination API fails: %s)", async (apiFails) => {
    const { proc, ready } = await startDashboard(apiFails);
    try {
      expect(alive(ready.agentPid)).toBe(true);
      expect(alive(ready.vendorPid)).toBe(true);
      const stopping = stopManualDashboard({
        proc, baseUrl: `http://127.0.0.1:${ready.port}`, port: ready.port, stdout: [], stderr: [],
      } satisfies RunningDashboard, { pollIntervalMs: 1 });
      if (apiFails) await expect(stopping).rejects.toThrow(/HTTP 500/);
      else await stopping;
      expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
      await vi.waitFor(() => {
        expect(alive(ready.agentPid)).toBe(false);
        expect(alive(ready.vendorPid)).toBe(false);
      }, { timeout: 10_000 });
      if (!apiFails) expect(proc.exitCode).toBe(0);
    } finally {
      await terminateProcessTree(proc, { freeze: true });
      // Only our two known child PIDs, retained even if a broken helper has
      // already killed their parent and destroyed the parentage relation.
      for (const pid of [ready.vendorPid, ready.agentPid]) {
        if (alive(pid)) {
          try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
        }
      }
      await vi.waitFor(() => expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true), { timeout: 10_000 });
    }
  });
});
