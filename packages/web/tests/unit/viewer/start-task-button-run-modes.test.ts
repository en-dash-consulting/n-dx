// @vitest-environment jsdom
/**
 * The run-mode picker on Start Task: one task, a set number, or a loop.
 *
 * Two things matter beyond "the right flag reaches the server". First, the
 * picker is opt-in — the Workspaces board renders one button per worktree row,
 * where the question is which worktree to start, not how much work the click
 * commits to. Second, the mode is a property of the click and not a stored
 * preference: leaving it on "until done" would turn the next, unrelated click
 * into a queue-long run the operator did not choose.
 *
 * Since the Prepare task modal landed, Start Task is a split button: the
 * primary opens the modal for one task, and the caret's menu holds Start now.
 * The picker rides with Start now — the modal configures one run of one task
 * and prints the command line for it, while the mode says how many tasks the
 * click works through.
 *
 * @see packages/web/src/viewer/components/start-task-button.ts
 * @see packages/web/src/shared/run-options.ts — the RunMode contract all three
 *      of the server, the hub queue and this picker read
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { StartTaskButton } from "../../../src/viewer/components/start-task-button.js";
import { MAX_DASHBOARD_ITERATIONS, MIN_DASHBOARD_ITERATIONS } from "../../../src/shared/index.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

let root: HTMLDivElement | undefined;

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  vi.restoreAllMocks();
});

/**
 * Stub a successful execute POST and return the spy.
 *
 * The parameters are declared even though the body ignores them: `vi.fn` takes
 * the call-argument tuple from the implementation's signature, so a zero-arg
 * stub records calls as `[]` and {@link bodyOf} has no `[1]` to read.
 */
function stubOk() {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 202,
    json: async () => ({ runId: "r1" }),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The JSON body of the Nth execute POST. */
function bodyOf(spy: ReturnType<typeof stubOk>, call = 0): Record<string, unknown> {
  const body = spy.mock.calls[call]?.[1]?.body;
  if (typeof body !== "string") {
    throw new Error(`execute call ${call} had no JSON body`);
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function render(props: Record<string, unknown> = {}) {
  root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted: () => {}, ...props }));
  return root;
}

async function setMode(value: string): Promise<void> {
  const select = root!.querySelector<HTMLSelectElement>(".start-task-mode-select")!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The caret's menu item, with the menu opened if it is not already. */
async function openStartNow(): Promise<HTMLButtonElement> {
  if (!root!.querySelector(".ready-menu")) {
    await act(async () => {
      root!.querySelector<HTMLButtonElement>(".start-task-caret")!.click();
    });
  }
  return root!.querySelector<HTMLButtonElement>(".ready-menu [role='menuitem']")!;
}

/** Start now — the one-click run the picker qualifies. */
async function clickStart(): Promise<void> {
  const item = await openStartNow();
  await act(async () => {
    item.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("StartTaskButton run modes", () => {
  it("renders no picker unless the caller asks for one", () => {
    render();
    expect(root!.querySelector(".start-task-mode-select")).toBeNull();
  });

  it("sends no mode at all for a single run, so old and new clients agree", async () => {
    const spy = stubOk();
    render({ runModes: true });
    await clickStart();
    expect(bodyOf(spy)).toEqual({ taskId: "t-1" });
  });

  it("sends mode=loop when the operator picks until-done", async () => {
    const spy = stubOk();
    render({ runModes: true });
    await setMode("loop");
    await clickStart();
    expect(bodyOf(spy)).toEqual({ taskId: "t-1", mode: "loop" });
  });

  it("sends mode=iterations with the chosen count", async () => {
    const spy = stubOk();
    render({ runModes: true });
    await setMode("iterations");
    const input = root!.querySelector<HTMLInputElement>(".start-task-iterations")!;
    await act(async () => {
      input.value = "7";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickStart();
    expect(bodyOf(spy)).toEqual({ taskId: "t-1", mode: "iterations", iterations: 7 });
  });

  it("clamps the count to what the server will accept", async () => {
    // The route answers 400 outside 2..MAX. Clamping in the input stops the
    // operator at the boundary instead of after a failed click.
    const spy = stubOk();
    render({ runModes: true });
    await setMode("iterations");
    const input = root!.querySelector<HTMLInputElement>(".start-task-iterations")!;
    for (const [typed, expected] of [
      ["999", MAX_DASHBOARD_ITERATIONS],
      ["1", MIN_DASHBOARD_ITERATIONS],
      ["0", MIN_DASHBOARD_ITERATIONS],
    ] as const) {
      await act(async () => {
        input.value = typed;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await clickStart();
      expect(bodyOf(spy, spy.mock.calls.length - 1).iterations, typed).toBe(expected);
      await setMode("iterations");
    }
  });

  it("says on Start now how much work the click starts", async () => {
    render({ runModes: true, label: "Start working" });
    expect((await openStartNow()).textContent).toBe("Start now");

    await setMode("loop");
    // A picker that only changed hidden behaviour is how someone launches a
    // queue-long run believing they started one task.
    expect((await openStartNow()).textContent).toContain("until done");
    expect((await openStartNow()).getAttribute("aria-label")).toContain("until the queue is empty");

    await setMode("iterations");
    expect((await openStartNow()).textContent).toContain("3 tasks");
  });

  it("leaves the modal's own button alone, because the modal is one task", async () => {
    // The primary opens Prepare task, which resolves and prints the command
    // line for a single run. A mode on that label would describe a run the
    // modal does not start.
    render({ runModes: true, label: "Start working" });
    const primary = root!.querySelector<HTMLButtonElement>(".start-task-primary")!;
    expect(primary.textContent).toBe("Start working");

    await setMode("loop");
    expect(primary.textContent).toBe("Start working");
  });

  it("falls back to one task after a run starts", async () => {
    const spy = stubOk();
    render({ runModes: true });
    await setMode("loop");
    await clickStart();
    expect(bodyOf(spy, 0).mode).toBe("loop");

    await clickStart();
    expect(bodyOf(spy, 1)).toEqual({ taskId: "t-1" });
  });

  it("keeps the selection when the server refuses, so it can be retried", async () => {
    // The opposite of the reset above: nothing started, so the operator's
    // choice is still the one they are acting on.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "Task is already being executed" }),
    })));
    render({ runModes: true });
    await setMode("loop");
    await clickStart();
    expect(root!.querySelector<HTMLSelectElement>(".start-task-mode-select")!.value).toBe("loop");
  });
});
