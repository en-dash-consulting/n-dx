// @vitest-environment jsdom
/**
 * Start Task must show the server's refusal, not swallow it.
 *
 * The button is the dashboard's end of every pre-run gate: a task held by
 * another worktree (409), executions paused (503), and — since the PRD write
 * guards — a PRD tree this build would re-slug (412). Those refusals exist to
 * be read, and the route goes to the trouble of naming the offending paths and
 * the `rex migrate-slugs` fix. A button that reported a bare "Failed (412)"
 * would leave the operator with a repository they cannot act on and no stated
 * reason, which is the silence the guards were added to end.
 *
 * @see packages/web/src/viewer/components/start-task-button.ts
 * @see packages/web/src/server/routes-hench.ts — refuseNonConformantTree
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { StartTaskButton } from "../../../src/viewer/components/start-task-button.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

let root: HTMLDivElement | undefined;

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  vi.restoreAllMocks();
});

/** Respond to the execute POST with one status and JSON body. */
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

async function clickStart(onStarted = () => {}): Promise<void> {
  root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted }));
  await act(async () => {
    root!.querySelector<HTMLButtonElement>(".start-task-btn")!.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("StartTaskButton refusal display", () => {
  it("shows a 412 tree-conformance refusal verbatim, including the fix", async () => {
    const message =
      "1 path in the PRD tree does not match slug rule 2, which this build implements. " +
      "They would be rewritten by the first write this run makes.\n" +
      "  ./child-process-cleanup-and-exit-epicab should be child-process-cleanup-and-exit-hygiene (Child Process Cleanup And Exit Hygiene)\n" +
      "Run 'rex migrate-slugs' on the default branch to bring the tree onto rule 2.";
    stubFetch(412, { error: message });

    const onStarted = vi.fn();
    await clickStart(onStarted);

    const alert = root!.querySelector(".start-task-error");
    expect(alert).not.toBeNull();
    expect(alert!.getAttribute("role")).toBe("alert");
    expect(alert!.textContent).toContain("rex migrate-slugs");
    expect(alert!.textContent).toContain("does not match slug rule 2");
    // A refused start is not a start: nothing should refresh as though a run began.
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("falls back to the status code only when the body names no error", async () => {
    stubFetch(500, {});

    await clickStart();

    expect(root!.querySelector(".start-task-error")!.textContent).toContain("500");
  });

  it("shows nothing and signals the caller when the run starts", async () => {
    stubFetch(200, { runId: "exec-1" });

    const onStarted = vi.fn();
    await clickStart(onStarted);

    expect(root!.querySelector(".start-task-error")).toBeNull();
    expect(onStarted).toHaveBeenCalledOnce();
  });
});
