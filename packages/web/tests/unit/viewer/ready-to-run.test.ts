// @vitest-environment jsdom
/**
 * The Work page's Ready to run list: rows in the order returned, resume rows
 * labelled, Prepare…/Resume… and the title opening the modal, Start now (started,
 * queued, refused), Copy terminal command, refresh on run frames — and the
 * Epic-by-Epic panel no longer mounted anywhere.
 *
 * @see src/viewer/components/ready-to-run.ts
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

const live = vi.hoisted(() => ({ refresh: null as (() => void) | null }));
vi.mock("../../../src/viewer/hooks/use-hench-runs-live-refresh.js", () => ({
  useHenchRunsLiveRefresh: (refresh: () => void) => { live.refresh = refresh; },
}));

import { ReadyToRun, readyCommandLine } from "../../../src/viewer/components/ready-to-run.js";

const TASKS = [
  { id: "t-b", title: "Second by priority", status: "pending", priority: "high", parentChain: ["Epic", "Feature"], criteriaCount: 3, resume: false },
  { id: "t-a", title: "Stopped halfway", status: "in_progress", priority: "medium", parentChain: ["Epic"], criteriaCount: 1, resume: true },
];

interface Call { url: string; method: string; body: Record<string, unknown> | null }

let root: HTMLDivElement | undefined;
let calls: Call[];

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(
  tasks: unknown[] = TASKS,
  execute: { status: number; body: unknown } = { status: 200, body: { ok: true } },
) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const answer = url.startsWith("/api/hench/ready")
      ? { status: 200, body: { tasks, limit: 10, dir: "/work/my app" } }
      : execute;
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  }));
  const props = { onPrepare: vi.fn(), onOpenLive: vi.fn(), onOpenPrd: vi.fn() };
  root = renderToDiv(h(ReadyToRun, props));
  await flush();
  return props;
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".ready-row"));
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const byText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;
const openMenu = (row: number) => click(rows()[row].querySelector(".ready-caret")!);

describe("Ready to run", () => {
  it("asks for ten and lists rows in the order returned, resume rows labelled", async () => {
    await mount();
    expect(calls[0].url).toBe("/api/hench/ready?limit=10");
    expect(rows().map((r) => r.querySelector(".ready-title")!.textContent)).toEqual(["Second by priority", "Stopped halfway"]);
    const first = rows()[0].textContent!;
    expect(first).toContain("Epic › Feature");
    expect(first).toContain("high");
    expect(first).toContain("3 criteria");
    expect(first).not.toContain("no live run");
    expect(rows()[1].textContent).toContain("in progress · no live run");
    expect(rows()[1].textContent).toContain("1 criterion");
    expect(rows()[0].querySelector(".prd-status-pending")).not.toBeNull();
    expect(rows()[1].querySelector(".prd-status-in_progress")).not.toBeNull();
  });

  it("marks a row whose task carries saved run settings, with a label not just a dot", async () => {
    // The dot says the task will not run on the project defaults; a screen
    // reader needs the words, so the label carries the meaning.
    await mount([
      { ...TASKS[0], saved: true },
      { ...TASKS[1], saved: false },
      // A server that predates saved settings sends no field at all.
      { id: "t-c", title: "Older server", status: "pending", priority: "low", parentChain: [], criteriaCount: 0, resume: false },
    ]);

    const dots = rows().map((r) => r.querySelector(".ready-saved-dot"));
    expect(dots[0]).not.toBeNull();
    expect(dots[0]!.getAttribute("aria-label")).toBe("Saved run settings");
    expect(dots[1]).toBeNull();
    expect(dots[2]).toBeNull();
  });

  it("labels the primary button Prepare… or Resume… and opens the modal from it and the title", async () => {
    const props = await mount();
    expect(rows()[0].querySelector(".ready-primary")!.textContent).toBe("Prepare…");
    expect(rows()[1].querySelector(".ready-primary")!.textContent).toBe("Resume…");
    await click(rows()[1].querySelector(".ready-primary")!);
    await click(rows()[0].querySelector(".ready-title")!);
    expect(props.onPrepare.mock.calls).toEqual([["t-a"], ["t-b"]]);
  });

  it("Start now posts the task id alone and toasts with a link to Live", async () => {
    const props = await mount();
    await openMenu(0);
    await click(byText("Start now"));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/hench/execute");
    expect(post.body).toEqual({ taskId: "t-b" });
    const toast = document.querySelector(".ready-toast")!;
    expect(toast.textContent).toContain("Started");
    await click(toast.querySelector("a")!);
    expect(props.onOpenLive).toHaveBeenCalledWith("t-b");
  });

  it("Start now shows a queued run with its position, outside the expiring toast", async () => {
    await mount(TASKS, { status: 202, body: { queued: true, position: 2, reason: "at-capacity" } });
    await openMenu(0);
    await click(byText("Start now"));
    expect(document.querySelector(".prep-queued")!.textContent).toContain("Queued — position 2: every run slot on this machine is busy.");
    expect(document.querySelector(".ready-toast")).toBeNull();
  });

  /** Mount with a hub queue answering `hub`, then Start now on the first row (t-b), which the hub queues. */
  async function startNowQueued(extra: Record<string, unknown>) {
    const hub = {
      entries: [], running: 1, freeMemoryBytes: null, limits: { maxSessions: 2, memoryFloorBytes: 0 }, memoryPaused: false, ...extra,
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.startsWith("/api/hench/ready") ? { tasks: TASKS, limit: 10, dir: "/w" }
        : url === "/api/hub/queue" ? hub
        : { queued: true, position: 5, reason: "at-capacity" };
      return { ok: true, status: url === "/api/hench/execute" ? 202 : 200, json: async () => body };
    }));
    root = renderToDiv(h(ReadyToRun, { onPrepare: vi.fn(), onOpenLive: vi.fn(), onOpenPrd: vi.fn() }));
    await flush();
    await openMenu(0);
    await click(byText("Start now"));
    await flush();
    return document.querySelector(".prep-queued")!;
  }
  const hubEntry = { projectId: "p", workspace: null, enqueuedAt: "" };

  it("a queued Start now keeps its position current from the hub queue", async () => {
    const notice = await startNowQueued({ entries: [{ ...hubEntry, taskId: "x" }, { ...hubEntry, taskId: "t-b" }] });
    expect(notice.textContent).toContain("position 2");
  });

  it("a queued Start now says 'Could not start: <reason>' when the hub dropped it at replay", async () => {
    const notice = await startNowQueued({
      dropped: [{ ...hubEntry, taskId: "t-b", droppedAt: "", status: 409, error: "Task is blocked by X." }],
    });
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("Could not start: Task is blocked by X. (HTTP 409)");
  });

  it("Start now shows the refusal message as an alert", async () => {
    await mount(TASKS, { status: 409, body: { error: "Task is already running" } });
    await openMenu(0);
    await click(byText("Start now"));
    const toast = document.querySelector(".ready-toast")!;
    expect(toast.getAttribute("role")).toBe("alert");
    expect(toast.textContent).toBe("Task is already running");
  });

  it("Copy terminal command copies ndx work --task=<id> --auto <dir>", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await mount();
    await openMenu(0);
    await click(byText("Copy terminal command"));
    expect(writeText).toHaveBeenCalledWith("ndx work --task=t-b --auto '/work/my app'");
  });

  it("refetches when the run-frame hook fires", async () => {
    await mount();
    const before = calls.length;
    await act(async () => { live.refresh!(); });
    await flush();
    expect(calls.length).toBe(before + 1);
  });

  it("shows the empty state with a link to the PRD", async () => {
    const props = await mount([]);
    expect(document.querySelector(".ready-empty")!.textContent).toContain("Nothing ready to run");
    await click(document.querySelector(".ready-empty a")!);
    expect(props.onOpenPrd).toHaveBeenCalled();
  });
});

describe("readyCommandLine", () => {
  it("matches the argv execute spawns, quoting only what needs it", () => {
    expect(readyCommandLine("abc", "/p")).toBe("ndx work --task=abc --auto /p");
  });
});

describe("Epic-by-Epic panel", () => {
  /** Every viewer source file that is not the panel itself or a barrel line. */
  function viewerSources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? viewerSources(path) : /\.ts$/.test(name) ? [path] : [];
    });
  }

  it("is mounted nowhere in the viewer", () => {
    const mounts = viewerSources(join(__dirname, "../../../src/viewer"))
      .filter((file) => /h\(\s*ExecutionPanel\b/.test(readFileSync(file, "utf8")));
    expect(mounts).toEqual([]);
  });
});
