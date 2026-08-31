// @vitest-environment jsdom
/**
 * Tests for GitStatusBanner: hidden state, collapsed→expanded toggle, file
 * list rendering, on-demand diff fetching, and the commit flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { GitStatusBanner } from "../../../src/viewer/components/git-status-banner.js";
import type { GitStatus } from "../../../src/viewer/hooks/use-git-status.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DIRTY: GitStatus = {
  isRepo: true,
  branch: "UI-Upgrade",
  dirty: true,
  files: [
    { path: "a.txt", code: " M", status: "modified" },
    { path: "b.txt", code: "??", status: "untracked" },
  ],
};

describe("GitStatusBanner", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("renders nothing when status is null", () => {
    render(h(GitStatusBanner, { status: null, onCommitted: vi.fn() }), root);
    expect(root.children.length).toBe(0);
  });

  it("renders nothing when the tree is clean", () => {
    render(h(GitStatusBanner, {
      status: { isRepo: true, branch: "main", dirty: false, files: [] },
      onCommitted: vi.fn(),
    }), root);
    expect(root.children.length).toBe(0);
  });

  it("renders nothing outside a git repository", () => {
    render(h(GitStatusBanner, {
      status: { isRepo: false, branch: null, dirty: false, files: [] },
      onCommitted: vi.fn(),
    }), root);
    expect(root.children.length).toBe(0);
  });

  it("shows the collapsed pill with the dirty file count", () => {
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);
    const toggle = root.querySelector(".git-status-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain("2 uncommitted files");
  });

  it("expands to show the file list and commit form on click", () => {
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);

    expect(root.querySelectorAll(".git-file-row").length).toBe(2);
    expect(root.querySelector(".git-commit-message")).not.toBeNull();
    expect(root.querySelector(".git-status-panel-header")!.textContent).toContain("2 uncommitted files");
    expect(root.querySelector(".git-status-panel-header")!.textContent).toContain("UI-Upgrade");
  });

  it("fetches and renders a diff when a file row is clicked", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      file: "a.txt", diff: "@@ -1 +1 @@\n-old\n+new", newFile: false, preview: null, truncated: false,
    }));

    const props = { status: DIRTY, onCommitted: vi.fn() };
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);

    (root.querySelector(".git-file-toggle") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/git/diff?file=${encodeURIComponent("a.txt")}`));
    render(h(GitStatusBanner, props), root);
    await vi.waitFor(() => expect(root.querySelector(".git-diff-view")).not.toBeNull());

    const diffText = root.querySelector(".git-diff-view")!.textContent;
    expect(diffText).toContain("-old");
    expect(diffText).toContain("+new");
  });

  it("submits a commit message and calls onCommitted on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, output: "abc123", dirty: false }));
    const onCommitted = vi.fn();
    const props = { status: DIRTY, onCommitted };

    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);

    const textarea = root.querySelector(".git-commit-message") as HTMLTextAreaElement;
    textarea.value = "Fix the thing";
    textarea.dispatchEvent(new Event("input"));
    render(h(GitStatusBanner, props), root);

    const commitBtn = root.querySelector(".git-commit-btn") as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(false);
    commitBtn.click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/git/commit", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ message: "Fix the thing" }),
    })));
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("disables the commit button while the message is empty", () => {
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);

    const commitBtn = root.querySelector(".git-commit-btn") as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
  });

  it("shows an error and does not call onCommitted when the commit fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "git commit failed: nothing to commit" }));
    const onCommitted = vi.fn();
    const props = { status: DIRTY, onCommitted };

    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);

    const textarea = root.querySelector(".git-commit-message") as HTMLTextAreaElement;
    textarea.value = "Fix the thing";
    textarea.dispatchEvent(new Event("input"));
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-commit-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(root.querySelector(".git-commit-error")).not.toBeNull());
    render(h(GitStatusBanner, props), root);

    expect(root.querySelector(".git-commit-error")!.textContent).toContain("nothing to commit");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("shows a confirmation before discarding, and does not call the API until confirmed", () => {
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);

    (root.querySelector(".git-discard-btn") as HTMLButtonElement).click();
    render(h(GitStatusBanner, { status: DIRTY, onCommitted: vi.fn() }), root);

    expect(fetchMock).not.toHaveBeenCalled();
    const warning = root.querySelector(".prune-confirmation-warning");
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain("permanently deleted");
    expect(root.querySelector(".git-discard-confirm-btn")!.textContent).toContain("Discard 2 Files");
    // The commit form is replaced by the confirmation, not shown alongside it.
    expect(root.querySelector(".git-commit-message")).toBeNull();
  });

  it("cancels the discard confirmation without calling the API", () => {
    const props = { status: DIRTY, onCommitted: vi.fn() };
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-discard-btn") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);

    (root.querySelector(".git-discard-cancel-btn") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.querySelector(".prune-confirmation-warning")).toBeNull();
    expect(root.querySelector(".git-commit-message")).not.toBeNull();
  });

  it("discards on confirm, sending the current dirty-file count, and calls onCommitted", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, discarded: 2, dirty: false }));
    const onCommitted = vi.fn();
    const props = { status: DIRTY, onCommitted };

    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-discard-btn") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-discard-confirm-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/git/discard", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ confirmCount: 2 }),
    })));
    await vi.waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1));
  });

  it("shows an error and returns to the form (not the warning) when discard fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: "Stale discard request: expected 2 file(s) but found 3." }));
    const onCommitted = vi.fn();
    const props = { status: DIRTY, onCommitted };

    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-discard-btn") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-discard-confirm-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(root.querySelector(".git-commit-error")).not.toBeNull());
    render(h(GitStatusBanner, props), root);

    expect(root.querySelector(".git-commit-error")!.textContent).toContain("Stale discard request");
    expect(root.querySelector(".prune-confirmation-warning")).toBeNull();
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("collapses back to the pill when the close button is clicked", () => {
    const props = { status: DIRTY, onCommitted: vi.fn() };
    render(h(GitStatusBanner, props), root);
    (root.querySelector(".git-status-toggle") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    expect(root.querySelector(".git-status-panel")).not.toBeNull();

    (root.querySelector(".git-status-close") as HTMLButtonElement).click();
    render(h(GitStatusBanner, props), root);
    expect(root.querySelector(".git-status-panel")).toBeNull();
    expect(root.querySelector(".git-status-toggle")).not.toBeNull();
  });
});
