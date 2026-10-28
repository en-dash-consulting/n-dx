// @vitest-environment jsdom
/**
 * The status dock holds the active-operations and refresh-queue pills only.
 * Working-tree status is a bottom-bar chip, and no worktrees pill remains.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BottomBar } from "../../../src/viewer/components/bottom-bar.js";
import type { ViewId } from "../../../src/viewer/api.js";
import type { GitStatus } from "../../../src/viewer/hooks/use-git-status.js";

const VIEWER = join(__dirname, "../../../src/viewer");
const read = (rel: string) => readFileSync(join(VIEWER, rel), "utf8");

const DIRTY: GitStatus = {
  isRepo: true,
  branch: "main",
  dirty: true,
  files: [
    { path: "a.txt", code: " M", status: "modified", origin: "other" },
    { path: "b.txt", code: "??", status: "untracked", origin: "other" },
  ],
  scope: null,
};
const CLEAN: GitStatus = { isRepo: true, branch: "main", dirty: false, files: [], scope: null };

describe("bottom bar working-tree chip", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  const bar = (gitStatus: GitStatus | null) =>
    act(() => {
      render(h(BottomBar, {
        validViews: new Set<ViewId>(),
        onNavigate: vi.fn(),
        onOpenSettings: vi.fn(),
        settingsOpen: false,
        onToggleCommands: vi.fn(),
        commandsOpen: false,
        gitStatus,
        onGitCommitted: vi.fn(),
      }), root);
    });

  it("shows an 'N uncommitted' chip that opens the commit panel when the tree is dirty", () => {
    bar(DIRTY);
    const toggle = root.querySelector(".bottombar .git-status-toggle") as HTMLButtonElement;
    expect(toggle.textContent).toContain("2 uncommitted");
    act(() => { toggle.click(); });
    expect(root.querySelector(".bottombar .git-status-panel")).not.toBeNull();
  });

  it("shows nothing when the tree is clean", () => {
    bar(CLEAN);
    expect(root.querySelector(".git-status-chip")).toBeNull();
    bar(null);
    expect(root.querySelector(".git-status-chip")).toBeNull();
  });
});

describe("status dock", () => {
  it("no longer mounts the worktrees pill or the working-tree pill", () => {
    const main = read("main.ts");
    const dock = main.slice(main.indexOf('class: "status-dock"'));
    expect(dock).not.toContain("SessionsPanel");
    expect(dock).not.toContain("GitStatusChip");
    expect(dock).toContain("ActiveOperationsTray");
    expect(dock).toContain("RefreshQueueStatus");
    expect(existsSync(join(VIEWER, "components/sessions-panel.ts"))).toBe(false);
    expect(existsSync(join(VIEWER, "styles/sessions-panel.css"))).toBe(false);
  });

  it("styles no working-tree pill in the dock", () => {
    expect(read("styles/status-dock.css")).not.toMatch(/git-status|sessions/);
  });

  it("still sits left of an open Sidecar drawer", () => {
    expect(read("styles/sidecar.css")).toMatch(/\.status-dock\s*\{\s*right:\s*calc\(1rem \+ var\(--sidecar-w, 0px\)\)/);
  });
});
