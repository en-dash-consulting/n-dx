// @vitest-environment jsdom
/**
 * The Prepare task modal: every field with its value and source, changed
 * fields marked with a reset, the preflight list gating Execute, the command
 * line, the brief preview, every Execute outcome, and dialog semantics.
 *
 * @see src/viewer/components/prepare-task-modal.ts
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { DetailPanel } from "../../../src/viewer/components/detail-panel.js";
import { PrepareTaskModal } from "../../../src/viewer/components/prepare-task-modal.js";
import type { PrepResponse } from "../../../src/viewer/components/prepare-task-model.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { prepFixture } from "../../helpers/prep-fixture.js";

interface Call { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }

type Route = (call: Call) => { status: number; body: unknown } | undefined;

let root: HTMLDivElement | undefined;
let calls: Call[];

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Answer the prep GET with `prep`; every other request goes to `route`. */
function stubFetch(prep: PrepResponse, route: Route = () => undefined): void {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const answer = route(call)
      ?? (url.startsWith("/api/hench/prep/") && call.method === "GET" ? { status: 200, body: prep } : { status: 404, body: {} });
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function open(
  prep: PrepResponse = prepFixture(),
  route?: Route,
  props: Partial<Parameters<typeof PrepareTaskModal>[0]> = {},
) {
  stubFetch(prep, route);
  const onClose = vi.fn();
  const onOpenLive = vi.fn();
  root = renderToDiv(h(PrepareTaskModal, { taskId: "task-1", onClose, onOpenLive, ...props }));
  await flush();
  return { onClose, onOpenLive };
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fieldOf = (id: string) => $(`#${id}`).closest(".prep-field") as HTMLElement;
const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

async function change(id: string, value: string | boolean): Promise<void> {
  await act(async () => {
    const el = $<HTMLInputElement>(`#${id}`);
    if (typeof value === "boolean") {
      el.checked = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.value = value;
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await flush();
}

describe("PrepareTaskModal", () => {
  it("is a labelled modal dialog that takes focus, with a label for every control", async () => {
    await open();
    const dialog = $("[role=dialog]");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.textContent).toBe("Prepare task");
    expect(dialog.contains(document.activeElement)).toBe(true);

    const controls = dialog.querySelectorAll("input, select, textarea");
    expect(controls.length).toBeGreaterThanOrEqual(12);
    for (const control of controls) {
      expect(dialog.querySelector(`label[for="${control.id}"]`), control.id).not.toBeNull();
    }
  });

  it("states the task in the header", async () => {
    await open();
    const header = $(".prep-header").textContent!;
    expect(header).toContain("Prep me");
    expect(header).toContain("Epic › Feature");
    expect(header).toContain("pending");
    expect(header).toContain("high");
    expect(header).toContain("3 criteria");
    expect(header).toContain("task-1".slice(0, 8));
  });

  it("shows every field's value and the source it came from", async () => {
    await open();
    expect($<HTMLInputElement>("#prep-vendor").value).toBe("claude");
    expect(fieldOf("prep-vendor").textContent).toContain("from llm.vendor");
    expect($<HTMLSelectElement>("#prep-model").value).toBe("claude-sonnet");
    expect(fieldOf("prep-model").textContent).toContain("from llm.claude.model");
    expect($<HTMLSelectElement>("#prep-provider").value).toBe("api");
    expect($<HTMLSelectElement>("#prep-permissionMode").value).toBe("acceptEdits");
    expect(fieldOf("prep-permissionMode").textContent).toContain("from autonomous-default");
    expect($<HTMLInputElement>("#prep-maxTurns").value).toBe("50");
    expect(fieldOf("prep-maxTurns").textContent).toContain("from hench.maxTurns");
    expect($<HTMLSelectElement>("#prep-review").value).toBe("off");
    expect($<HTMLSelectElement>("#prep-reviewModel").disabled).toBe(true);
    expect($<HTMLSelectElement>("#prep-skipTestGate").value).toBe("run");
    expect($<HTMLSelectElement>("#prep-fresh").value).toBe("reuse");
    expect($<HTMLInputElement>("#prep-allowDirty").checked).toBe(false);
    expect(document.querySelector(".prep-changed")).toBeNull();
  });

  it("marks a changed field, counts it, puts it in the command, and resets it", async () => {
    await open();
    expect($(".prep-command-line").textContent).toBe("ndx work --task=task-1 --auto /repo");

    await change("prep-model", "claude-opus");
    const field = fieldOf("prep-model");
    expect(field.querySelector(".prep-dot")).not.toBeNull();
    expect(field.textContent).toContain("changed for this run");
    expect($(".prep-command-line").textContent).toBe("ndx work --task=task-1 --auto --model=claude-opus /repo");
    expect($(".prep-change-count").textContent).toBe("1 change applies to this run only");

    await click(field.querySelector<HTMLButtonElement>(".prep-reset")!);
    expect($<HTMLSelectElement>("#prep-model").value).toBe("claude-sonnet");
    expect(fieldOf("prep-model").querySelector(".prep-dot")).toBeNull();
    expect($(".prep-change-count").textContent).toBe("0 changes apply to this run only");
  });

  it("enables the review model only with review on, and max turns only on the api provider", async () => {
    await open();
    await change("prep-review", "on");
    expect($<HTMLSelectElement>("#prep-reviewModel").disabled).toBe(false);
    await change("prep-provider", "cli");
    expect($<HTMLInputElement>("#prep-maxTurns").disabled).toBe(true);
    expect(fieldOf("prep-maxTurns").textContent).toContain("api provider only");
  });

  it("lists refusals and warnings, and keeps Execute off until allow dirty tree answers the dirty-tree refusal", async () => {
    await open(prepFixture({
      refusals: [{ code: "dirty-tree", message: "Refusing to start with uncommitted changes.", hint: "Commit or stash them." }],
      workspace: { key: null, root: "/repo", branch: "main", isAnchor: true, dirty: true, liveRun: true },
      admission: { running: 2, max: 2, queued: 1, availableBytes: null, pressure: "unknown", memoryPaused: false },
    }));
    const preflight = $(".prep-preflight").textContent!;
    expect(preflight).toContain("Refusing to start with uncommitted changes.");
    expect(preflight).toContain("Commit or stash them.");
    expect(preflight).toContain("Commits land on main");
    expect(preflight).toContain("two runs would share one working tree");
    expect(preflight).toContain("Execute will queue");
    expect(button("Execute").disabled).toBe(true);

    await change("prep-allowDirty", true);
    expect($(".prep-preflight").textContent).not.toContain("uncommitted changes");
    expect(button("Execute").disabled).toBe(false);
  });

  it("executes with only the changed options and hands a started run to Live", async () => {
    const { onOpenLive } = await open(prepFixture(), (c) =>
      c.url === "/api/hench/execute" ? { status: 202, body: { status: "started", taskId: "task-1" } } : undefined);
    await change("prep-fresh", "fresh");
    await click(button("Execute"));
    const exec = calls.find((c) => c.url === "/api/hench/execute")!;
    expect(exec.method).toBe("POST");
    expect(exec.body).toEqual({ taskId: "task-1", options: { fresh: true } });
    expect(onOpenLive).toHaveBeenCalledWith("task-1");
  });

  it("shows a queued run's position, kept current from the hub queue, with a link to Live", async () => {
    let hubEntries: Array<Record<string, unknown>> = [];
    const { onOpenLive } = await open(prepFixture(), (c) => {
      if (c.url === "/api/hench/execute") return { status: 202, body: { queued: true, position: 3, reason: "at-capacity", taskId: "task-1" } };
      if (c.url === "/api/hub/queue") {
        return { status: 200, body: { entries: hubEntries, running: 2, limits: { maxSessions: 2, memoryFloorBytes: 0 }, memoryPaused: false, freeMemoryBytes: null } };
      }
      return undefined;
    });
    hubEntries = [
      { projectId: "p", workspace: null, taskId: "other", enqueuedAt: "" },
      { projectId: "p", workspace: null, taskId: "task-1", enqueuedAt: "" },
    ];
    await click(button("Execute"));
    const notice = $(".prep-queued");
    expect(notice.textContent).toContain("Queued — position 2");
    expect(notice.textContent).toContain("every run slot on this machine is busy");
    const link = notice.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/live/task/task-1");
    await click(link);
    expect(onOpenLive).toHaveBeenCalledWith("task-1");
    expect(button("Execute").disabled).toBe(true);
  });

  it("says a queued run could not start, in its server's words, and offers Execute again", async () => {
    let hubBody: Record<string, unknown> = { entries: [] };
    await open(prepFixture(), (c) => {
      if (c.url === "/api/hench/execute") {
        return { status: 202, body: { queued: true, position: 1, reason: "at-capacity", taskId: "task-1", workspace: null } };
      }
      if (c.url === "/api/hub/queue") {
        return { status: 200, body: { running: 2, limits: { maxSessions: 2, memoryFloorBytes: 0 }, memoryPaused: false, freeMemoryBytes: null, ...hubBody } };
      }
      return undefined;
    });
    // Its turn came; the server refused it, and the hub kept why.
    hubBody = {
      entries: [],
      dropped: [
        { projectId: "p", workspace: "other-tree", taskId: "task-1", enqueuedAt: "", droppedAt: "", status: 404, error: "Not this one." },
        { projectId: "p", workspace: null, taskId: "task-1", enqueuedAt: "", droppedAt: "", status: 409, error: "Task is blocked by X." },
      ],
    };
    await click(button("Execute"));
    const notice = $(".prep-queued");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toBe("Could not start: Task is blocked by X. (HTTP 409)");
    expect(button("Execute").disabled).toBe(false);
  });

  it("shows the server's message when the start is refused", async () => {
    await open(prepFixture(), (c) =>
      c.url === "/api/hench/execute" ? { status: 409, body: { error: "Task is claimed by another worktree." } } : undefined);
    await click(button("Execute"));
    expect($(".prep-error").textContent).toBe("Task is claimed by another worktree.");
  });

  it("offers the PRD tree migration on a migratable 412, as its own request", async () => {
    await open(prepFixture(), (c) => {
      if (c.url !== "/api/hench/execute") return undefined;
      return c.body?.migrateSlugs
        ? { status: 200, body: { message: "Migrated 3 paths." } }
        : { status: 412, body: { error: "The PRD tree does not match slug rule 2.", migratable: true } };
    });
    await click(button("Execute"));
    expect($(".prep-error").textContent).toContain("slug rule 2");
    await click(button("Migrate the PRD tree"));
    expect(calls.filter((c) => c.url === "/api/hench/execute").at(-1)!.body).toEqual({ taskId: "task-1", migrateSlugs: true });
    expect($(".prep-notice").textContent).toBe("Migrated 3 paths.");
  });

  it("previews the brief for the current options, and goes back", async () => {
    await open(prepFixture(), (c) =>
      c.url === "/api/hench/prep/task-1/preview" ? { status: 200, body: { brief: "# Brief\nDo the thing." } } : undefined);
    await change("prep-maxTurns", "7");
    await click(button("Preview brief"));
    const previewCall = calls.find((c) => c.url.endsWith("/preview"))!;
    expect(previewCall.body).toEqual({ options: { maxTurns: 7 } });
    expect($("pre.prep-brief").textContent).toBe("# Brief\nDo the thing.");
    await click(button("Back"));
    expect($<HTMLInputElement>("#prep-maxTurns").value).toBe("7");
  });

  // The prep GET resolves a deferred task with --reset-deferred, so hench
  // reports no not-actionable refusal; the modal must then let it start.
  it("enables Execute for a deferred task and shows the --reset-deferred the server will pass", async () => {
    const { onOpenLive } = await open(
      prepFixture({ task: { id: "task-1", title: "Prep me", status: "deferred", level: "task" } }),
      (c) => (c.url === "/api/hench/execute" ? { status: 202, body: { status: "started", taskId: "task-1" } } : undefined),
    );
    expect($(".prep-command-line").textContent).toBe("ndx work --task=task-1 --auto --reset-deferred /repo");
    expect(button("Execute").disabled).toBe(false);
    await click(button("Execute"));
    // Execute derives --reset-deferred from the task's status itself; the
    // request carries no option for it.
    expect(calls.find((c) => c.url === "/api/hench/execute")!.body).toEqual({ taskId: "task-1", options: {} });
    expect(onOpenLive).toHaveBeenCalledWith("task-1");
  });

  it("labels Execute Resume for an in-progress task", async () => {
    await open(prepFixture({ task: { id: "task-1", title: "Prep me", status: "in_progress", level: "task" } }));
    expect(button("Resume")).toBeDefined();
  });

  it("sends X-Ndx-Workspace on every request when opened for another workspace", async () => {
    await open(prepFixture(), undefined, { workspace: "feature" });
    expect(calls[0]!.headers["X-Ndx-Workspace"]).toBe("feature");
  });

  it("closes on Escape and on the close button, and returns focus to its opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { onClose } = await open();
    expect(document.activeElement).not.toBe(opener);

    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await click($<HTMLButtonElement>("button[aria-label=Close]"));
    expect(onClose).toHaveBeenCalledTimes(2);

    cleanupRenderedDiv(root!);
    root = undefined;
    expect(document.activeElement).toBe(opener);
  });

  it("closes only itself on Escape over the detail panel, and returns focus to Start", async () => {
    const panelClose = vi.fn();
    const panelRoot = renderToDiv(h(DetailPanel, {
      detail: { type: "generic" as const, title: "Task" },
      onClose: panelClose,
    }));
    const start = document.createElement("button");
    document.body.appendChild(start);
    start.focus();
    const { onClose } = await open();

    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    await act(async () => { document.dispatchEvent(esc); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panelClose).not.toHaveBeenCalled();
    expect(esc.defaultPrevented).toBe(true);

    cleanupRenderedDiv(root!);
    root = undefined;
    expect(document.activeElement).toBe(start);

    // Modal gone: Escape closes the panel again.
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })); });
    expect(panelClose).toHaveBeenCalledTimes(1);
    cleanupRenderedDiv(panelRoot);
  });

  it("traps Tab inside the dialog", async () => {
    await open();
    const focusables = Array.from($("[role=dialog]").querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
    ));
    // Focus starts on the first control.
    expect(document.activeElement).toBe(focusables[0]);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(focusables.at(-1));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true })); });
    expect(document.activeElement).toBe(focusables[0]);
  });
});
