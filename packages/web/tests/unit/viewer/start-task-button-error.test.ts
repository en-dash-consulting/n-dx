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

/** Open the menu and choose "Start now" — the one-click run with no options. */
async function chooseStartNow(): Promise<void> {
  await act(async () => {
    root!.querySelector<HTMLButtonElement>(".start-task-caret")!.click();
  });
  await act(async () => {
    root!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function clickStart(onStarted = () => {}): Promise<void> {
  root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted }));
  await chooseStartNow();
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

  // The hub answers 202 when it holds the run back. That is accepted, not started.
  it("shows the queue position and reason, never started, when the hub queues the run", async () => {
    stubFetch(202, { queued: true, position: 2, reason: "at-capacity" });

    const onStarted = vi.fn();
    await clickStart(onStarted);

    const notice = root!.querySelector(".start-task-notice");
    expect(notice!.textContent).toContain("Queued");
    expect(notice!.textContent).toContain("position 2");
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("starts with no options: the body is the task id alone", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted: () => {}, workspace: "feat" }));

    await chooseStartNow();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(JSON.parse(init.body)).toEqual({ taskId: "t-1" });
    expect(init.headers["X-Ndx-Workspace"]).toBe("feat");
  });
});

describe("StartTaskButton primary click", () => {
  it("opens the Prepare task modal, addressing the workspace, and starts nothing", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "x" }) }));
    vi.stubGlobal("fetch", fetchMock);
    root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted: () => {}, workspace: "feat" }));

    await act(async () => {
      root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const calls = fetchMock.mock.calls as unknown as Array<[string, { method: string; headers: Record<string, string> }]>;
    expect(calls.every(([url]) => url !== "/api/hench/execute")).toBe(true);
    const prep = calls.find(([url]) => url === "/api/hench/prep/t-1");
    expect(prep?.[1].headers["X-Ndx-Workspace"]).toBe("feat");
  });
});

/**
 * The dashboard half of the migration offer.
 *
 * The server has no session and no auth, so consent to a whole-tree rename is
 * not inferred from the request — it is carried by a second, explicit one. This
 * button is where that second request comes from, which makes two of its
 * properties load-bearing: the offer appears only when the server says a
 * migration would fix the refusal, and accepting it does *not* count as
 * starting the task.
 */
describe("StartTaskButton migration offer", () => {
  const REFUSAL =
    "1 path in the PRD tree does not match slug rule 2, which this build implements.\n" +
    "Run 'rex migrate-slugs' on the default branch to bring the tree onto rule 2.";

  /** Answer the first POST with the refusal and the second with a result. */
  function stubRefusalThen(second: { status: number; body: unknown }): ReturnType<typeof vi.fn> {
    const calls: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      const first = calls.length === 1;
      const status = first ? 412 : second.status;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (first ? { error: REFUSAL, migratable: true } : second.body),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  async function clickMigrate(): Promise<void> {
    await act(async () => {
      root!.querySelector<HTMLButtonElement>(".start-task-migrate-btn")!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("offers the migration when the server says one would fix it", async () => {
    stubFetch(412, { error: REFUSAL, migratable: true });

    await clickStart();

    expect(root!.querySelector(".start-task-migrate-btn")).not.toBeNull();
    expect(root!.querySelector(".start-task-error")!.textContent).toContain("rex migrate-slugs");
  });

  // The refusal must not auto-clear the way a transient failure does: wiping a
  // multi-line explanation and the button that fixes it after four seconds is
  // how the offer would go unnoticed.
  it("keeps a migratable refusal on screen past the transient-error timeout", async () => {
    vi.useFakeTimers();
    try {
      stubFetch(412, { error: REFUSAL, migratable: true });
      root = renderToDiv(h(StartTaskButton, { taskId: "t-1", onStarted: () => {} }));
      await act(async () => {
        root!.querySelector<HTMLButtonElement>(".start-task-caret")!.click();
      });
      await act(async () => {
        root!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
        await vi.advanceTimersByTimeAsync(0);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(root!.querySelector(".start-task-error")).not.toBeNull();
      expect(root!.querySelector(".start-task-migrate-btn")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A refusal the operator cannot fix from here gets no button — the advice in
  // the message is to upgrade rex, and a migrate button beside it would
  // contradict what they are reading.
  it("offers nothing when the refusal is not migratable", async () => {
    stubFetch(412, { error: "Upgrade rex to a build that implements slug rule 3.", migratable: false });

    await clickStart();

    expect(root!.querySelector(".start-task-migrate-btn")).toBeNull();
  });

  it("sends migrateSlugs on the second request and reports the result", async () => {
    const fetchMock = stubRefusalThen({
      status: 200,
      body: { migrated: true, message: "The PRD tree was migrated. Review it and commit it." },
    });

    const onStarted = vi.fn();
    await clickStart(onStarted);
    await clickMigrate();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ taskId: "t-1" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      taskId: "t-1",
      migrateSlugs: true,
    });

    // Migrating is not starting: the run did not begin, so nothing may refresh
    // as though it had.
    expect(onStarted).not.toHaveBeenCalled();
    expect(root!.querySelector(".start-task-notice")!.textContent).toContain("Review it");
    // The offer is spent, and the refusal it hung under is gone.
    expect(root!.querySelector(".start-task-migrate-btn")).toBeNull();
    expect(root!.querySelector(".start-task-error")).toBeNull();
  });

  it("shows the reason when the migration itself fails", async () => {
    stubRefusalThen({ status: 500, body: { error: "'rex migrate-slugs' did not complete: exit 1." } });

    await clickStart();
    await clickMigrate();

    expect(root!.querySelector(".start-task-error")!.textContent).toContain("did not complete");
  });
});
