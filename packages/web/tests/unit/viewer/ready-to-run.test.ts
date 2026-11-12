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
import { resetImpactCacheForTests } from "../../../src/viewer/components/impact-tags.js";

const TASKS = [
  { id: "t-b", title: "Second by priority", status: "pending", priority: "high", parentChain: ["Epic", "Feature"], criteriaCount: 3, resume: false },
  { id: "t-a", title: "Stopped halfway", status: "in_progress", priority: "medium", parentChain: ["Epic"], criteriaCount: 1, resume: true },
];

/** The server's page of `tasks` that `url` asks for. */
function readyPage(tasks: unknown[], url: string) {
  const q = new URL(url, "http://x").searchParams;
  const all = q.get("all") === "1";
  const limit = all ? tasks.length : Number(q.get("limit")), offset = all ? 0 : Number(q.get("offset"));
  return { tasks: tasks.slice(offset, offset + limit), total: tasks.length, limit, offset, dir: "/work/my app" };
}

interface Call { url: string; method: string; body: Record<string, unknown> | null }

let root: HTMLDivElement | undefined;
let calls: Call[];

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  resetImpactCacheForTests();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(
  tasks: unknown[] = TASKS,
  execute: { status: number; body: unknown } = { status: 200, body: { ok: true } },
  impact: Record<string, unknown> = {},
) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const answer = url.startsWith("/api/hench/ready")
      ? { status: 200, body: readyPage(tasks, url) }
      : url === "/api/rex/impact"
        ? { status: 200, body: { items: impact } }
        : url === "/api/hench/execute" ? execute
          : { status: 404, body: { error: `Unexpected route: ${url}` } };
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
  it("asks for the first page and lists rows in the order returned, resume rows labelled", async () => {
    await mount();
    expect(calls[0].url).toBe("/api/hench/ready?limit=50&offset=0");
    expect(calls.filter((c) => c.url.startsWith("/api/hench/ready"))).toHaveLength(1);
    expect(calls.filter((c) => c.url === "/api/rex/impact")).toHaveLength(1);
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
      const answer = url.startsWith("/api/hench/ready") ? { status: 200, body: readyPage(TASKS, url) }
        : url === "/api/rex/impact" ? { status: 200, body: { items: {} } }
        : url === "/api/hub/queue" ? { status: 200, body: hub }
        : url === "/api/hench/execute" ? { status: 202, body: { queued: true, position: 5, reason: "at-capacity" } }
        : { status: 404, body: { error: `Unexpected route: ${url}` } };
      return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
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

  it("leads with the plain-language summary, keeping the technical title as its tooltip", async () => {
    await mount([{ ...TASKS[0], summary: "Lets team leads see the next work at a glance" }, TASKS[1]]);
    const [first, second] = rows().map((r) => r.querySelector<HTMLButtonElement>(".ready-title")!);
    expect(first!.textContent).toBe("Lets team leads see the next work at a glance");
    expect(first!.title).toBe("Second by priority");
    expect(second!.textContent).toBe("Stopped halfway");
    expect(second!.title).toBe("");
  });

  it("tags a row with its impact: security, essential and size, files in the tooltip", async () => {
    await mount(TASKS, undefined, {
      "t-b": { basis: "expected", files: ["a.ts", "config/.env"], fileCount: 2, size: "small", kinds: { code: 1, config: 1 }, security: ["config/.env"], essential: [] },
    });
    const tags = () => Array.from(rows()[0].querySelectorAll<HTMLElement>(".impact-tag"));
    expect(tags().map((t) => t.textContent)).toEqual(["Security", "Small · ~2 files"]);
    expect(tags()[0].title).toContain("config/.env");
    expect(tags()[1].title).toBe("Estimated from the files this item names:\na.ts\nconfig/.env");
    expect(rows()[1].querySelector(".impact-tag")).toBeNull();
  });

  it("shows the empty state with a link to the PRD", async () => {
    const props = await mount([]);
    expect(document.querySelector(".ready-empty")!.textContent).toContain("Nothing ready to run");
    await click(document.querySelector(".ready-empty a")!);
    expect(props.onOpenPrd).toHaveBeenCalled();
  });
});

