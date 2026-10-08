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

type Answer = { status: number; body: unknown };
type Route = (call: Call) => Answer | undefined | Promise<Answer | undefined>;

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
    const answer = (await route(call))
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

  it("shows the reviewer when review goes on, and sends vendor default explicitly over a configured reviewer", async () => {
    await open();
    expect($<HTMLSelectElement>("#prep-reviewModel").value).toBe("claude-sonnet");
    expect(fieldOf("prep-reviewModel").textContent).toContain("from llm.claude.reviewModel");
    await change("prep-review", "on");
    await change("prep-reviewModel", "claude-opus");
    expect($<HTMLSelectElement>("#prep-reviewModel").selectedOptions[0].textContent).toBe("Vendor default (claude-opus)");
    expect($(".prep-command-line").textContent).toBe(
      "ndx work --task=task-1 --auto --review --review-model=claude-opus /repo",
    );
    // Back to the configured reviewer clears the edit.
    await change("prep-reviewModel", "claude-sonnet");
    expect($(".prep-command-line").textContent).toBe("ndx work --task=task-1 --auto --review /repo");
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

  it("moves focus to the preview heading on open and back to Preview brief on Back", async () => {
    await open(prepFixture(), (c) =>
      c.url.endsWith("/preview") ? { status: 200, body: { brief: "# Brief" } } : undefined);
    await click(button("Preview brief"));
    expect(document.activeElement).toBe($(".prep-preview-title"));
    await click(button("Back"));
    expect(document.activeElement).toBe(button("Preview brief"));
  });

  it("ignores a preview reply that arrives after Back, or after a newer request", async () => {
    const pending: Array<(r: Answer) => void> = [];
    await open(prepFixture(), (c) => {
      if (!c.url.endsWith("/preview")) return undefined;
      // Held until the test settles it.
      return new Promise<Answer>((r) => pending.push(r));
    });

    // Preview, Back before it returns, edit a field: the late reply is dropped.
    await click(button("Preview brief"));
    await click(button("Back"));
    await change("prep-maxTurns", "9");
    await act(async () => { pending[0]!({ status: 200, body: { brief: "OLD" } }); });
    await flush();
    expect(document.querySelector("pre.prep-brief")).toBeNull();
    expect($<HTMLInputElement>("#prep-maxTurns").value).toBe("9");

    // A second request supersedes the first: only the newest reply shows.
    await click(button("Preview brief"));
    await click(button("Back"));
    await click(button("Preview brief"));
    await act(async () => { pending[2]!({ status: 200, body: { brief: "NEW" } }); });
    await flush();
    await act(async () => { pending[1]!({ status: 200, body: { brief: "STALE" } }); });
    await flush();
    expect($("pre.prep-brief").textContent).toBe("NEW");
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

  it("sends X-Ndx-Workspace on prep, preview, execute and migrate when opened for another workspace", async () => {
    await open(prepFixture(), (c) => {
      if (c.url.endsWith("/preview")) return { status: 200, body: { brief: "B" } };
      if (c.url !== "/api/hench/execute") return undefined;
      return c.body?.migrateSlugs
        ? { status: 200, body: { message: "Migrated." } }
        : { status: 412, body: { error: "Tree mismatch.", migratable: true } };
    }, { workspace: "feature" });
    await click(button("Preview brief"));
    await click(button("Back"));
    await click(button("Execute"));
    await click(button("Migrate the PRD tree"));

    const kinds = calls.map((c) =>
      c.url.endsWith("/preview") ? "preview"
        : c.url === "/api/hench/execute" ? (c.body?.migrateSlugs ? "migrate" : "execute")
          : "prep");
    // Migrating re-reads the prep, since the tree it described has changed.
    expect(kinds).toEqual(["prep", "preview", "execute", "migrate", "prep"]);
    for (const call of calls) {
      expect(call.headers["X-Ndx-Workspace"], `${call.method} ${call.url}`).toBe("feature");
    }
  });

  it("sends no X-Ndx-Workspace on any request when opened for the anchor", async () => {
    await open(prepFixture(), (c) =>
      c.url.endsWith("/preview") ? { status: 200, body: { brief: "B" } } : undefined);
    await click(button("Preview brief"));
    await click(button("Back"));
    await click(button("Execute"));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call.headers["X-Ndx-Workspace"], call.url).toBeUndefined();
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

/**
 * A prep answer whose task carries saved settings: `task.run*` sources with the
 * project default as `fallback`, which is what hench's `--resolve` reports.
 */
function savedPrep(over: Record<string, unknown> = {}): PrepResponse {
  const prep = prepFixture({
    saved: { models: { claude: "claude-opus" }, maxTurns: 7 },
    savedVersion: "v1",
    ...over,
  });
  prep.resolved.model = {
    value: "claude-opus",
    source: "task.run.models",
    fallback: { value: "claude-sonnet", source: "llm.claude.model" },
  };
  prep.resolved.maxTurns = {
    value: 7,
    source: "task.run",
    fallback: { value: 50, source: "hench.maxTurns" },
  };
  return prep;
}

/** The PUTs a run of the modal made, newest last. */
function puts(): Call[] {
  return calls.filter((c) => c.method === "PUT");
}

describe("PrepareTaskModal — settings saved on the task", () => {
  it("labels a saved field and names the project default it displaced", async () => {
    await open(savedPrep());

    const model = fieldOf("prep-model");
    expect(model.querySelector(".prep-source")!.textContent).toBe("saved on task");
    expect(model.querySelector(".prep-fallback")!.textContent)
      .toBe("project default: claude-sonnet from llm.claude.model");

    // A field the project supplied still names its config key.
    expect(fieldOf("prep-provider").querySelector(".prep-source")!.textContent).toMatch(/^from /);
    expect(fieldOf("prep-provider").querySelector(".prep-fallback")).toBeNull();
  });

  it("counts saved settings separately from this run's changes", async () => {
    await open(savedPrep());
    const footer = $(".prep-change-count").textContent ?? "";

    // Two different facts, both true at once.
    expect(footer).toContain("0 changes apply to this run only");
    expect(footer).toContain("2 saved, applies from the terminal too");
  });

  it("says nothing about saved settings for a task that carries none", async () => {
    await open();
    expect($(".prep-change-count").textContent).not.toContain("saved");
  });

  describe("Save", () => {
    it("PUTs the block with the version the GET reported, then reloads", async () => {
      let saved = false;
      await open(savedPrep(), (call) => {
        if (call.method !== "PUT") return undefined;
        saved = true;
        return { status: 200, body: { saved: call.body!.run, version: "v2", workspace: { isAnchor: true } } };
      });

      await change("prep-maxTurns", "9");
      await click(button("Save"));

      expect(saved).toBe(true);
      const put = puts()[0]!;
      expect(put.url).toBe("/api/hench/prep/task-1");
      expect(put.body).toMatchObject({ version: "v1" });
      // The saved pin travels with the edit rather than being dropped.
      expect(put.body!.run).toMatchObject({ models: { claude: "claude-opus" }, maxTurns: 9 });

      // Reloaded, so the sources and the version are the server's again.
      expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(1);
      expect($(".prep-notice").textContent).toBe("Saved");
    });

    it("never writes a launch-time field", async () => {
      await open(savedPrep(), (call) =>
        call.method === "PUT" ? { status: 200, body: { saved: null, version: "v2", workspace: { isAnchor: true } } } : undefined);

      await change("prep-fresh", true);
      await click(button("Save"));

      expect(puts()[0]!.body!.run).not.toHaveProperty("fresh");
    });

    it("is disabled when there is nothing to write", async () => {
      await open();
      expect(button("Save").disabled).toBe(true);
    });

    it("says where a save off the anchor lands", async () => {
      const prep = savedPrep();
      prep.workspace = { ...prep.workspace, isAnchor: false, branch: "feat/x" };
      await open(prep);

      expect($(".prep-off-anchor").textContent)
        .toBe("Saved on branch feat/x; lands when the branch merges");
    });
  });

  describe("Reset to defaults", () => {
    it("clears edits first, without touching what is saved", async () => {
      await open(savedPrep());
      await change("prep-maxTurns", "9");

      await click(button("Reset to defaults"));

      expect(puts()).toHaveLength(0);
      expect($(".prep-change-count").textContent).toContain("0 changes");
    });

    it("asks before clearing the saved block, then PUTs null", async () => {
      await open(savedPrep(), (call) =>
        call.method === "PUT" ? { status: 200, body: { saved: null, version: "none", workspace: { isAnchor: true } } } : undefined);

      // With no edits left, Reset offers to clear what the task carries.
      await click(button("Reset to defaults"));
      expect($(".prep-confirm-text").textContent).toBe("Clear 2 saved settings for this task?");
      expect(puts()).toHaveLength(0);

      await click(button("Clear"));
      expect(puts()[0]!.body).toEqual({ run: null, version: "v1" });
    });

    it("keeps the saved block when the confirm is declined", async () => {
      await open(savedPrep());
      await click(button("Reset to defaults"));
      await click(button("Keep"));

      expect(puts()).toHaveLength(0);
      expect(document.querySelector(".prep-confirm-text")).toBeNull();
    });
  });

  describe("a save that lost a race", () => {
    const conflictAnswer = {
      status: 409,
      body: { error: "changed", conflict: true, saved: { maxTurns: 99 }, version: "v9" },
    };

    it("offers Reload and Overwrite", async () => {
      await open(savedPrep(), (call) => (call.method === "PUT" ? conflictAnswer : undefined));
      await change("prep-maxTurns", "9");
      await click(button("Save"));

      expect($(".prep-conflict-text").textContent)
        .toBe("These settings were saved elsewhere since you opened this.");
      expect(button("Reload")).toBeTruthy();
      expect(button("Overwrite")).toBeTruthy();
    });

    it("Reload drops the edits and re-reads", async () => {
      await open(savedPrep(), (call) => (call.method === "PUT" ? conflictAnswer : undefined));
      await change("prep-maxTurns", "9");
      await click(button("Save"));
      const before = calls.filter((c) => c.method === "GET").length;

      await click(button("Reload"));

      expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(before);
      expect($(".prep-change-count").textContent).toContain("0 changes");
      expect(document.querySelector(".prep-conflict")).toBeNull();
    });

    it("Overwrite resends against the version the refusal named", async () => {
      let answers = 0;
      await open(savedPrep(), (call) => {
        if (call.method !== "PUT") return undefined;
        answers++;
        return answers === 1
          ? conflictAnswer
          : { status: 200, body: { saved: call.body!.run, version: "v10", workspace: { isAnchor: true } } };
      });
      await change("prep-maxTurns", "9");
      await click(button("Save"));
      await click(button("Overwrite"));

      expect(puts()).toHaveLength(2);
      expect(puts()[0]!.body).toMatchObject({ version: "v1" });
      // The second carries the server's version, which is what makes it an
      // overwrite rather than another refusal.
      expect(puts()[1]!.body).toMatchObject({ version: "v9" });
    });
  });

  describe("Execute alongside saved settings", () => {
    it("sends only the edits, never the saved values", async () => {
      await open(savedPrep(), (call) =>
        call.url === "/api/hench/execute" ? { status: 200, body: { ok: true } } : undefined);

      await change("prep-maxTurns", "9");
      await click(button("Execute"));

      const exec = calls.find((c) => c.url === "/api/hench/execute")!;
      expect(exec.body!.options).toEqual({ maxTurns: 9 });
    });

    it("sends false for a saved boolean switched off, so the run gets the negation", async () => {
      const prep = savedPrep({ saved: { review: true } });
      prep.resolved.review = { value: true, source: "task.run", fallback: { value: false, source: "built-in" } };
      await open(prep, (call) =>
        call.url === "/api/hench/execute" ? { status: 200, body: { ok: true } } : undefined);

      await change("prep-review", "off");
      await click(button("Execute"));

      const exec = calls.find((c) => c.url === "/api/hench/execute")!;
      expect(exec.body!.options).toMatchObject({ review: false });
    });
  });
});
