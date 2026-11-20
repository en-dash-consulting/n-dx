/**
 * Shared hook + cache for project metadata from `/api/project`.
 *
 * Used by both the sidebar header (project name display) and the
 * breadcrumb component.
 */

import { useState, useEffect } from "preact/hooks";
import { getJson } from "../utils/json-requests.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitInfo {
  branch: string | null;
  sha: string | null;
  remoteUrl: string | null;
  repoName: string | null;
}

export interface ProjectMetadata {
  name: string;
  description: string | null;
  version: string | null;
  git: GitInfo | null;
  nameSource: "package.json" | "directory";
  /** Resolved project CLI command name (cli.name in .n-dx.json, default "n-dx"). */
  cliName?: string;
}

/** Fallback CLI command name while metadata is loading or unavailable. */
export const DEFAULT_CLI_NAME = "n-dx";

// ---------------------------------------------------------------------------
// Singleton fetch + cache
// ---------------------------------------------------------------------------

let cachedMeta: ProjectMetadata | null = null;
let fetchPromise: Promise<ProjectMetadata | null> | null = null;

/** Fetch with dedup — concurrent calls share one in-flight request. */
export function getProjectMetadata(): Promise<ProjectMetadata | null> {
  if (cachedMeta) return Promise.resolve(cachedMeta);
  if (!fetchPromise) {
    fetchPromise = getJson<ProjectMetadata>("/api/project").then((m) => {
      cachedMeta = m;
      fetchPromise = null;
      return m;
    });
  }
  return fetchPromise;
}

/** Clear the metadata cache (exposed for testing). */
export function clearProjectMetadataCache(): void {
  cachedMeta = null;
  fetchPromise = null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Preact hook — returns project metadata (fetches once, shares cache). */
export function useProjectMetadata(): ProjectMetadata | null {
  const [project, setProject] = useState<ProjectMetadata | null>(cachedMeta);

  useEffect(() => {
    getProjectMetadata().then((m) => {
      if (m) setProject(m);
    });
  }, []);

  return project;
}

/**
 * Preact hook — the project's resolved CLI command name from shared state.
 *
 * The single sanctioned read path for the CLI name in dashboard components:
 * always sourced from `/api/project` shared state (never localStorage,
 * environment, or hardcoded strings). Returns "n-dx" while loading or when
 * the server has no `cli.name` configured.
 */
export function useCliName(): string {
  const project = useProjectMetadata();
  return project?.cliName ?? DEFAULT_CLI_NAME;
}

/**
 * Substitute the project's CLI name into a label template.
 *
 * Module-level constant tables (sidebar nav, breadcrumb metadata, page
 * titles) are declared before any hook can run, so they carry a `{cli}`
 * placeholder that the rendering component resolves. Keeping the token
 * greppable makes it obvious which strings are command references.
 */
export function resolveCliLabel(template: string, cliName: string): string {
  return template.replace(/\{cli\}/g, cliName);
}
