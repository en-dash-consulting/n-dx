// @vitest-environment jsdom
/**
 * The running-now bar: which entries it lists, which is current, how `[` / `]`
 * move, and an item that finishes while its page is open.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { LiveSummary } from "../../../src/viewer/hooks/use-live.js";
import { LiveBar } from "../../../src/viewer/views/live-bar.js";
import {
  barEntries,
  currentEntryKey,
  isModalOpen,
  isTypingTarget,
  stepTarget,
  withFinished,
} from "../../../src/viewer/views/live-bar-model.js";

const MAIN = { key: "main", isAnchor: true };
const OTHER = { key: "feat", isAnchor: false };

function run(id: string, over: Record<string, unknown> = {}) {
  return {
    runId: `r${id}`, taskId: `t${id}`, taskTitle: `Task ${id}`, branch: `b${id}`, worktree: MAIN,
    startedAt: "2026-10-01T10:00:00.000Z", stale: false, lastProgress: `step ${id}`, ...over,
  };
}

function summary(runs: unknown[], jobs: unknown[] = []): LiveSummary {
  return {
    runs, jobs,
    counts: { running: runs.length, stale: (runs as Array<{ stale: boolean }>).filter((r) => r.stale).length, jobs: jobs.length },
  } as unknown as LiveSummary;
}

const analyze = { id: "sv-analyze:main", kind: "sv-analyze", worktree: MAIN, startedAt: null, detail: null, progress: { phase: { index: 2, name: "imports", total: 6 }, batch: null } };

describe("bar model", () => {
  it("lists runs then jobs, each pointing at its own page", () => {
    const entries = barEntries(summary([run("1"), run("2", { worktree: OTHER })], [analyze]));
    expect(entries.map((e) => [e.view, e.subId, e.kind])).toEqual([
      ["live-task", "t1", "Task"], ["live-task", "t2", "Task"], ["live-analyze", null, "Analyze"],
    ]);
    expect(entries[2].step).toBe("imports");
  });

  it("marks the task page's entry current, matching on worktree too", () => {
    const entries = barEntries(summary([run("1"), run("1", { runId: "other", worktree: OTHER })]));
    const inMain = (w: { key: string } | null) => w?.key === "main";
    expect(currentEntryKey(entries, "live-task", "t1", inMain)).toBe("run:r1");
    expect(currentEntryKey(entries, "live", null, inMain)).toBeNull();
    expect(currentEntryKey(barEntries(summary([], [analyze])), "live-analyze", null, inMain)).toBe("job:sv-analyze:main");
  });

  it("cycles in bar order, wrapping, and from the overview enters at either end", () => {
    const entries = barEntries(summary([run("1"), run("2")], [analyze]));
    expect(stepTarget(entries, "run:r1", 1)?.key).toBe("run:r2");
    expect(stepTarget(entries, "job:sv-analyze:main", 1)?.key).toBe("run:r1");
    expect(stepTarget(entries, "run:r1", -1)?.key).toBe("job:sv-analyze:main");
    expect(stepTarget(entries, null, 1)?.key).toBe("run:r1");
    expect(stepTarget(entries, null, -1)?.key).toBe("job:sv-analyze:main");
    expect(stepTarget([], null, 1)).toBeNull();
    expect(stepTarget(entries.slice(0, 1), "run:r1", 1)).toBeNull();
  });

  it("keeps a vanished page entry, marked finished, in its old place", () => {
    const before = barEntries(summary([run("1"), run("2")]));
    const after = barEntries(summary([run("2")]));
    const { entries, kept } = withFinished(after, before, "run:r1", null);
    expect(entries.map((e) => [e.key, e.finished])).toEqual([["run:r1", true], ["run:r2", false]]);
    // Still kept on the next read, though `previous` no longer has it live.
    expect(withFinished(after, after, "run:r1", kept).entries[0].finished).toBe(true);
    expect(withFinished(after, before, null, null).entries).toHaveLength(1);
  });

  it("sees an open modal dialog anywhere in the document", () => {
    const root = document.createElement("div");
    expect(isModalOpen(root)).toBe(false);
    root.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(isModalOpen(root)).toBe(true);
  });

  it("recognises text fields", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("the rendered bar", () => {
  let root: HTMLDivElement;
  let body: unknown;
  const navigateTo = vi.fn();

  beforeEach(() => {
    navigateTo.mockClear();
    root = document.createElement("div");
    document.body.appendChild(root);
    body = summary([run("1"), run("2", { worktree: OTHER })], [analyze]);
    vi.stubGlobal("WebSocket", class { onmessage = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mount(view: "live" | "live-task" | "live-analyze", taskId: string | null = null) {
    act(() => { render(h(LiveBar, { view, taskId, navigateTo }), root); });
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
      else await new Promise((r) => setTimeout(r, 10));
    });
  }

  const items = () => [...root.querySelectorAll<HTMLAnchorElement>(".live-bar-item")];
  const press = (key: string, target: EventTarget = document.body) => {
    act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  };

  it("shows All live plus one entry per item, current one marked aria-current=page", async () => {
    await mount("live-task", "t1");
    expect(items()).toHaveLength(4);
    expect(items()[0].textContent).toContain("All live");
    expect(items()[0].getAttribute("aria-current")).toBeNull();
    expect(items().filter((a) => a.getAttribute("aria-current") === "page")).toEqual([items()[1]]);
    expect(items()[1].getAttribute("href")).toMatch(/\/live\/task\/t1$/);
  });

  it("links another worktree's run through its /w/<key>/ prefix", async () => {
    await mount("live");
    expect(items()[0].getAttribute("aria-current")).toBe("page");
    expect(items()[2].getAttribute("href")).toContain("/w/feat/live/task/t2");
  });

  it("[ and ] move through the items, and do nothing in a text field", async () => {
    await mount("live-task", "t1");
    press("]");
    expect(navigateTo).not.toHaveBeenCalled(); // next is the other worktree: a full navigation
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("[", input);
    expect(navigateTo).not.toHaveBeenCalled();
    press("[");
    expect(navigateTo).toHaveBeenCalledWith("live-analyze", undefined);
    input.remove();
  });

  it("[ and ] do nothing while a modal dialog is open", async () => {
    await mount("live-task", "t1");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    press("[");
    expect(navigateTo).not.toHaveBeenCalled();
    dialog.remove();
    press("[");
    expect(navigateTo).toHaveBeenCalledWith("live-analyze", undefined);
  });

  it("keeps an item that finishes while open, marked finished", async () => {
    vi.useFakeTimers();
    await mount("live-task", "t1");
    body = summary([run("2", { worktree: OTHER })], [analyze]);
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(items()).toHaveLength(4);
    expect(items()[1].classList.contains("live-bar-finished")).toBe(true);
    expect(items()[1].textContent).toContain("finished");
    expect(items()[1].getAttribute("aria-current")).toBe("page");
    // Leaving the page drops it.
    await mount("live");
    expect(items()).toHaveLength(3);
  });
});