describe("Ready to run: every task, search and filters", () => {
  const PRIORITIES = ["critical", "high", "medium", "low"];
  /** 120 tasks over 4 changes, priorities cycling, every 7th tagged "web", the last one low priority. */
  const MANY = Array.from({ length: 120 }, (_, i) => ({
    id: `t${i}`,
    title: `Task number ${i}`,
    status: "pending",
    priority: PRIORITIES[i % 4],
    parentChain: [`Change ${i % 4}`],
    change: { id: `c${i % 4}`, title: `Change ${i % 4}` },
    tags: i % 7 === 0 ? ["web"] : [],
    criteriaCount: 1,
    resume: false,
  }));

  const type = async (el: HTMLInputElement, value: string) => {
    await act(async () => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await flush();
  };
  const choose = async (label: string, value: string) => {
    const el = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
  };
  const titles = () => rows().map((r) => r.querySelector(".ready-title")!.textContent);

  it("shows the top rows, then every task, low priority included, with Show all N", async () => {
    await mount(MANY);
    expect(rows()).toHaveLength(10);
    await click(byText("Show all 120"));
    expect(rows()).toHaveLength(120);
    expect(titles()).toContain("Task number 119");
    expect(rows().some((r) => r.textContent!.includes("low"))).toBe(true);
    // One request for the whole list, not a page at a time.
    expect(calls.filter((c) => c.url.startsWith("/api/hench/ready")).map((c) => c.url)).toEqual([
      "/api/hench/ready?limit=50&offset=0",
      "/api/hench/ready?all=1",
    ]);
    await click(byText("Show top 10"));
    expect(rows()).toHaveLength(10);
  });

  it("a live refresh while expanded issues one ready request", async () => {
    await mount(MANY);
    await click(byText("Show all 120"));
    const before = calls.length;
    await act(async () => { live.refresh!(); });
    await flush();
    expect(calls.slice(before).map((c) => c.url)).toEqual(["/api/hench/ready?all=1"]);
    expect(rows()).toHaveLength(120);
  });

  it("retries an incomplete queue when Show all is reopened after a failed fetch, then reuses the complete snapshot", async () => {
    await mount(MANY);
    const fetchReady = vi.mocked(fetch);
    fetchReady.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await click(byText("Show all 120"));
    expect(rows()).toHaveLength(50);
    await click(byText("Show top 10"));
    expect(rows()).toHaveLength(10);
    expect(fetchReady.mock.calls.filter(([url]) => String(url).startsWith("/api/hench/ready"))).toHaveLength(2);
    await click(byText("Show all 120"));
    expect(rows()).toHaveLength(120);
    expect(titles()).toContain("Task number 119");
    // The rejected request bypasses mount's route recorder, but still counts here.
    const readyUrls = () => fetchReady.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/hench/ready"));
    expect(readyUrls()).toEqual([
      "/api/hench/ready?limit=50&offset=0", "/api/hench/ready?all=1", "/api/hench/ready?all=1",
    ]);
    await type(document.querySelector<HTMLInputElement>(".ready-search")!, "number 119");
    expect(titles()).toEqual(["Task number 119"]);
    await click(byText("Clear"));
    await click(byText("Show top 10"));
    await click(byText("Show all 120"));
    expect(rows()).toHaveLength(120);
    expect(readyUrls()).toHaveLength(3);
  });

  it("retries an incomplete search on the next input after a failed full-queue fetch", async () => {
    await mount(MANY);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const search = document.querySelector<HTMLInputElement>(".ready-search")!;
    await type(search, "number 119");
    expect(rows()).toHaveLength(0);
    await type(search, "119");
    expect(titles()).toEqual(["Task number 119"]);
    expect(document.querySelector(".ready-count")!.textContent).toBe("1 of 120 match");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/hench/ready?all=1")).toHaveLength(2);
  });

  it("shares an in-flight full-queue attempt across controls", async () => {
    await mount(MANY);
    let resolveFull!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFull = resolve; }));
    await click(byText("Show all 120"));
    await type(document.querySelector<HTMLInputElement>(".ready-search")!, "number 119");
    await choose("Any priority", "low");
    expect(rows()).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/hench/ready?all=1")).toHaveLength(1);
    await act(async () => { resolveFull(new Response(JSON.stringify(readyPage(MANY, "/api/hench/ready?all=1")))); });
    await flush();
    expect(titles()).toEqual(["Task number 119"]);
    expect(document.querySelector(".ready-count")!.textContent).toBe("1 of 120 match");
  });

  it.each(["expand", "search"])("loads the full queue when a pending page outgrows the cached queue during %s", async (control) => {
    const tasks = MANY.slice(0, 30);
    await mount(tasks);
    tasks.push(...MANY.slice(30));
    const respond = vi.mocked(fetch).getMockImplementation()!;
    let allowFull!: () => void;
    const fullGate = new Promise<void>((resolve) => { allowFull = resolve; });
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      // Keep any full reply behind the older page so this tests the skipped
      // upgrade, independently of out-of-order response handling.
      if (url === "/api/hench/ready?all=1") await fullGate;
      return respond(url, init);
    });
    let resolvePage!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePage = resolve; }));
    await act(async () => { live.refresh!(); });
    await flush();
    if (control === "expand") await click(byText("Show all 30"));
    else await type(document.querySelector<HTMLInputElement>(".ready-search")!, "number 119");
    await act(async () => { resolvePage(new Response(JSON.stringify(readyPage(tasks, "/api/hench/ready?limit=50&offset=0")))); });
    await flush();
    await act(async () => { allowFull(); });
    await flush();
    expect(titles()).toContain("Task number 119");
    expect(rows()).toHaveLength(control === "expand" ? 120 : 1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/hench/ready?all=1")).toHaveLength(1);
  });

  it("names each row's change", async () => {
    await mount([{ ...MANY[1], parentChain: [] }]);
    expect(rows()[0].querySelector(".ready-change")!.textContent).toBe("Change 1");
  });

  it("the search narrows by title, change and tag", async () => {
    await mount(MANY);
    const search = document.querySelector<HTMLInputElement>(".ready-search")!;
    await type(search, "number 119");
    expect(titles()).toEqual(["Task number 119"]);
    await type(search, "change 2");
    expect(rows()).toHaveLength(30);
    await type(search, "WEB");
    expect(rows()).toHaveLength(18);
    await type(search, "no such thing");
    expect(document.querySelector(".ready-empty")!.textContent).toBe("No ready task matches.");
  });

  it("the priority, change and tag filters narrow the list and combine", async () => {
    await mount(MANY);
    await choose("Any priority", "low");
    expect(rows()).toHaveLength(30);
    expect(rows().every((r) => r.querySelector(".prd-priority-low"))).toBe(true);
    await choose("Any change", "c3");
    expect(rows()).toHaveLength(30);
    await choose("Any priority", "critical");
    expect(rows()).toHaveLength(0);
    await choose("Any priority", "");
    await choose("Any change", "");
    await choose("Any tag", "web");
    expect(rows()).toHaveLength(18);
    expect(document.querySelector(".ready-count")!.textContent).toBe("18 of 120 match");
    await click(byText("Clear"));
    expect(rows()).toHaveLength(10);
  });

  it("Start now on a row past the top rows starts that task", async () => {
    await mount(MANY);
    await click(byText("Show all 120"));
    await openMenu(115);
    await click(byText("Start now"));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ taskId: "t115" });
  });

  it("searches visible summaries across the full queue and retains technical titles, change identity and impacts", async () => {
    const tasks = MANY.map((t) => ({ ...t, summary: `Readable work ${t.id}`, change: { ...t.change!, title: "Same change title" } }));
    const impact = {
      t119: { basis: "expected", files: ["config/.env", "core.ts"], fileCount: 2, size: "small", kinds: { config: 1, code: 1 }, security: ["config/.env"], essential: ["core.ts"] },
    };
    const props = await mount(tasks, undefined, impact);
    expect(rows()).toHaveLength(10);
    expect(rows()[0].querySelector<HTMLButtonElement>(".ready-title")!.title).toBe("Task number 0");
    await type(document.querySelector<HTMLInputElement>(".ready-search")!, "Readable work t119");
    expect(titles()).toEqual(["Readable work t119"]);
    const row = rows()[0];
    expect(row.dataset.taskId).toBe("t119");
    expect(row.querySelector<HTMLButtonElement>(".ready-title")!.title).toBe("Task number 119");
    expect(Array.from(row.querySelectorAll<HTMLElement>(".impact-tag")).map((t) => t.textContent)).toEqual(["Security", "Essential", "Small · ~2 files"]);
    expect(row.querySelector<HTMLElement>(".impact-security")!.title).toContain("config/.env");
    expect(document.querySelector(".ready-count")!.textContent).toBe("1 of 120 match");
    await click(row.querySelector(".ready-primary")!);
    await click(row.querySelector(".ready-title")!);
    expect(props.onPrepare.mock.calls).toEqual([["t119"], ["t119"]]);
    await openMenu(0);
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)).toEqual(["Start now", "Copy terminal command"]);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // The technical title remains searchable even though the summary is displayed.
    await type(document.querySelector<HTMLInputElement>(".ready-search")!, "Task number 119");
    expect(titles()).toEqual(["Readable work t119"]);
    // Equal change titles still filter by identity, including rows beyond the first page.
    await choose("Any change", "c2");
    expect(rows()).toHaveLength(0);
    await choose("Any change", "c3");
    await choose("Any priority", "low");
    expect(titles()).toEqual(["Readable work t119"]);
    await click(byText("Clear"));
    await click(byText("Show all 120"));
    expect(rows()).toHaveLength(120);
    expect(rows()[119].querySelector(".impact-essential")).not.toBeNull();
    expect(calls.filter((c) => c.url.startsWith("/api/hench/ready")).map((c) => c.url)).toEqual([
      "/api/hench/ready?limit=50&offset=0", "/api/hench/ready?all=1",
    ]);
    expect(calls.filter((c) => c.url === "/api/rex/impact")).toHaveLength(1);
    await click(byText("Show top 10"));
    // A run removes a task from the queue; refresh must replace the cached rows.
    tasks.splice(0, 1);
    const before = calls.length;
    await act(async () => { live.refresh!(); });
    await flush();
    expect(calls.slice(before).map((c) => c.url)).toEqual(["/api/hench/ready?all=1"]);
    expect(rows()).toHaveLength(10);
    expect(rows()[0].dataset.taskId).toBe("t1");
    expect(document.querySelector(".ready-count")!.textContent).toBe("10 of 119");
    await click(byText("Show all 119"));
    expect(rows().map((r) => r.dataset.taskId)).toEqual(tasks.map((t) => t.id));
    expect(rows()[118].querySelector(".impact-essential")).not.toBeNull();
    expect(calls.slice(before).map((c) => c.url)).toEqual(["/api/hench/ready?all=1"]);
  });

  it("offers no controls when the whole list fits", async () => {
    await mount();
    expect(document.querySelector(".ready-controls")).toBeNull();
    expect(document.querySelector(".ready-more")).toBeNull();
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
