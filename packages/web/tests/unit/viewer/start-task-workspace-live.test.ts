// @vitest-environment jsdom
/**
 * Starting a run from a Workspaces card opens Live in the card's workspace.
 *
 * The SPA's Live view reads the viewer's own workspace, so a run started in
 * another worktree is only visible under that worktree's URL — the hand-off
 * (and the queued notice's link) must be a full navigation to
 * `/w/<key>/live/task/<id>`, with the hub's `/p/<id>` prefix kept. A card for
 * the viewer's own workspace still opens Live in-app.
 *
 * @see src/viewer/views/workspaces.ts — workspaceLiveTaskUrl
 * @see src/viewer/components/start-task-button.ts
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { StartTaskButton } from "../../../src/viewer/components/start-task-button.js";
import { workspaceLiveTaskUrl } from "../../../src/viewer/views/workspaces.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { prepFixture } from "../../helpers/prep-fixture.js";

let root: HTMLDivElement | undefined;
const assign = vi.fn();

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
  assign.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(executeReply: { status: number; body: unknown }): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "GET" && url.startsWith("/api/hench/prep/")) {
      return { ok: true, status: 200, json: async () => prepFixture() };
    }
    if (url === "/api/hench/execute") {
      return { ok: executeReply.status < 300, status: executeReply.status, json: async () => executeReply.body };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/p/app/workspaces" });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

const card = { key: "feature", isAnchor: false };
const liveHref = (id: string) => workspaceLiveTaskUrl(card, id, "/p/app/workspaces");

async function openModal(props: Record<string, unknown>): Promise<void> {
  root = renderToDiv(h(StartTaskButton, { taskId: "t 1", onStarted: () => {}, workspace: "feature", ...props }));
  await act(async () => { root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click(); });
  await flush();
}

describe("workspaceLiveTaskUrl", () => {
  it("keeps the hub prefix and the workspace slot, and encodes the id", () => {
    expect(workspaceLiveTaskUrl(card, "a b", "/p/app/workspaces")).toBe("/p/app/w/feature/live/task/a%20b");
    expect(workspaceLiveTaskUrl(card, "t", "/workspaces")).toBe("/w/feature/live/task/t");
  });

  it("uses no slot for the anchor", () => {
    expect(workspaceLiveTaskUrl({ key: "main", isAnchor: true }, "t", "/p/app/w/feature/workspaces")).toBe("/p/app/live/task/t");
  });
});

describe("Start from a card for another workspace", () => {
  it("navigates to that workspace's Live page after a start", async () => {
    stubFetch({ status: 200, body: {} });
    const navigateTo = vi.fn();
    await openModal({ liveHref, navigateTo });
    await act(async () => { button("Execute").click(); });
    await flush();

    expect(assign).toHaveBeenCalledWith("/p/app/w/feature/live/task/t%201");
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("points the queued notice's link at that workspace and navigates there", async () => {
    stubFetch({ status: 202, body: { queued: true, position: 1, reason: "at-capacity", taskId: "t 1" } });
    await openModal({ liveHref });
    await act(async () => { button("Execute").click(); });
    await flush();

    const link = document.querySelector<HTMLAnchorElement>(".prep-queued a")!;
    expect(link.getAttribute("href")).toBe("/p/app/w/feature/live/task/t%201");
    await act(async () => { link.click(); });
    expect(assign).toHaveBeenCalledWith("/p/app/w/feature/live/task/t%201");
  });
});

describe("Start from the viewer's own workspace", () => {
  it("still opens Live in-app", async () => {
    stubFetch({ status: 200, body: {} });
    const navigateTo = vi.fn();
    await openModal({ navigateTo });
    await act(async () => { button("Execute").click(); });
    await flush();

    expect(navigateTo).toHaveBeenCalledWith("live-task", { taskId: "t 1" });
    expect(assign).not.toHaveBeenCalled();
  });
});
