/**
 * Extension links in the top bar's project context (project-context.ts).
 *
 * Each enabled extension's `projectLinks` (docs/architecture/extensions.md)
 * appear as plain links to its hub mount. The hub resolves them — the
 * `{projectId}` and `{repoRoot}` placeholders and the `/x/<name>` prefix — in
 * `GET /api/hub/extensions?project=<id>`, so the viewer renders labels and
 * URLs it was given and carries no extension code of its own.
 *
 * Asked only once the hub has answered (`useHubProjects`): standalone there
 * is no hub, so there are no links and no request to fail.
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getBasePath } from "../base-path.js";
import { detectBasePath } from "../external.js";
import type { HubProjects } from "./project-switcher.js";

/** One resolved project link. */
export interface ExtensionLink {
  label: string;
  /** `/x/<name>/…`, as the hub resolved it. */
  url: string;
}

/**
 * Flatten `GET /api/hub/extensions`' `links`, or null when the body is not
 * the hub's answer. Only hub-mounted URLs are kept, so a malformed entry can
 * never become a link off the hub.
 */
export function parseExtensionLinks(body: unknown): ExtensionLink[] | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { extensions?: unknown }).extensions;
  if (!Array.isArray(list)) return null;
  return list.flatMap((entry) => {
    const links = (entry as { links?: unknown } | null)?.links;
    if (!Array.isArray(links)) return [];
    return links.flatMap((link) => {
      const l = link as { label?: unknown; url?: unknown } | null;
      if (typeof l?.label !== "string" || !l.label || typeof l.url !== "string" || !l.url.startsWith("/x/")) return [];
      return [{ label: l.label, url: l.url }];
    });
  });
}

/**
 * Where to ask for this dashboard's links. Under `/p/<id>/` the prefix names
 * the project (the fetch is rewritten onto it); under the hub's single-project
 * root alias it names none — there is no prefix, or only a worktree's
 * `/w/<key>`, which the hub drops — so the sole project is named in the query.
 * Null when neither says which project this is.
 */
export function extensionLinksPath(basePath: string, projects: HubProjects["projects"]): string | null {
  if (detectBasePath(basePath)) return "/api/hub/extensions";
  if (projects.length === 1) return `/api/hub/extensions?project=${encodeURIComponent(projects[0].id)}`;
  return null;
}

/** This project's extension links; empty without a hub or on any failure. */
export function useExtensionLinks(hub: HubProjects, fetcher?: typeof fetch): ExtensionLink[] {
  const [links, setLinks] = useState<ExtensionLink[]>([]);
  const path = hub.hub ? extensionLinksPath(getBasePath(), hub.projects) : null;

  useEffect(() => {
    if (!path) { setLinks([]); return; }
    const doFetch = fetcher ?? fetch;
    let cancelled = false;
    void (async () => {
      let next: ExtensionLink[] = [];
      try {
        const res = await doFetch(path, { headers: { accept: "application/json" } });
        if (res.ok) next = parseExtensionLinks(await res.json()) ?? [];
      } catch {
        // No hub, a 503 from a hub that cannot ask n-dx, or a non-JSON body:
        // links are an extra, so the header simply goes without them.
      }
      if (!cancelled) setLinks(next);
    })();
    return () => { cancelled = true; };
  }, [path]);

  return links;
}

/** The links, or nothing when there are none. */
export function ExtensionLinks({ links }: { links: ExtensionLink[] }) {
  if (links.length === 0) return null;
  return h("nav", { class: "project-context-links", "aria-label": "Extensions" },
    links.map((link) => h("a", { key: link.url, class: "project-context-link", href: link.url }, link.label)),
  );
}
