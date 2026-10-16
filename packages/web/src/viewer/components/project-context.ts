/**
 * The project context in the top bar: which project and which checkout this
 * dashboard is showing, and the way to the others.
 *
 *  - Behind the hub, a "Hub" link to the hub home page.
 *  - The project name — a menu of the hub's registered projects when there is
 *    more than one (`project-switcher.ts`).
 *  - The workspace chip, "<worktree> · <branch>" — a menu of the repository's
 *    worktrees when there is more than one (`workspace-switcher.ts`).
 *
 * It replaced the breadcrumb row above the page. The stage and view segments
 * that row carried went with it: the top bar's stage tabs already say where a
 * page sits, and every page names itself.
 *
 * Also owns `document.title`, formatted as
 * "ViewLabel — ProductLabel | ProjectName | n-dx", or
 * "ViewLabel | ProjectName | n-dx" for a view no single package owns. Every
 * name comes from the navigation model (`views/view-meta.ts`, through `api.ts`).
 */

import { h } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import type { ViewId } from "../types.js";
import { useProjectMetadata, useCliName, resolveCliLabel } from "../hooks/index.js";
import { VIEW_META, PRODUCT_LABELS } from "../api.js";
import type { ViewMeta } from "../api.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";
import { HubLink, ProjectSwitcher, useHubProjects } from "./project-switcher.js";

export interface ProjectContextProps {
  view: ViewId;
  /** Injected for tests; defaults to `fetch`. Used for the hub's project list. */
  hubFetcher?: typeof fetch;
}

export function ProjectContext({ view, hubFetcher }: ProjectContextProps) {
  const project = useProjectMetadata();
  const cliName = useCliName();
  const hub = useHubProjects(hubFetcher);

  // Looked up rather than asserted: `view` is not always a live view id. The
  // crash-recovery banner restores a navigation state read out of
  // localStorage with an unchecked cast and hands it to `navigateTo`, which
  // does not check it against `validViews` — so a key saved by an older build,
  // naming a view since removed, lands here. Indexing it blind would throw
  // during render and take the whole dashboard down at exactly the moment the
  // user is recovering from a crash.
  const meta = VIEW_META[view] as ViewMeta | undefined;
  const label = meta ? resolveCliLabel(meta.label, cliName) : null;

  useEffect(() => {
    const parts: string[] = [];
    // A view no single package owns names only itself: "Home | proj | n-dx".
    if (label && meta) parts.push(meta.product === "global" ? label : `${label} — ${PRODUCT_LABELS[meta.product]}`);
    if (project) parts.push(project.name);
    parts.push("n-dx");
    document.title = parts.join(" | ");
  }, [project, view, label]);

  /** Truncated project name — max 28 chars. */
  const projectName = useMemo(() => {
    if (!project) return null;
    const name = project.name;
    return name.length > 28 ? name.slice(0, 26) + "…" : name;
  }, [project]);

  if (!project || !projectName) return null;

  return h("div", { class: "project-context", role: "group", "aria-label": "Project and workspace" },
    h("div", { class: "project-context-name" },
      hub.hub ? h(HubLink, null) : null,
      hub.hub ? h("span", { class: "project-context-sep", "aria-hidden": "true" }, "/") : null,
      h(ProjectSwitcher, {
        label: projectName,
        title: project.name.length > 28 ? project.name : undefined,
        view,
        hub,
      }),
    ),
    h(WorkspaceSwitcher, { view, branch: project.git?.branch ?? null }),
  );
}
