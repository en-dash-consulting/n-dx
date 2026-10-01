// @vitest-environment jsdom
/**
 * The Log tab: its pure reading (live-log-model.ts) — classes, turns, filters,
 * search over the whole log, windowing — and what it renders: only the window
 * is in the DOM, filters and search reach lines outside it, following pauses
 * when the operator scrolls up, and Download returns the complete file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { LiveTaskRun } from "../../../src/viewer/hooks/use-live-task.js";
import { LogTab } from "../../../src/viewer/views/live-log.js";
import {
  LogBuffer,
  ROW_HEIGHT,
  filterIndices,
  positionOfTurn,
  scrollTopFor,
  searchMatches,
  splitMatches,
  startedLine,
  stripAnsi,
  windowRange,
} from "../../../src/viewer/views/live-log-model.js";

const ESC = String.fromCharCode(27);

const SAMPLE = [
  "  [Task]     Fix the thing",
  "  [Agent]    I will read the file",
  "  [Tool]     read_file({\"path\":\"a.ts\"})",
  "  [Result]   ok",
  "  [Agent]    Now edit",
  "  its second line",
  "  [Agent]    Still the same turn",
  "  [Tool]     write_file({})",
  "  [Retry]    retry 1/3: API returned 529",
  "  [Test Gate] running tests",
  "  [Warning]  slow response",
  "",
].join("\n");

function buffer(text = SAMPLE): LogBuffer {
  const b = new LogBuffer();
  b.append(text);
  return b;
}

describe("reading a log", () => {
  it("classes lines by label and lets unlabelled lines continue the one above", () => {
    const b = buffer();
    expect(b.lines.map((l) => l.cls)).toEqual([
      "plain", "turn", "tool", "tool", "turn", "turn", "turn", "tool", "gate", "test", "error",
    ]);
    expect(b.lines[5]!.label).toBe("Agent");
  });

  it("starts a turn at the first Agent line after anything else", () => {
    const b = buffer();
    expect(b.lines.filter((l) => l.turnStart).map((l) => [l.n, l.turn])).toEqual([[2, 1], [5, 2]]);
    expect(b.turns).toBe(2);
  });

  it("holds a line that arrives in pieces until it is finished, and keeps the raw text", () => {
    const b = new LogBuffer();
    b.append("  [Tool]     rea");
    expect(b.lines).toHaveLength(0);
    b.append("d\n  [Res");
    expect(b.lines.map((l) => l.text)).toEqual(["  [Tool]     read"]);
    b.append("ult]   ok\n");
    expect(b.lines).toHaveLength(2);
    expect(b.raw()).toBe("  [Tool]     read\n  [Result]   ok\n");
  });

  it("strips terminal colour codes and a leading timestamp", () => {
    expect(stripAnsi(`${ESC}[2m  [Tool]${ESC}[22m x`)).toBe("  [Tool] x");
    const b = buffer("2026-10-01T10:00:00.000Z   [Tool]    x\n");
    expect(b.timestamps).toBe(true);
    expect(b.lines[0]).toMatchObject({ text: "[Tool]    x", at: "2026-10-01T10:00:00.000Z", cls: "tool" });
    expect(buffer().timestamps).toBe(false);
  });

  it("reset forgets the log", () => {
    const b = buffer();
    b.reset();
    expect([b.lines.length, b.turns, b.raw()]).toEqual([0, 0, ""]);
  });
});

describe("filters and search", () => {
  const b = buffer();
  const lines = b.lines;

  it("each filter keeps its lines", () => {
    const n = (f: Parameters<typeof filterIndices>[1]) => filterIndices(lines, f).map((i) => lines[i]!.n);
    expect(n("all")).toHaveLength(11);
    expect(n("tools")).toEqual([3, 4, 8]);
    expect(n("tests")).toEqual([10]);
    expect(n("errors")).toEqual([9, 11]);
    expect(n("turns")).toEqual([2, 5, 6, 7]);
  });

  it("search runs over the filtered log, case-insensitively", () => {
    const all = filterIndices(lines, "all");
    expect(searchMatches(lines, all, "RETRY")).toEqual([8]);
    expect(searchMatches(lines, filterIndices(lines, "tools"), "retry")).toEqual([]);
    expect(searchMatches(lines, all, "")).toEqual([]);
  });

  it("splits text around matches", () => {
    expect(splitMatches("Foo foo", "foo")).toEqual(["", "Foo", " ", "foo", ""]);
    expect(splitMatches("abc", "")).toEqual(["abc"]);
  });

  it("finds the first kept line of a turn", () => {
    const all = filterIndices(lines, "all");
    expect(positionOfTurn(lines, all, 2)).toBe(4);
    expect(positionOfTurn(lines, filterIndices(lines, "tests"), 1)).toBe(0);
    expect(positionOfTurn(lines, all, 9)).toBe(-1);
  });
});

describe("windowing", () => {
  it("never asks for more rows than fit plus overscan", () => {
    const { start, end } = windowRange(ROW_HEIGHT * 10_000, 600, 20_000);
    expect(end - start).toBeLessThan(100);
    expect(start).toBeLessThanOrEqual(10_000);
    expect(end).toBeGreaterThan(10_000);
  });

  it("clamps to the list", () => {
    expect(windowRange(0, 600, 5)).toEqual({ start: 0, end: 5 });
    expect(windowRange(0, 600, 0)).toEqual({ start: 0, end: 0 });
    expect(scrollTopFor(0, 600)).toBe(0);
    expect(scrollTopFor(100, 600)).toBe(100 * ROW_HEIGHT - 200);
  });
});

describe("the header line", () => {
  it("names the command only when it is known", () => {
    expect(startedLine("t1", "dashboard")).toContain("n-dx work --task=t1 --auto");
    expect(startedLine("t1", "terminal")).toBe("Started from a terminal");
    expect(startedLine("t1", null)).toContain("no longer recorded");
  });
});

// ── The tab ──────────────────────────────────────────────────────────

function run(over: Partial<LiveTaskRun> = {}): LiveTaskRun {
  return {
    runId: "r1", status: "completed", startedAt: "2026-10-01T10:00:00.000Z", finishedAt: "2026-10-01T10:05:00.000Z",
    lastActivityAt: null, heartbeatAgeMs: null, stale: false, turns: 2,
    tokens: { input: 0, output: 0, cacheCreationInput: 0, cacheReadInput: 0, total: 0 },
    costUsd: 0, tokensPerSecond: null, model: null, vendor: null, weight: null,
    worktreeRoot: null, branch: null, startHead: null, pid: null, startedFrom: "dashboard",
    outcome: null, review: null, reviewPlan: null, reviewSpend: null, reviewReport: null, logTail: [], ...over,
  };
}

describe("the Log tab", () => {
  let root: HTMLElement;
  let logText: string;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    logText = SAMPLE;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const from = Number(new URL(String(url), "http://x").searchParams.get("from") ?? 0);
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: logText.slice(from), next: logText.length, reset: false, more: false }),
      };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(r = run()) {
    await act(async () => { render(h(LogTab, { run: r, taskId: "t1" }), root); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  const texts = () => [...root.querySelectorAll(".live-logrow-text")].map((n) => n.textContent);
  const change = (el: Element, value: string) => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };

  it("shows the origin, the line count, the lines and a legend", async () => {
    await mount();
    expect(root.querySelector(".live-log-source")?.textContent).toContain("n-dx work --task=t1 --auto · 11 lines");
    expect(texts()).toHaveLength(11);
    expect(root.querySelectorAll(".live-log-legend li")).toHaveLength(5);
    expect([...root.querySelectorAll(".live-logrow-turnstart .live-logrow-tag")].map((n) => n.textContent)).toEqual(["Turn 1", "Turn 2"]);
  });

  it("puts only a window of a 20,000-line log in the page", async () => {
    logText = Array.from({ length: 20_000 }, (_, i) => `  [Tool]     call ${i}`).join("\n") + "\n";
    await mount();
    expect(root.querySelector(".live-log-source")?.textContent).toContain("20,000 lines");
    expect(root.querySelectorAll(".live-logrow").length).toBeLessThan(150);
    expect((root.querySelector(".live-log-space") as HTMLElement).style.height).toBe(`${20_000 * ROW_HEIGHT}px`);
  });

  it("filters the whole log, not only the rows in the window", async () => {
    logText = Array.from({ length: 5_000 }, (_, i) => `  [Tool]     call ${i}`).join("\n") + "\n  [Warning]  late failure\n";
    await mount();
    // jsdom has no layout, so the window stays at the top, away from the last line.
    expect(texts().some((t) => t?.includes("late failure"))).toBe(false);
    await act(async () => { change(root.querySelectorAll("select")[0]!, "errors"); });
    expect(texts()).toEqual(["  [Warning]  late failure"]);
    expect(root.querySelector(".live-log-source")?.textContent).toContain("1 shown");
  });

  it("searches the whole log and counts matches", async () => {
    await mount();
    await act(async () => { change(root.querySelector("input[type=search]")!, "AGENT"); });
    expect(root.querySelector(".live-log-matches")?.textContent).toBe("1 of 3");
    expect([...root.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Agent", "Agent", "Agent"]);
    expect(root.querySelectorAll(".live-logrow-current")).toHaveLength(1);
  });

  it("stops following when scrolled up and resumes on request", async () => {
    await mount();
    const viewport = root.querySelector(".live-log-viewport") as HTMLElement;
    const button = () => [...root.querySelectorAll("button")].find((b) => /ollowing/.test(b.textContent ?? ""))!;
    expect(button().textContent).toBe("Following");
    // jsdom has no layout: report a viewport that is not at the bottom.
    Object.defineProperties(viewport, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 200, configurable: true },
    });
    viewport.scrollTop = 100;
    await act(async () => { viewport.dispatchEvent(new Event("scroll")); });
    expect(button().textContent).toBe("Resume following");
    await act(async () => { button().click(); });
    expect(button().textContent).toBe("Following");
  });

  it("downloads the complete file", async () => {
    await mount();
    const blobs: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => { blobs.push(b as Blob); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    const button = [...root.querySelectorAll("button")].find((b) => b.textContent === "Download .log")!;
    await act(async () => { button.click(); });
    expect(names).toEqual(["r1.log"]);
    expect(await blobs[0]!.text()).toBe(SAMPLE);
  });

  it("says so when the run has no log", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await mount();
    expect(root.textContent).toContain("No log was recorded");
  });
});
