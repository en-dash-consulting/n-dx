// @vitest-environment jsdom
/**
 * Start Working runs in one click, with the task's saved settings; its arrow
 * opens the settings.
 *
 * The primary click reads the task's run settings, saves the project defaults
 * on a task that has none (so what the run used is on the task afterwards),
 * and posts the execute — never opening the Prepare task modal. The arrow is
 * the way into the modal, with no menu in between. A save that fails starts
 * nothing: a run must not begin on settings that were meant to be recorded
 * and were not.
 *
 * @see packages/web/src/viewer/components/start-task-button.ts
 * @see packages/web/src/viewer/components/prepare-task-model.ts — defaultsRunBlockOf
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
  it("starts a task with saved settings at once: no modal, no save, the execute alone", async () => {
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

  it("saves the project defaults on a task with none, then starts it, in the same click", async () => {
    const prep = prepFixture();
    const stub = stubStartFetch({ prep });
    const onStarted = vi.fn();
    mount({ onStarted });

    await clickPrimary();

    expect(dialog()).toBeNull();
    expect(stub.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/hench/prep/t-1",
      "PUT /api/hench/prep/t-1",
      "POST /api/hench/execute",
    ]);
    // The block is what the modal would show, sent with the version the read
    // reported — the modal's Save semantics.
    const [save] = stub.saves();
    expect(save.body).toEqual({ run: defaultsRunBlockOf(prep), version: "none" });
    expect(save.body!.run).toMatchObject({ models: { claude: "claude-sonnet" }, provider: "api" });
    expect(stub.executes()[0].body).toEqual({ taskId: "t-1" });
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("sends the workspace header on the read, the save and the execute", async () => {
    const stub = stubStartFetch({ prep: prepFixture() });
    mount({ workspace: "feat" });

    await clickPrimary();

    expect(stub.calls).toHaveLength(3);
    for (const call of stub.calls) expect(call.headers["X-Ndx-Workspace"], call.url).toBe("feat");
  });

  it("starts nothing when the save is refused, and says why until the next click", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubStartFetch({
        prep: prepFixture(),
        save: { status: 400, body: { error: 'Run setting "models.claude": Model "x" is not in the claude catalog.' } },
      });
      const onStarted = vi.fn();
      mount({ onStarted });

      await act(async () => {
        root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click();
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

      expect(stub.executes()).toHaveLength(0);
      expect(onStarted).not.toHaveBeenCalled();
      expect(errorText()).toContain("nothing was started");
      expect(errorText()).toContain("not in the claude catalog");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start on settings someone else saved between the read and the save (409)", async () => {
    const stub = stubStartFetch({
      prep: prepFixture(),
      save: { status: 409, body: { error: "changed", conflict: true, saved: { tier: "light" }, version: "abc" } },
    });
    const onStarted = vi.fn();
    mount({ onStarted });

    await clickPrimary();

    expect(stub.executes()).toHaveLength(0);
    expect(onStarted).not.toHaveBeenCalled();
    expect(errorText()).toContain("saved on this task by someone else");
  });

  it("starts nothing when the run settings cannot be read", async () => {
    const stub = stubStartFetch({ prep: { status: 502, body: { error: "Could not resolve the run: Exited with code 1" } } });
    mount();

    await clickPrimary();

    expect(stub.saves()).toHaveLength(0);
    expect(stub.executes()).toHaveLength(0);
    expect(errorText()).toContain("Could not resolve the run");
  });

  it("saves nothing on a run the read says will be refused, and lets the execute report it", async () => {
    const refusal = { code: "tree-not-conformant", message: "Run 'rex migrate-slugs'.", migratable: true };
    const stub = stubStartFetch({
      prep: prepFixture({ refusals: [refusal] }),
      execute: { status: 412, body: { error: "Run 'rex migrate-slugs'.", migratable: true } },
    });
    mount();

    await clickPrimary();

    expect(stub.saves()).toHaveLength(0);
    expect(stub.executes()).toHaveLength(1);
    expect(errorText()).toContain("rex migrate-slugs");
    expect(root!.querySelector(".start-task-migrate-btn")).not.toBeNull();
  });

  it("starts as a plain execute against a server that cannot save (no version in the read)", async () => {
    const stub = stubStartFetch({ prep: prepFixture({ savedVersion: undefined }) });
    mount();

    await clickPrimary();

    expect(stub.saves()).toHaveLength(0);
    expect(stub.executes()).toHaveLength(1);
  });

  it("shows a queued start from a task with no settings: saved, then queued, not started", async () => {
    const stub = stubStartFetch({
      prep: prepFixture(),
      execute: { status: 202, body: { queued: true, position: 1, reason: "at-capacity" } },
    });
    const onStarted = vi.fn();
    mount({ onStarted });

    await clickPrimary();

    expect(stub.saves()).toHaveLength(1);
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
