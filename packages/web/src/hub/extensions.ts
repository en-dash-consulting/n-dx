/**
 * Installed extensions as the hub's API reports them: `GET /api/hub/extensions`
 * (docs/architecture/extensions.md, "Versioned hub API").
 *
 * The hub reads no manifest, here as for sidecars: it spawns
 * `ndx extensions list --json` (core's CLI, `--ndx-cli`) from the n-dx home and
 * joins the answer with what {@link SidecarManager} is running. From the home,
 * discovery's `project` source finds nothing, so the list is the user, global
 * and development sources — the same set the hub serves sidecars from.
 *
 * @module web/hub/extensions
 */

import { exec } from "./exec-gateway.js";
import type { SidecarState, SidecarStatus } from "./sidecars.js";

/**
 * The extension contract version this hub speaks, carried as `apiVersion` by
 * every versioned endpoint. A twin of core's `EXTENSION_API_VERSION` (the hub
 * cannot import core); tests/e2e/extension-api-version-parity.test.js pins the two.
 */
export const EXTENSION_API_VERSION = 1;

/** Core's state names (`packages/core/extension-state.js`). */
export type ExtensionStateName = "enabled" | "disabled" | "unapproved" | "incompatible" | "invalid" | "conflict";

/** The parts of a valid `ndx.extension` block the hub reads. */
export interface ExtensionManifest {
  apiVersion: number;
  name: string;
  displayName?: string;
  ndxVersion: string;
  sidecar?: { bin: string; health?: string; idleStopMinutes?: number };
  hub?: { label: string; description?: string };
  projectLinks?: Array<{ label: string; path: string }>;
  [key: string]: unknown;
}

/** One row of `ndx extensions list --json`. */
export interface ExtensionListing {
  name: string | null;
  packageName: string;
  version: string | null;
  source: string;
  state: ExtensionStateName;
  reason: string;
  dir: string;
  /** Null when the manifest is invalid. */
  manifest: ExtensionManifest | null;
}

export type ListResult =
  | { ok: true; extensions: ExtensionListing[]; errors: Array<{ path: string; message: string }> }
  | { ok: false; error: string };

/** Asks n-dx for the installed extensions. */
export type ListExtensions = () => Promise<ListResult>;

/** The list function for a hub that knows where n-dx's CLI is. */
export function ndxCliLister(ndxCli: string, cwd: string, timeoutMs = 30_000): ListExtensions {
  return async () => {
    const result = await exec(process.execPath, [ndxCli, "extensions", "list", "--json"], { cwd, timeout: timeoutMs });
    if (result.exitCode === 0) {
      try {
        const body = JSON.parse(result.stdout) as { extensions?: unknown; errors?: unknown };
        if (Array.isArray(body.extensions)) {
          return {
            ok: true,
            extensions: body.extensions as ExtensionListing[],
            errors: Array.isArray(body.errors) ? body.errors as Array<{ path: string; message: string }> : [],
          };
        }
      } catch {
        // Not JSON: reported below with whatever stderr said.
      }
    }
    const detail = result.stderr.trim() || result.error?.message || `exit code ${result.exitCode ?? "null"}`;
    return { ok: false, error: `Could not ask n-dx for its extensions: ${detail}` };
  };
}

/** A sidecar's runtime state as the API reports it. */
export interface ExtensionSidecarView {
  state: SidecarState;
  recentCrashes: number;
  lastError: string | null;
}

/** A project link resolved for one project. */
export interface ExtensionLinkView {
  label: string;
  url: string;
}

/** One entry of `GET /api/hub/extensions`. */
export interface ExtensionView {
  name: string | null;
  packageName: string;
  version: string | null;
  source: string;
  state: ExtensionStateName;
  /** Why it is not enabled; empty when it is. */
  reason: string;
  /** False when its `apiVersion` or `ndxVersion` rules it out, or the manifest is invalid. */
  compatible: boolean;
  manifest: ExtensionManifest | null;
  /** `/x/<name>/` when it declares a sidecar, else null. */
  mount: string | null;
  /** The running sidecar, or its stopped state; null without a sidecar. */
  sidecar: ExtensionSidecarView | null;
  /** Only with `?project=<id>`: its project links for that project, empty unless enabled. */
  links?: ExtensionLinkView[];
}

export interface ExtensionsAnswer {
  apiVersion: number;
  extensions: ExtensionView[];
  errors: Array<{ path: string; message: string }>;
}

/** Fill a link path's `{projectId}` and `{repoRoot}`, each URL-encoded. */
export function resolveProjectLink(name: string, path: string, project: { id: string; repoRoot: string }): string {
  const filled = path
    .replace(/\{projectId\}/g, encodeURIComponent(project.id))
    .replace(/\{repoRoot\}/g, encodeURIComponent(project.repoRoot));
  return `/x/${name}${filled}`;
}

/** Join core's listing with the running sidecars; with `project`, resolve each enabled extension's links. */
export function buildExtensionsAnswer(
  listed: { extensions: ExtensionListing[]; errors: Array<{ path: string; message: string }> },
  sidecars: SidecarStatus[],
  project?: { id: string; repoRoot: string },
): ExtensionsAnswer {
  const running = new Map(sidecars.map((s) => [s.name, s]));
  const extensions = listed.extensions.map((ext): ExtensionView => {
    const m = ext.manifest;
    const name = ext.name;
    const hasSidecar = !!m?.sidecar && name !== null;
    const status = name !== null ? running.get(name) : undefined;
    const view: ExtensionView = {
      name,
      packageName: ext.packageName,
      version: ext.version,
      source: ext.source,
      state: ext.state,
      reason: ext.reason,
      compatible: ext.state !== "incompatible" && ext.state !== "invalid",
      manifest: m,
      mount: hasSidecar ? `/x/${name}/` : null,
      sidecar: hasSidecar
        ? { state: status?.state ?? "stopped", recentCrashes: status?.recentCrashes ?? 0, lastError: status?.lastError ?? null }
        : null,
    };
    if (project) {
      view.links = ext.state === "enabled" && hasSidecar && name !== null
        ? (m?.projectLinks ?? []).map((l) => ({ label: l.label, url: resolveProjectLink(name, l.path, project) }))
        : [];
    }
    return view;
  });
  return { apiVersion: EXTENSION_API_VERSION, extensions, errors: listed.errors };
}
