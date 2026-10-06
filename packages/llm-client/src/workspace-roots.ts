/**
 * Pick the workspace a stdio MCP server should serve from the client's MCP roots.
 *
 * A server registered as `<tool> mcp .` serves whatever directory the client
 * spawned it in. Claude desktop spawns project servers in the main checkout
 * even when the session runs in a linked worktree (#499), so `.` names the
 * wrong tree. The client's `roots/list` answer names the session's directory;
 * this function turns it into the directory to serve.
 *
 * Shared by the rex and sourcevision stdio servers, which may not import each
 * other. Pure apart from filesystem and git reads.
 */

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getGitCommonDir, getWorktreeRoot } from "./exec.js";
import { resolveLayout, type Layout } from "./layout.js";

/** One entry of an MCP `roots/list` result. Only the URI is used. */
export interface WorkspaceRoot {
  uri: string;
}

export interface ResolveWorkspaceFromRootsOptions {
  /** The client's roots, in the order it listed them. */
  roots: readonly WorkspaceRoot[];
  /** The directory the server was started for (`.` resolved against cwd). */
  startupDir: string;
  /**
   * The state directory a servable workspace contains, as a {@link Layout}
   * key, so either layout (`.ndx/rex` or `.rex`) counts.
   */
  marker: "rexDir" | "sourcevisionDir";
}

export interface WorkspaceResolution {
  /** Directory to serve: a client root's worktree, or `startupDir`. */
  dir: string;
  source: "roots" | "startup";
  /**
   * Set when a root names another worktree of the startup repository that
   * cannot be served. `dir` is then `startupDir`, and callers must refuse
   * writes rather than send them to the wrong tree.
   */
  refused?: string;
}

/**
 * Resolve the workspace to serve.
 *
 * Roots are taken in order and the first decisive one wins:
 * - non-`file:` URIs and paths that do not exist are skipped;
 * - a root is widened to its git worktree root, so a subdirectory root
 *   serves its checkout;
 * - a root that is the startup worktree keeps the startup dir;
 * - a root whose `marker` state directory exists is served (`source: "roots"`);
 * - a root in the startup repository without `marker` is refused;
 * - a root in an unrelated repository without `marker` is ignored.
 *
 * With no decisive root the startup dir is served.
 */
export function resolveWorkspaceFromRoots(options: ResolveWorkspaceFromRootsOptions): WorkspaceResolution {
  const { roots, startupDir, marker } = options;
  const startup = canonicalize(startupDir);
  let startupCommonDir: string | null | undefined;

  for (const root of roots) {
    const path = rootPath(root.uri);
    if (!path) continue;
    const candidate = getWorktreeRoot(path) ?? path;
    if (candidate === startup) break;

    const stateDir = resolveLayout(candidate)[marker];
    if (existsSync(stateDir)) {
      return { dir: candidate, source: "roots" };
    }

    startupCommonDir ??= getGitCommonDir(startup);
    if (startupCommonDir && getGitCommonDir(candidate) === startupCommonDir) {
      return {
        dir: startupDir,
        source: "startup",
        refused:
          `The MCP client is working in ${candidate}, a worktree of the same repository as ${startup}, ` +
          `but ${stateDir} does not exist. Refusing to write to ${startup} on its behalf.`,
      };
    }
  }

  return { dir: startupDir, source: "startup" };
}

/** Realpath of a `file:` URI, or null for any other scheme or a missing path. */
function rootPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  let path: string;
  try {
    path = fileURLToPath(uri);
  } catch {
    // A malformed file: URI (e.g. a non-local host) names nothing we can serve.
    return null;
  }
  try {
    return realpathSync.native(path);
  } catch {
    // The root does not exist on this machine, so it cannot be served.
    return null;
  }
}

/** Realpath when possible, so symlinked spellings of one directory compare equal. */
function canonicalize(dir: string): string {
  const absolute = resolve(dir);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}
