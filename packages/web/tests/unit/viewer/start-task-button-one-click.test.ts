// @vitest-environment jsdom
/**
 * Start Working runs in one click, with the task's saved settings; its arrow
 * opens the settings.
 *
 * The primary click reads the task's run settings and posts the execute —
 * never opening the Prepare task modal. A task with no saved block sends the
 * project defaults with the execute as `saveRun: {run, version}`, and the
 * server saves them only once the start passes every gate; the client never
 * writes them itself, so a refused start cannot leave settings behind. A
 * start refused because those settings could not be saved (400 on `saveRun`,
 * 409 conflict) starts nothing and says so until the next click. The arrow is
 * the way into the modal, with no menu in between.
 *
 * @see packages/web/src/viewer/components/start-task-button.ts
 * @see packages/web/src/viewer/components/prepare-task-model.ts — defaultsRunBlockOf
 * @see packages/web/tests/integration/execute-save-run.test.ts — the server side
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { StartTaskButton } from "../../../src/viewer/components/start-task-button.js";
import { defaultsRunBlockOf } from "../../../src/viewer/components/prepare-task-model.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { prepFixture } from "../../helpers/prep-fixture.js";
import { savedPrep, stubStartFetch } from "../../helpers/start-task-fetch.js";

let root: HTMLDivElement | undefined;

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function mount(props: Record<string, unknown> = {}) {
  root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted: () => {}, label: "Start Working", ...props }));
  return root;
}

async function clickPrimary(): Promise<void> {
  await act(async () => { root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click(); });
  await settle();
}

const dialog = () => document.querySelector('[role="dialog"]');
const errorText = () => root!.querySelector(".start-task-error")?.textContent ?? null;

describe("Start Working: the primary click", () => {
  it("starts a task with saved settings at once: no modal, no saveRun, the execute alone", async () => {
    const stub = stubStartFetch({ prep: savedPrep() });
    const onStarted = vi.fn();
    const navigateTo = vi.fn();
    mount({ onStarted, navigateTo });

    await clickPrimary();

    expect(dialog()).toBeNull();
    expect(stub.saves()).toHaveLength(0);
    // No options travel, so nothing outranks the task's saved block: ndx work applies it.
    expect(stub.executes().map((c) => c.body)).toEqual([{ taskId: "t-1" }]);
    expect(onStarted).toHaveBeenCalledOnce();
    expect(navigateTo).toHaveBeenCalledWith("live-task", { taskId: "t-1" });
  });

  it("sends the project defaults with the execute for a task with none, and never PUTs them", async () => {
    const prep = prepFixture();
    const stub = stubStartFetch({ prep });
    const onStarted = vi.fn();
    mount({ onStarted });

    await clickPrimary();

    expect(dialog()).toBeNull();
    expect(stub.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/hench/prep/t-1",
      "POST /api/hench/execute",
    ]);
    // The block is what the modal would show, with the version the read
    // reported; the server saves it once the start passes its gates.
    expect(stub.executes()[0].body).toEqual({
      taskId: "t-1",
      saveRun: { run: defaultsRunBlockOf(prep), version: "none" },
    });
    expect((stub.executes()[0].body!.saveRun as { run: unknown }).run)
      .toMatchObject({ models: { claude: "claude-sonnet" }, provider: "api" });
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("sends the workspace header on the read and the execute", async () => {
    const stub = stubStartFetch({ prep: prepFixture() });
    mount({ workspace: "feat" });

    await clickPrimary();

    expect(stub.calls).toHaveLength(2);
    for (const call of stub.calls) expect(call.headers["X-Ndx-Workspace"], call.url).toBe("feat");
  });

  it("starts nothing when the server refuses the settings to save, and says why until the next click", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubStartFetch({
        prep: prepFixture(),
        execute: {
          status: 400,
          body: { error: 'Run setting "models.claude": Model "x" is not in the claude catalog.', key: "saveRun.run.models" },
        },
      });
      const onStarted = vi.fn();
      mount({ onStarted });

      await act(async () => {
        root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click();
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

      expect(stub.saves()).toHaveLength(0);
      expect(onStarted).not.toHaveBeenCalled();
      expect(errorText()).toContain("Could not save the project defaults on this task, so nothing was started");
      expect(errorText()).toContain("not in the claude catalog");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says someone else saved settings when the start is refused with a version conflict (409)", async () => {
    const stub = stubStartFetch({
      prep: prepFixture(),
      execute: { status: 409, body: { error: "changed", conflict: true, saved: { tier: "light" }, version: "abc" } },
    });
    const onStarted = vi.fn();
    mount({ onStarted });

    await clickPrimary();

    expect(stub.saves()).toHaveLength(0);
    expect(onStarted).not.toHaveBeenCalled();
    expect(errorText()).toContain("saved on this task by someone else");
  });

  it("shows a refused start (paused) as the server's refusal, having written nothing itself", async () => {
    const stub = stubStartFetch({
      prep: prepFixture(),
      execute: { status: 503, body: { error: "New executions are paused." } },
    });
    mount();

    await clickPrimary();

    // The only write would have been the server's, after its gates; the
    // client sent none.
    expect(stub.saves()).toHaveLength(0);
    expect(stub.calls.every((c) => c.method !== "PUT")).toBe(true);
    expect(errorText()).toContain("New executions are paused.");
  });

  it.each([
    ["a 502 from the resolve", { status: 502, body: { error: "Could not resolve the run: Exited with code 1" } }],
    ["a busy refusal", { status: 503, body: { error: "Too many run-settings reads in flight" } }],
  ])("starts as a plain execute when the run settings cannot be read (%s)", async (_label, prep) => {
    // The read only snapshots the defaults onto a task with none. Failing it
    // must not cost the start: the bare execute lets `ndx work` apply whatever
    // the task carries, and the server's gates still apply.
    const stub = stubStartFetch({ prep });
    mount();

    await clickPrimary();

    expect(stub.saves()).toHaveLength(0);
    expect(stub.executes().map((c) => c.body)).toEqual([{ taskId: "t-1" }]);
    expect(errorText()).toBeNull();
  });

  it("starts as a plain execute when the read itself throws", async () => {
    const stub = stubStartFetch();
    const inner = stub.fetch.getMockImplementation()!;
    stub.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/hench/prep/")) throw new Error("network down");
      return inner(url, init);
    });
    mount();

    await clickPrimary();

    expect(stub.executes().map((c) => c.body)).toEqual([{ taskId: "t-1" }]);
  });

  it("sends no saveRun on a run the read says will be refused, and lets the execute report it", async () => {
    const refusal = { code: "tree-not-conformant", message: "Run 'rex migrate-slugs'.", migratable: true };
    const stub = stubStartFetch({
      prep: prepFixture({ refusals: [refusal] }),
      execute: { status: 412, body: { error: "Run 'rex migrate-slugs'.", migratable: true } },
    });
    mount();

    await clickPrimary();

    expect(stub.executes().map((c) => c.body)).toEqual([{ taskId: "t-1" }]);
    expect(errorText()).toContain("rex migrate-slugs");
    expect(root!.querySelector(".start-task-migrate-btn")).not.toBeNull();
  });

  it("starts as a plain execute against a server that cannot save (no version in the read)", async () => {
    const stub = stubStartFetch({ prep: prepFixture({ savedVersion: undefined }) });
    mount();

    await clickPrimary();

    expect(stub.executes().map((c) => c.body)).toEqual([{ taskId: "t-1" }]);
  });

  it("carries saveRun with the run mode, and the hub's queued 202 is shown, not started", async () => {
    const stub = stubStartFetch({
      prep: prepFixture(),
      execute: { status: 202, body: { queued: true, position: 1, reason: "at-capacity" } },
    });
    const onStarted = vi.fn();
    mount({ onStarted, runModes: true });
    const select = root!.querySelector<HTMLSelectElement>(".start-task-mode-select")!;
    await act(async () => {
      select.value = "loop";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await clickPrimary();

    expect(stub.executes()[0].body).toMatchObject({ taskId: "t-1", mode: "loop", saveRun: { version: "none" } });
    expect(stub.saves()).toHaveLength(0);
    expect(root!.querySelector(".prep-queued")!.textContent).toContain("position 1");
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("names the new action for assistive tech", () => {
    stubStartFetch();
    mount();
    const primary = root!.querySelector<HTMLButtonElement>(".start-task-primary")!;
    expect(primary.textContent).toBe("Start Working");
    expect(primary.getAttribute("aria-label")).toBe("Start a run of this task now, with its saved run settings");
    const caret = root!.querySelector<HTMLButtonElement>(".start-task-caret")!;
    expect(caret.getAttribute("aria-label")).toBe("Open the run settings for this task");
    expect(caret.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("keeps a caller's accessible name on the primary and names the arrow after it", () => {
    stubStartFetch();
    mount({ ariaLabel: "Start working in feat on Next up" });
    expect(root!.querySelector(".start-task-primary")!.getAttribute("aria-label")).toBe("Start working in feat on Next up");
    expect(root!.querySelector(".start-task-caret")!.getAttribute("aria-label")).toBe("Run settings: Start working in feat on Next up");
  });
});

describe("Start Working: the arrow", () => {
  it("opens the Prepare task modal directly, addressing the workspace, and starts nothing", async () => {
    const stub = stubStartFetch({ prep: prepFixture() });
    mount({ workspace: "feat" });

    await act(async () => { root!.querySelector<HTMLButtonElement>(".start-task-caret")!.click(); });
    await settle();

    expect(root!.querySelector('[role="menu"]')).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(stub.executes()).toHaveLength(0);
    expect(stub.saves()).toHaveLength(0);
    const read = stub.calls.find((c) => c.url === "/api/hench/prep/t-1");
    expect(read?.headers["X-Ndx-Workspace"]).toBe("feat");
  });
});
