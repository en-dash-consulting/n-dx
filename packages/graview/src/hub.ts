/**
 * Where a Graview face writes back to rex: the hub's per-project rex MCP
 * endpoint. `ndx start` registers a repository with the per-user hub
 * (`<ndx home>/hub.json`) and serves its MCP servers at
 * `http://localhost:<port>/p/<id>/mcp/rex`, behind the per-user token
 * (`<ndx home>/auth.token`). Nothing here opens a connection: it names the
 * endpoint and the token file for the product face's own dev-server door,
 * which keeps the token server-side and never in the browser.
 *
 * The hub's port is `hub.port` in `<ndx home>/config.json` when the operator
 * set one, else the port `hub.pid` records for the running hub, else 3117.
 *
 * A worktree is a separate workspace to the project's server: its MCP route
 * writes the tree the request addressed, chosen by the `X-Ndx-Workspace`
 * header (keys are assigned by the server; `GET /p/<id>/api/workspaces`
 * lists them with their paths). So an endpoint for a worktree carries the
 * worktree's root and that listing's URL, and a face must resolve the key
 * before it writes, or it would write the main checkout's PRD.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { resolveNdxHome, type Layout } from "./llm-gateway.js";

/** The hub's default port; `ndx start` prints the real one. */
export const DEFAULT_HUB_PORT = 3117;
export const HUB_REGISTRY_FILENAME = "hub.json";
/** `{ pid, port }` of the running hub. */
export const HUB_PID_FILENAME = "hub.pid";
/** The per-user config whose `hub.port` overrides the default. */
export const HUB_CONFIG_FILENAME = "config.json";
export const AUTH_TOKEN_FILENAME = "auth.token";

export interface RexEndpoint {
  /** `http://localhost:<port>/p/<id>/mcp/rex` */
  url: string;
  projectId: string;
  /** The per-user token file, when one exists; absent when the hub runs with `--no-auth`. */
  tokenFile?: string;
  /** Whether the registry says the project's server was up when last seen. */
  registered: boolean;
  /**
   * Set when `layout.root` is a worktree rather than the registered
   * repository root: the worktree's real path, which a writer must map to a
   * workspace key through `workspacesUrl` and send as `X-Ndx-Workspace`.
   */
  worktree?: string;
  /** `GET` here (with the token) lists `{ workspaces: [{ key, path, isAnchor }] }`. */
  workspacesUrl?: string;
}

interface HubProject {
  id?: string;
  repoRoot?: string;
  worktrees?: string[];
  pid?: number | null;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}

/** The hub's port as its own files record it: config first, then the running hub, then the default. */
export function hubPort(home: string): number {
  const config = readJson(join(home, HUB_CONFIG_FILENAME)) as { hub?: { port?: unknown } } | undefined;
  if (isPort(config?.hub?.port)) return config.hub.port;
  const pid = readJson(join(home, HUB_PID_FILENAME)) as { port?: unknown } | undefined;
  if (isPort(pid?.port)) return pid.port;
  return DEFAULT_HUB_PORT;
}

/** The hub's rex MCP endpoint for the project at `layout.root`, or undefined when the hub has never registered it. */
export function rexMcpEndpoint(layout: Layout, options: { home?: string; env?: NodeJS.ProcessEnv } = {}): RexEndpoint | undefined {
  const home = options.home ?? resolveNdxHome({ env: options.env ?? process.env });
  const registry = readJson(join(home, HUB_REGISTRY_FILENAME)) as { projects?: Record<string, HubProject> | HubProject[] } | undefined;
  if (!registry?.projects) return undefined;
  const projects = Array.isArray(registry.projects) ? registry.projects : Object.values(registry.projects);
  const root = real(layout.root);
  const project = projects.find((p) => [p.repoRoot, ...(p.worktrees ?? [])].filter((x): x is string => typeof x === "string").some((dir) => real(dir) === root));
  if (!project?.id) return undefined;
  const base = `http://localhost:${hubPort(home)}/p/${encodeURIComponent(project.id)}`;
  const tokenFile = join(home, AUTH_TOKEN_FILENAME);
  const isWorktree = typeof project.repoRoot === "string" && real(project.repoRoot) !== root;
  return {
    url: `${base}/mcp/rex`,
    projectId: project.id,
    ...(existsSync(tokenFile) ? { tokenFile } : {}),
    registered: typeof project.pid === "number" && project.pid > 0,
    ...(isWorktree ? { worktree: root, workspacesUrl: `${base}/api/workspaces` } : {}),
  };
}
