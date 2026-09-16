/**
 * Breadcrumb workspace switcher — the branch chip, made a menu.
 *
 * Shows "<worktree> · <branch>" for the workspace this viewer addresses and,
 * on click or keyboard, lists every worktree of the repository with the
 * anchor starred, a pulse when it has runs going, its dirty-file count, and
 * a footer link to the Workspaces overview. Choosing one navigates to the
 * same view under that worktree's `/w/<key>/` slot (or the root for the
 * anchor). It is a full navigation, not a pushState: the viewer derives its
 * base path once at boot, so a workspace change is a new page.
 *
 * Data comes from two endpoints joined by path: `GET /api/workspaces` (the
 * registry's keys) and `GET /api/worktrees` (branch, dirty state, run
 * counts). Both are cheap and cached server-side.
 *
 * Accessibility: the trigger is a button with `aria-haspopup="listbox"` and
 * `aria-expanded`; the menu is a `listbox` of `option`s driven by Arrow keys,
 * Home/End, Enter/Space to select, Escape to close, with
 * `aria-activedescendant` naming the highlighted option.
 */

import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewId } from "../types.js";
import { detectBasePath } from "../external.js";
import { getWorkspaceKey } from "../base-path.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkspaceSummary {
  key: string;
  path: string;
  branch: string | null;
  isAnchor: boolean;
  active: boolean;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  dirty: boolean | null;
  dirtyFiles: number | null;
  runs: { total: number; running: number; lastFinishedAt: string | null };
}

/** One row of the menu — registry key joined with the worktree's live state. */
export interface WorkspaceOption {
  key: string;
  path: string;
  branch: string | null;
  isAnchor: boolean;
  isCurrent: boolean;
  dirtyFiles: number | null;
  running: number;
  lastFinishedAt: string | null;
}

