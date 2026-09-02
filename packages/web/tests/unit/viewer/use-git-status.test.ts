// @vitest-environment jsdom
/**
 * Tests for the useGitStatus hook: fetches once on mount, exposes a
 * refetch(), and re-fetches on each poll tick.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";

let capturedPoll: (() => Promise<void>) | null = null;

vi.mock("../../../src/viewer/views/use-polling.js", () => ({
  usePolling: vi.fn((_key: string, cb: () => Promise<void>) => {
    capturedPoll = cb;
  }),
}));

import { useGitStatus } from "../../../src/viewer/hooks/use-git-status.js";
import type { GitStatus } from "../../../src/viewer/hooks/use-git-status.js";

let hookResult: { status: GitStatus | null; refetch: () => Promise<void> } | null = null;

function TestHarness() {
  hookResult = useGitStatus();
  return h("div", null, JSON.stringify(hookResult!.status));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CLEAN: GitStatus = { isRepo: true, branch: "main", dirty: false, files: [] };
const DIRTY: GitStatus = {
  isRepo: true, branch: "main", dirty: true,
  files: [{ path: "a.txt", code: " M", status: "modified" }],
};

describe("useGitStatus", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    capturedPoll = null;
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, CLEAN));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("fetches status once on mount", async () => {
    render(h(TestHarness, null), root);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    render(h(TestHarness, null), root);

    expect(fetchMock).toHaveBeenCalledWith("/api/git/status");
    expect(hookResult!.status).toEqual(CLEAN);
  });

  it("refetches on each poll tick", async () => {
    render(h(TestHarness, null), root);
    await vi.waitFor(() => expect(capturedPoll).toBeInstanceOf(Function));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValue(jsonResponse(200, DIRTY));
    await capturedPoll!();
    render(h(TestHarness, null), root);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hookResult!.status).toEqual(DIRTY);
  });

  it("exposes a manual refetch that updates status", async () => {
    render(h(TestHarness, null), root);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValue(jsonResponse(200, DIRTY));
    await hookResult!.refetch();
    render(h(TestHarness, null), root);

    expect(hookResult!.status).toEqual(DIRTY);
  });

  it("keeps the last known status when a fetch fails", async () => {
    render(h(TestHarness, null), root);
    await vi.waitFor(() => expect(capturedPoll).toBeInstanceOf(Function));
    await vi.waitFor(() => expect(hookResult!.status).toEqual(CLEAN));

    fetchMock.mockRejectedValue(new Error("network down"));
    await capturedPoll!();
    render(h(TestHarness, null), root);

    expect(hookResult!.status).toEqual(CLEAN);
  });
});
