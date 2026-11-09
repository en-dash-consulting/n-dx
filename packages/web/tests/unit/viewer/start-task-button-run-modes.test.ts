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
 * Start Task is a split button: the primary click is the one-click run, and
 * the arrow opens the Prepare task modal. The picker rides with the primary
 * click — the modal configures one run of one task and prints the command line
 * for it, while the mode says how many tasks the click works through.
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
import { stubStartFetch } from "../../helpers/start-task-fetch.js";

let root: HTMLDivElement | undefined;

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  vi.restoreAllMocks();
});

/** Stub a successful start for a task carrying saved settings, and return the recorder. */
function stubOk() {
  return stubStartFetch({ execute: { status: 202, body: { runId: "r1" } } });
}

/** The JSON body of the Nth execute POST. */
function bodyOf(stub: ReturnType<typeof stubOk>, call = 0): Record<string, unknown> {
  const body = stub.executes()[call]?.body;
  if (!body) throw new Error(`execute call ${call} had no JSON body`);
  return body;
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

const primary = () => root!.querySelector<HTMLButtonElement>(".start-task-primary")!;

/** The primary click — the one-click run the picker qualifies. */
async function clickStart(): Promise<void> {
  await act(async () => { primary().click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("StartTaskButton run modes", () => {
  it("renders no picker unless the caller asks for one", () => {
    render();
    expect(root!.querySelector(".start-task-mode-select")).toBeNull();
  });

  it("sends no mode at all for a single run, so old and new clients agree", async () => {
    const stub = stubOk();
    render({ runModes: true });
    await clickStart();
    expect(bodyOf(stub)).toEqual({ taskId: "t-1" });
  });

  it("sends mode=loop when the operator picks until-done", async () => {
    const stub = stubOk();
    render({ runModes: true });
    await setMode("loop");
    await clickStart();
    expect(bodyOf(stub)).toEqual({ taskId: "t-1", mode: "loop" });
  });

  it("sends mode=iterations with the chosen count", async () => {
    const stub = stubOk();
    render({ runModes: true });
    await setMode("iterations");
    const input = root!.querySelector<HTMLInputElement>(".start-task-iterations")!;
    await act(async () => {
      input.value = "7";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickStart();
    expect(bodyOf(stub)).toEqual({ taskId: "t-1", mode: "iterations", iterations: 7 });
  });

  it("clamps the count to what the server will accept", async () => {
    // The route answers 400 outside 2..MAX. Clamping in the input stops the
    // operator at the boundary instead of after a failed click.
    const stub = stubOk();
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
      expect(bodyOf(stub, stub.executes().length - 1).iterations, typed).toBe(expected);
      await setMode("iterations");
    }
  });

  it("says on the primary button how much work the click starts", async () => {
    render({ runModes: true, label: "Start working" });
    expect(primary().textContent).toBe("Start working");

    await setMode("loop");
    // A picker that only changed hidden behaviour is how someone launches a
    // queue-long run believing they started one task.
    expect(primary().textContent).toBe("Start working · until done");
    expect(primary().getAttribute("aria-label")).toContain("until the queue is empty");

    await setMode("iterations");
    expect(primary().textContent).toContain("3 tasks");
    expect(primary().getAttribute("aria-label")).toContain("3 tasks in a row");
  });

  it("leaves the arrow to the modal, which configures one task whatever the mode", async () => {
    const stub = stubOk();
    render({ runModes: true, label: "Start working" });
    await setMode("loop");

    await act(async () => { root!.querySelector<HTMLButtonElement>(".start-task-caret")!.click(); });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(stub.executes()).toHaveLength(0);
    // The selection is untouched: nothing started.
    expect(root!.querySelector<HTMLSelectElement>(".start-task-mode-select")!.value).toBe("loop");
  });

  it("falls back to one task after a run starts", async () => {
    const stub = stubOk();
    render({ runModes: true });
    await setMode("loop");
    await clickStart();
    expect(bodyOf(stub, 0).mode).toBe("loop");
    expect(root!.querySelector<HTMLSelectElement>(".start-task-mode-select")!.value).toBe("single");

    await clickStart();
    expect(bodyOf(stub, 1)).toEqual({ taskId: "t-1" });
  });

  it("keeps the selection when the server refuses, so it can be retried", async () => {
    // The opposite of the reset above: nothing started, so the operator's
    // choice is still the one they are acting on.
    stubStartFetch({ execute: { status: 409, body: { error: "Task is already being executed" } } });
    render({ runModes: true });
    await setMode("loop");
    await clickStart();
    expect(root!.querySelector<HTMLSelectElement>(".start-task-mode-select")!.value).toBe("loop");
  });
});
