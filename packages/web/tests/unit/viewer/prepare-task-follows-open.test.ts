// @vitest-environment jsdom
/**
 * An open Prepare task modal belongs to the task it was opened for. Polling
 * hosts (Up Next, Live idle) change the button's `taskId` while the modal is
 * open; the modal must stay on the original task and Execute must post it.
 *
 * @see src/viewer/components/start-task-button.ts
 * @see src/viewer/components/prepare-task-modal.ts
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { StartTaskButton } from "../../../src/viewer/components/start-task-button.js";
import { PrepareTaskModal } from "../../../src/viewer/components/prepare-task-modal.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { prepFixture } from "../../helpers/prep-fixture.js";

let root: HTMLDivElement | undefined;
let posts: Array<{ url: string; body: Record<string, unknown> }>;
let prepUrls: string[];

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(): void {
  posts = [];
  prepUrls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    if (method === "GET" && url.startsWith("/api/hench/prep/")) {
      prepUrls.push(url);
      return { ok: true, status: 200, json: async () => prepFixture() };
    }
    posts.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : {} });
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

describe("Prepare task modal stays on the task it was opened for", () => {
  it("ignores the host's taskId changing: same prep, same Execute target", async () => {
    stubFetch();
    const props = { onStarted: () => {}, navigateTo: () => {} };
    root = renderToDiv(h(StartTaskButton, { taskId: "task-A", ...props }));
    await act(async () => { root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click(); });
    await flush();
    expect(prepUrls).toEqual(["/api/hench/prep/task-A"]);

    // The host's next task moves to B while the modal is open.
    await act(async () => { render(h(StartTaskButton, { taskId: "task-B", ...props }), root!); });
    await flush();

    expect(prepUrls).toEqual(["/api/hench/prep/task-A"]);
    expect(document.querySelector(".prep-chip-id")?.getAttribute("title")).toBe("task-A");

    await act(async () => { button("Execute").click(); });
    await flush();
    const execute = posts.find((p) => p.url === "/api/hench/execute");
    expect(execute?.body.taskId).toBe("task-A");
  });

  it("drops edits when a host swaps the modal's taskId directly", async () => {
    stubFetch();
    const common = { onClose: () => {}, onOpenLive: () => {} };
    root = renderToDiv(h(PrepareTaskModal, { taskId: "task-A", ...common }));
    await flush();
    await act(async () => { render(h(PrepareTaskModal, { taskId: "task-B", ...common }), root!); });
    await flush();

    expect(prepUrls).toEqual(["/api/hench/prep/task-A", "/api/hench/prep/task-B"]);
    expect(document.querySelectorAll(".prep-chip-id")).toHaveLength(1);
    expect(document.querySelector(".prep-chip-id")?.getAttribute("title")).toBe("task-B");
  });
});
