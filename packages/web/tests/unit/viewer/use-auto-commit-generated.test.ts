// @vitest-environment jsdom
/**
 * Tests for useAutoCommitGenerated: when the toggle is on and every dirty
 * file came from the same tool, commit it without being asked — and in every
 * other case, do nothing at all.
 *
 * The server is the authority (it re-reads the toggle and re-derives the
 * paths), so these tests are about what the client is willing to *ask* for.
 * Asking when it should not is the failure that matters: an unattended commit
 * of a tree holding the user's own work.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

import { useAutoCommitGenerated } from "../../../src/viewer/hooks/use-auto-commit-generated.js";
import type { GitStatus, GitFileOrigin } from "../../../src/viewer/hooks/use-git-status.js";

function statusWith(origin: GitFileOrigin, scope: GitFileOrigin | null, paths = ["a.md"]): GitStatus {
  return {
    isRepo: true,
    branch: "main",
    dirty: true,
    files: paths.map((path) => ({ path, code: " M", status: "modified" as const, origin })),
    scope,
  };
}

function Harness({ status, enabled, onCommitted }: {
  status: GitStatus | null; enabled: boolean; onCommitted: () => void;
}) {
  useAutoCommitGenerated(status, enabled, onCommitted);
  return h("div", null, null);
}

describe("useAutoCommitGenerated", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  function mount(status: GitStatus | null, enabled: boolean, onCommitted = vi.fn()) {
    act(() => { render(h(Harness, { status, enabled, onCommitted }), root); });
    return onCommitted;
  }

  it("commits a tree that is all PRD files", async () => {
    const onCommitted = mount(statusWith("prd", "prd"), true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/git/commit");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scope: "prd", auto: true });
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalled());
  });

  it("commits a tree that is all scan output", async () => {
    mount(statusWith("analysis", "analysis"), true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ scope: "analysis", auto: true });
  });

  it("does nothing while the toggle is off", async () => {
    mount(statusWith("prd", "prd"), false);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the tree is mixed", async () => {
    // scope null is how the server reports "more than one origin in here".
    mount(statusWith("prd", null), true);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for a tree of the user's own work", async () => {
    mount(statusWith("other", "other"), true);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the tree is clean", async () => {
    mount({ isRepo: true, branch: "main", dirty: false, files: [], scope: null }, true);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fire again for the same dirty tree", async () => {
    const status = statusWith("prd", "prd");
    const onCommitted = vi.fn();
    act(() => { render(h(Harness, { status, enabled: true, onCommitted }), root); });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A later poll returning an identical tree must not commit twice.
    act(() => { render(h(Harness, { status: statusWith("prd", "prd"), enabled: true, onCommitted }), root); });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fires again once the tree actually changes", async () => {
    const onCommitted = vi.fn();
    act(() => { render(h(Harness, { status: statusWith("prd", "prd", ["a.md"]), enabled: true, onCommitted }), root); });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => { render(h(Harness, { status: statusWith("prd", "prd", ["a.md", "b.md"]), enabled: true, onCommitted }), root); });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