export interface WorkspaceSwitcherProps {
  view: ViewId;
  /** The served project's branch, from project metadata — the fallback label before the lists load. */
  branch: string | null;
  /** Injected for tests; defaults to a full navigation. */
  navigate?: (url: string) => void;
  /** Injected for tests; defaults to `fetch`. */
  fetcher?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Join the registry's workspaces with the worktree list, by path. */
export function buildWorkspaceOptions(
  workspaces: readonly WorkspaceSummary[],
  worktrees: readonly WorktreeEntry[],
  currentKey: string | null,
): WorkspaceOption[] {
  const byPath = new Map(worktrees.map((w) => [w.path, w]));
  return workspaces.map((ws) => {
    const wt = byPath.get(ws.path);
    return {
      key: ws.key,
      path: ws.path,
      branch: wt?.branch ?? ws.branch,
      isAnchor: ws.isAnchor,
      isCurrent: currentKey === null ? ws.isAnchor : ws.key === currentKey,
      dirtyFiles: wt?.dirtyFiles ?? null,
      running: wt?.runs.running ?? 0,
      lastFinishedAt: wt?.runs.lastFinishedAt ?? null,
    };
  });
}

/**
 * Where a workspace's dashboard lives for `view`: under the hub's project
 * prefix when there is one, then `/w/<key>` for a non-anchor worktree.
 */
export function workspaceUrl(option: Pick<WorkspaceOption, "key" | "isAnchor">, view: ViewId, pathname: string): string {
  const project = detectBasePath(pathname);
  const slot = option.isAnchor ? "" : `/w/${encodeURIComponent(option.key)}`;
  return `${project}${slot}/${view}`;
}

/** "3m ago", "2h ago", … for the running pulse's title. */
export function fmtElapsed(fromIso: string | null, now = Date.now()): string | null {
  if (!fromIso) return null;
  const ms = now - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hours = Math.round(m / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 2)}…` : text;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function BranchIcon() {
  return h("svg", {
    class: "breadcrumb-branch-icon",
    width: 11, height: 11, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true",
  }, h("path", { d: "M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" }));
}

export function WorkspaceSwitcher({ view, branch, navigate, fetcher }: WorkspaceSwitcherProps) {
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const currentKey = getWorkspaceKey();
  const doFetch = fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const go = navigate ?? ((url: string) => { window.location.assign(url); });

  const load = useCallback(async () => {
    try {
      const [wsRes, wtRes] = await Promise.all([doFetch("/api/workspaces"), doFetch("/api/worktrees")]);
      if (!wsRes.ok) return;
      const ws = (await wsRes.json()) as { workspaces: WorkspaceSummary[] };
      const wt = wtRes.ok ? ((await wtRes.json()) as WorktreeEntry[]) : [];
      setOptions(buildWorkspaceOptions(ws.workspaces, wt, currentKey));
    } catch {
      // Older server without the endpoints: the chip stays a plain label.
    }
  }, [currentKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = useMemo(() => options.find((o) => o.isCurrent) ?? null, [options]);
  const label = current
    ? `${current.key} · ${current.branch ?? "detached"}`
    : branch ?? null;
  const switchable = options.length > 1;

  const select = (option: WorkspaceOption) => {
    setOpen(false);
    if (option.isCurrent) return;
    go(workspaceUrl(option, view, window.location.pathname));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setHighlight(Math.max(0, options.findIndex((o) => o.isCurrent)));
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setHighlight((i) => Math.min(options.length - 1, i + 1)); break;
      case "ArrowUp": e.preventDefault(); setHighlight((i) => Math.max(0, i - 1)); break;
      case "Home": e.preventDefault(); setHighlight(0); break;
      case "End": e.preventDefault(); setHighlight(options.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); if (options[highlight]) select(options[highlight]); break;
      case "Escape": e.preventDefault(); setOpen(false); buttonRef.current?.focus(); break;
      case "Tab": setOpen(false); break;
    }
  };

  if (!label) return null;

  const listId = "workspace-switcher-list";
  const optionId = (key: string) => `workspace-option-${encodeURIComponent(key)}`;

  return h("div", { class: "breadcrumb-workspace", ref: rootRef, onKeyDown },
    h("button", {
      ref: buttonRef,
      type: "button",
      class: `breadcrumb-branch breadcrumb-workspace-trigger${switchable ? "" : " breadcrumb-workspace-trigger-static"}`,
      title: current ? `${current.path}${current.branch ? ` (${current.branch})` : ""}` : `Branch: ${label}`,
      "aria-haspopup": switchable ? "listbox" : undefined,
      "aria-expanded": switchable ? String(open) : undefined,
      "aria-controls": switchable ? listId : undefined,
      "aria-label": switchable ? `Workspace: ${label}. Switch worktree` : `Branch: ${label}`,
      disabled: !switchable,
      onClick: () => { if (switchable) setOpen((o) => !o); },
    },
      h(BranchIcon, null),
      h("span", { class: "breadcrumb-workspace-label" }, truncate(label, 32)),
      switchable ? h("span", { class: "breadcrumb-workspace-caret", "aria-hidden": "true" }, "▾") : null,
    ),
    open && switchable
      ? h("div", { class: "breadcrumb-workspace-menu" },
          h("ul", {
            id: listId,
            role: "listbox",
            class: "breadcrumb-workspace-list",
            "aria-label": "Worktrees",
            "aria-activedescendant": options[highlight] ? optionId(options[highlight].key) : undefined,
            tabIndex: -1,
          },
            options.map((o, i) =>
              h("li", {
                key: o.key,
                id: optionId(o.key),
                role: "option",
                "aria-selected": String(o.isCurrent),
                class: `breadcrumb-workspace-option${i === highlight ? " is-highlighted" : ""}${o.isCurrent ? " is-current" : ""}`,
                onMouseEnter: () => setHighlight(i),
                onClick: () => select(o),
              },
                h("span", { class: "breadcrumb-workspace-name" },
                  o.isAnchor ? h("span", { class: "breadcrumb-workspace-anchor", title: "Anchor worktree", "aria-label": "anchor" }, "★ ") : null,
                  o.key,
                  o.branch ? h("span", { class: "breadcrumb-workspace-option-branch" }, ` · ${o.branch}`) : null,
                ),
                h("span", { class: "breadcrumb-workspace-meta" },
                  o.running > 0
                    ? h("span", {
                        class: "breadcrumb-workspace-pulse",
                        title: `${o.running} run${o.running === 1 ? "" : "s"} in progress${o.lastFinishedAt ? `; last finished ${fmtElapsed(o.lastFinishedAt)}` : ""}`,
                        "aria-label": `${o.running} running`,
                      })
                    : o.lastFinishedAt
                      ? h("span", { class: "breadcrumb-workspace-elapsed", title: `Last run finished ${o.lastFinishedAt}` }, fmtElapsed(o.lastFinishedAt))
                      : null,
                  o.dirtyFiles !== null && o.dirtyFiles > 0
                    ? h("span", { class: "breadcrumb-workspace-dirty", title: `${o.dirtyFiles} uncommitted change${o.dirtyFiles === 1 ? "" : "s"}` }, `${o.dirtyFiles} dirty`)
                    : null,
                ),
              ),
            ),
          ),
          h("a", {
            class: "breadcrumb-workspace-footer",
            href: workspaceUrl({ key: "", isAnchor: true }, "workspaces" as ViewId, window.location.pathname),
          }, "Open Workspaces overview"),
        )
      : null,
  );
}
