/**
 * Breadcrumb hub navigation — the "Hub" link and the project switcher.
 *
 * Behind the hub, the breadcrumb starts with a "Hub" link to the chooser at
 * `/hub`, and the project name opens a menu of every registered project.
 * Choosing one opens the same view under that project's `/p/<id>/` prefix —
 * a full navigation, since the viewer derives its base path once at boot.
 *
 * Whether there is a hub is asked, not inferred from the URL: with one
 * project registered the hub serves it at the root alias, so a dashboard at
 * `/` may still be behind one. `GET /api/hub/projects` is answered by the hub
 * under any base path and by nothing else — a standalone `web serve` or a
 * static export 404s (or serves HTML), which reads as "no hub".
 *
 * Accessibility mirrors the workspace switcher: a button with
 * `aria-haspopup="listbox"` over a `listbox` of `option`s, driven by Arrow
 * keys, Home/End, Enter/Space to choose and Escape to close.
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ViewId } from "../types.js";
import { detectBasePath } from "../external.js";
import { hubUrl } from "../base-path.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One registered project, as the menu needs it. */
export interface HubProjectOption {
  id: string;
  name: string;
  /** Supervisor state: healthy, starting, unreachable, stopped. */
  state: string;
}

export interface HubProjects {
  /** True once the hub has answered; false standalone. */
  hub: boolean;
  projects: HubProjectOption[];
  /** Re-read the list — called when the menu opens. */
  reload: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Read `GET /api/hub/projects`' body, or null when it is not the hub's answer.
 * Each entry is the hub's ProjectView (`hub/hub.ts`); only id, name and the
 * supervisor state are kept.
 */
export function parseHubProjects(body: unknown): HubProjectOption[] | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { projects?: unknown }).projects;
  if (!Array.isArray(list)) return null;
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const p = entry as { id?: unknown; name?: unknown; status?: { state?: unknown } };
    if (typeof p.id !== "string") return [];
    return [{
      id: p.id,
      name: typeof p.name === "string" && p.name ? p.name : p.id,
      state: typeof p.status?.state === "string" ? p.status.state : "stopped",
    }];
  });
}

/**
 * Where project `id`'s dashboard lives for `view`. The worktree slot is
 * dropped: worktree keys belong to one repository, so another project opens
 * on its anchor.
 */
export function projectUrl(id: string, view: ViewId): string {
  return `/p/${encodeURIComponent(id)}/${view}`;
}

/** Whether `pathname` is served under project `id`'s hub prefix. */
export function isCurrentProject(id: string, pathname: string): boolean {
  return detectBasePath(pathname) === `/p/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** The hub's project list, or `hub: false` when no hub answers. */
export function useHubProjects(fetcher?: typeof fetch): HubProjects {
  const [state, setState] = useState<{ hub: boolean; projects: HubProjectOption[] }>({ hub: false, projects: [] });
  const doFetch = fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  const reload = useCallback(async () => {
    try {
      const res = await doFetch("/api/hub/projects", { headers: { accept: "application/json" } });
      if (!res.ok) { setState({ hub: false, projects: [] }); return; }
      const projects = parseHubProjects(await res.json());
      setState(projects ? { hub: true, projects } : { hub: false, projects: [] });
    } catch {
      // Not JSON (a project server's SPA fallback) or no network: no hub.
      setState({ hub: false, projects: [] });
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { ...state, reload };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** The "Hub" link — rendered only when a hub answered. */
export function HubLink() {
  return h("a", { class: "breadcrumb-link breadcrumb-hub", href: hubUrl() }, "Hub");
}

export interface ProjectSwitcherProps {
  /** Display label (already truncated). */
  label: string;
  /** Tooltip — the full name when the label was truncated. */
  title?: string;
  view: ViewId;
  hub: HubProjects;
  /** Injected for tests; defaults to a full navigation. */
  navigate?: (url: string) => void;
}

/**
 * The project name. Plain text unless the hub lists two or more projects, in
 * which case it opens a menu of them with a status dot each.
 */
export function ProjectSwitcher({ label, title, view, hub, navigate }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const go = navigate ?? ((url: string) => { window.location.assign(url); });
  const { projects, reload } = hub;
  const switchable = hub.hub && projects.length > 1;

  useEffect(() => { if (open) void reload(); }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // A reload can shorten the list under the highlight.
  useEffect(() => {
    if (highlight > projects.length - 1) setHighlight(Math.max(0, projects.length - 1));
  }, [projects.length, highlight]);

  if (!switchable) {
    return h("span", { class: "breadcrumb-project", title }, label);
  }

  const pathname = window.location.pathname;
  const isCurrent = (p: HubProjectOption) => isCurrentProject(p.id, pathname);

  const select = (p: HubProjectOption) => {
    setOpen(false);
    if (isCurrent(p)) return;
    go(projectUrl(p.id, view));
  };

  const openMenu = () => {
    setHighlight(Math.max(0, projects.findIndex(isCurrent)));
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setHighlight((i) => Math.min(projects.length - 1, i + 1)); break;
      case "ArrowUp": e.preventDefault(); setHighlight((i) => Math.max(0, i - 1)); break;
      case "Home": e.preventDefault(); setHighlight(0); break;
      case "End": e.preventDefault(); setHighlight(projects.length - 1); break;
      case "Enter":
      case " ": e.preventDefault(); if (projects[highlight]) select(projects[highlight]); break;
      case "Escape": e.preventDefault(); setOpen(false); buttonRef.current?.focus(); break;
      case "Tab": setOpen(false); break;
    }
  };

  const listId = "project-switcher-list";
  const optionId = (id: string) => `project-option-${encodeURIComponent(id)}`;

  return h("div", { class: "breadcrumb-switcher", ref: rootRef, onKeyDown },
    h("button", {
      ref: buttonRef,
      type: "button",
      class: "breadcrumb-project breadcrumb-project-trigger",
      title,
      "aria-haspopup": "listbox",
      "aria-expanded": String(open),
      "aria-controls": listId,
      "aria-label": `Project: ${title ?? label}. Switch project`,
      onClick: () => { if (open) setOpen(false); else openMenu(); },
    },
      label,
      h("span", { class: "breadcrumb-workspace-caret", "aria-hidden": "true" }, "▾"),
    ),
    open
      ? h("div", { class: "breadcrumb-workspace-menu" },
          h("ul", {
            id: listId,
            role: "listbox",
            class: "breadcrumb-workspace-list",
            "aria-label": "Projects",
            "aria-activedescendant": projects[highlight] ? optionId(projects[highlight].id) : undefined,
            tabIndex: -1,
          },
            projects.map((p, i) => {
              const current = isCurrent(p);
              return h("li", {
                key: p.id,
                id: optionId(p.id),
                role: "option",
                "aria-selected": String(current),
                class: `breadcrumb-workspace-option${i === highlight ? " is-highlighted" : ""}${current ? " is-current" : ""}`,
                onMouseEnter: () => setHighlight(i),
                onClick: () => select(p),
              },
                h("span", { class: "breadcrumb-project-option-name" },
                  h("span", {
                    class: `breadcrumb-project-dot breadcrumb-project-dot-${p.state}`,
                    title: p.state,
                    "aria-label": p.state,
                  }),
                  p.name,
                ),
                current ? h("span", { class: "breadcrumb-workspace-meta" }, "current") : null,
              );
            }),
          ),
          h("a", { class: "breadcrumb-workspace-footer", href: hubUrl() }, "Open the hub"),
        )
      : null,
  );
}
