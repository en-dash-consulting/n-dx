import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunningDashboard } from "../../e2e-ui/helpers/fixture-project.js";

const mocks = vi.hoisted(() => ({ stop: vi.fn(), killTree: vi.fn() }));
vi.mock("../../e2e-ui/helpers/fixture-project.js", () => ({ stopDashboardAndWait: mocks.stop }));
vi.mock("@n-dx/llm-client", () => ({ terminateProcessTree: mocks.killTree }));

import { stopManualDashboard } from "../../e2e-ui-manual/helpers/stop-dashboard.js";

const proc = { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null };
const dashboard = {
  baseUrl: "http://fixture.local",
  proc,
} as RunningDashboard;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stoppingDashboard(events: string[]): void {
  mocks.stop.mockImplementation(async () => {
    events.push("dashboard stopped");
    proc.exitCode = 0;
  });
  proc.exitCode = null;
}

describe("manual dashboard teardown", () => {
  it("terminates workspace runs and starting executions, then observes them idle before stopping the dashboard", async () => {
    const events: string[] = [];
    const active = new Set(["task / unicode-é", "starting-task"]);
    stoppingDashboard(events);
    const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (options?.method === "POST") {
        const task = decodeURIComponent(path.split("/").at(-2)!);
        events.push(`terminate ${task}`);
        active.delete(task);
        return respond({ terminated: true });
      }
      if (path.endsWith("/execute/status")) {
        return respond({ executions: active.has("starting-task") ? [{ taskId: "starting-task", status: "starting" }] : [] });
      }
      expect(new URL(String(input)).searchParams.has("scope")).toBe(false);
      expect(new URL(String(input)).searchParams.has("limit")).toBe(false);
      events.push(active.size ? "active snapshot" : "idle snapshot");
      return respond({ runs: active.has("task / unicode-é") ? [
        { taskId: "task / unicode-é", status: "running" },
        { taskId: "task / unicode-é", status: "running" },
        { taskId: "already-done", status: "completed" },
      ] : [] });
    });
    vi.stubGlobal("fetch", fetcher);
    await stopManualDashboard(dashboard, { pollIntervalMs: 1 });
    expect(events.filter((x) => x.startsWith("terminate "))).toEqual(expect.arrayContaining([
      "terminate task / unicode-é", "terminate starting-task",
    ]));
    expect(events.filter((x) => x === "terminate task / unicode-é")).toHaveLength(1);
    expect(events.at(-2)).toBe("idle snapshot");
    expect(events.at(-1)).toBe("dashboard stopped");
    expect(mocks.killTree).not.toHaveBeenCalled();
  });

  it("polls after termination instead of assuming a successful POST means the run has stopped", async () => {
    const events: string[] = [];
    stoppingDashboard(events);
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (options?.method === "POST") {
        events.push("terminate");
        return respond({ terminated: true });
      }
      if (String(input).includes("execute/status")) return respond({ executions: [] });
      reads++;
      events.push(reads < 3 ? "still active" : "idle");
      return respond({ runs: reads < 3 ? [{ taskId: "slow-task", status: "running" }] : [] });
    }));
    await stopManualDashboard(dashboard, { pollIntervalMs: 1 });
    expect(reads).toBe(3);
    expect(events.at(-2)).toBe("idle");
    expect(events.at(-1)).toBe("dashboard stopped");
  });

  it("accepts a concurrent completion's 404 only after confirming that no run is active", async () => {
    stoppingDashboard([]);
    let active = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (options?.method === "POST") {
        active = false;
        return respond({ error: "already finished" }, 404);
      }
      if (String(input).includes("execute/status")) return respond({ executions: [] });
      return respond({ runs: active ? [{ taskId: "finished-race", status: "running" }] : [] });
    }));
    await expect(stopManualDashboard(dashboard, { pollIntervalMs: 1 })).resolves.toBeUndefined();
    expect(mocks.killTree).not.toHaveBeenCalled();
  });

  it.each([
    ["an unreadable run list", () => respond({ error: "read failed" }, 500)],
    ["a malformed run list", () => respond({ runs: "invalid" })],
    ["an active run without a task id", () => respond({ runs: [{ status: "running" }] })],
  ])("reports %s and kills the process tree before stopping the parent", async (_label, response) => {
    const events: string[] = [];
    stoppingDashboard(events);
    mocks.killTree.mockImplementation(async () => { events.push("tree killed"); });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
      String(input).includes("execute/status") ? respond({ executions: [] }) : response()));
    await expect(stopManualDashboard(dashboard)).rejects.toThrow();
    expect(events).toEqual(["tree killed", "dashboard stopped"]);
    expect(mocks.killTree).toHaveBeenCalledWith(dashboard.proc, expect.objectContaining({ freeze: true }));
  });

  it("bounds an indefinitely active run and still stops the dashboard", async () => {
    const events: string[] = [];
    stoppingDashboard(events);
    mocks.killTree.mockImplementation(async () => { events.push("tree killed"); });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (options?.method === "POST") return respond({ terminated: true });
      return String(input).includes("execute/status")
        ? respond({ executions: [] })
        : respond({ runs: [{ taskId: "stuck-task", status: "running" }] });
    }));
    await expect(stopManualDashboard(dashboard, { timeoutMs: 20, pollIntervalMs: 1 })).rejects.toThrow(/timed out/i);
    expect(events).toEqual(["tree killed", "dashboard stopped"]);
  });

  it("kills the tree when the idle dashboard ignores its stop signal", async () => {
    stoppingDashboard([]);
    mocks.stop.mockResolvedValue(undefined);
    mocks.killTree.mockImplementation(async () => { proc.signalCode = "SIGKILL"; });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
      String(input).includes("execute/status") ? respond({ executions: [] }) : respond({ runs: [] })));
    await stopManualDashboard(dashboard);
    expect(mocks.killTree).toHaveBeenCalledOnce();
    expect(proc.signalCode).toBe("SIGKILL");
    proc.signalCode = null;
  });

  it("aborts a hung HTTP request instead of leaving teardown pending", async () => {
    stoppingDashboard([]);
    vi.stubGlobal("fetch", vi.fn((_input: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    })));
    await expect(stopManualDashboard(dashboard, { timeoutMs: 20 })).rejects.toThrow(/timeout|timed out/i);
    expect(mocks.killTree).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
