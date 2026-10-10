/**
 * Where a Graview face writes back to rex: the hub's per-project rex MCP
 * endpoint. `ndx start` registers a repository with the per-user hub
 * (`<ndx home>/hub.json`) and serves its MCP servers at
 * `http://localhost:<port>/p/<id>/mcp/rex`, behind the per-user token
 * (`<ndx home>/auth.token`). Nothing here opens a connection: it names the
 * endpoint and the token file for the product face's own dev-server door,
 * which keeps the token server-side and never in the browser.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { resolveNdxHome, type Layout } from "./llm-gateway.js";

/** The hub's default port; `ndx start` prints the real one, and `hub.port` under the ndx home records it. */
export const DEFAULT_HUB_PORT = 3117;
export const HUB_REGISTRY_FILENAME = "hub.json";
export const HUB_PORT_FILENAME = "hub.port";
export const AUTH_TOKEN_FILENAME = "auth.token";

export interface RexEndpoint {
  /** `http://localhost:<port>/p/<id>/mcp/rex` */
  url: string;
  projectId: string;
  /** The per-user token file, when one exists; absent when the hub runs with `--no-auth`. */
  tokenFile?: string;
  /** Whether the registry says the project's server was up when last seen. */
  registered: boolean;
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

/** The hub's rex MCP endpoint for the project at `layout.root`, or undefined when the hub has never registered it. */
export function rexMcpEndpoint(layout: Layout, options: { home?: string; env?: NodeJS.ProcessEnv } = {}): RexEndpoint | undefined {
  const home = options.home ?? resolveNdxHome({ env: options.env ?? process.env });
  const registry = readJson(join(home, HUB_REGISTRY_FILENAME)) as { projects?: Record<string, HubProject> | HubProject[] } | undefined;
  if (!registry?.projects) return undefined;
  const projects = Array.isArray(registry.projects) ? registry.projects : Object.values(registry.projects);
  const root = real(layout.root);
  const project = projects.find((p) => [p.repoRoot, ...(p.worktrees ?? [])].filter((x): x is string => typeof x === "string").some((dir) => real(dir) === root));
  if (!project?.id) return undefined;
  const portFile = join(home, HUB_PORT_FILENAME);
  const port = existsSync(portFile) ? Number.parseInt(readFileSync(portFile, "utf-8").trim(), 10) || DEFAULT_HUB_PORT : DEFAULT_HUB_PORT;
  const tokenFile = join(home, AUTH_TOKEN_FILENAME);
  return {
    url: `http://localhost:${port}/p/${encodeURIComponent(project.id)}/mcp/rex`,
    projectId: project.id,
    ...(existsSync(tokenFile) ? { tokenFile } : {}),
    registered: typeof project.pid === "number" && project.pid > 0,
  };
}
