/**
 * Base-path helpers for a viewer served under a hub project prefix.
 *
 * Standalone (`web serve`) the dashboard lives at `/`. Behind the hub it
 * lives at `/p/<id>/` and every root-relative URL the viewer builds —
 * `/api/...`, `/data/...`, `/n-dx.png`, the WebSocket endpoint, history
 * entries — must carry that prefix, while the project server behind the
 * proxy keeps seeing root-relative paths because the hub strips it.
 *
 * Framework-agnostic and pure: used by the viewer (through external.ts) to
 * prefix what it sends, and by the hub to decide what to strip, so the two
 * cannot disagree about where the prefix ends.
 */

/** Path prefix under which the hub exposes one project's dashboard. */
export const PROJECT_PATH_PREFIX = "/p/";
/** Path slot under which a project server exposes one worktree ("workspace"). */
export const WORKSPACE_PATH_PREFIX = "/w/";

const PROJECT_BASE_PATTERN = /^\/p\/([^/?#]+)/;
const WORKSPACE_SLOT_PATTERN = /^\/w\/([^/?#]+)/;

/**
 * `decodeURIComponent` for a URL segment that came off the wire, which cannot
 * throw. A malformed escape (`/w/%`, `/p/%ZZ/`) is a `URIError`, and these
 * helpers run inside request handlers on both servers — an exception there is
 * an unhandled rejection, which takes the process down. Any request can
 * contain one, so this is a liveness bug, not a decoding nicety.
 *
 * The raw segment is the right fallback: an id that cannot be decoded matches
 * no registered project and no known workspace, so the caller's existing
 * "unknown key" path answers 404 with the text the client actually sent.
 */
export function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The base path a pathname is served under: `/p/<id>` when the pathname
 * starts with a project prefix, otherwise `""` (served at the root).
 */
export function detectBasePath(pathname: string): string {
  const match = PROJECT_BASE_PATTERN.exec(pathname);
  return match ? `${PROJECT_PATH_PREFIX}${match[1]}` : "";
}

/**
 * The base path the VIEWER is served under: the hub's `/p/<id>` (if any)
 * followed by the workspace slot `/w/<key>` (if any). Both are optional and
 * independent — `/w/feature/prd`, `/p/app/prd`, `/p/app/w/feature/prd` and
 * `/prd` are all valid — and the viewer puts the whole thing back on every
 * URL it builds, so a deep link keeps both the project and the worktree.
 */
export function detectViewerBasePath(pathname: string): string {
  const project = detectBasePath(pathname);
  const rest = project ? pathname.slice(project.length) : pathname;
  const slot = WORKSPACE_SLOT_PATTERN.exec(rest);
  return `${project}${slot ? `${WORKSPACE_PATH_PREFIX}${slot[1]}` : ""}`;
}

/** The workspace key inside a viewer base path, or null when it names the anchor. */
export function workspaceKeyFromBasePath(basePath: string): string | null {
  const project = detectBasePath(basePath);
  const slot = WORKSPACE_SLOT_PATTERN.exec(project ? basePath.slice(project.length) : basePath);
  return slot ? safeDecodeSegment(slot[1]) : null;
}

/**
 * Split a server-side URL into its workspace slot and the rest. The project
 * server sees paths with the hub prefix already stripped, so `/w/<key>` is
 * the leading segment when present; the remainder keeps its query string and
 * is `/` for the bare slot. No slot → `key: null`, url unchanged.
 */
export function stripWorkspaceSlot(url: string): { key: string | null; url: string } {
  const slot = WORKSPACE_SLOT_PATTERN.exec(url);
  if (!slot) return { key: null, url };
  const rest = url.slice(slot[0].length);
  const stripped = rest === "" || rest.startsWith("?") || rest.startsWith("#") ? `/${rest}` : rest;
  return { key: safeDecodeSegment(slot[1]), url: stripped };
}

/** The project id inside a base path, or null for the root base path. */
export function projectIdFromBasePath(basePath: string): string | null {
  const match = PROJECT_BASE_PATTERN.exec(basePath);
  return match ? safeDecodeSegment(match[1]) : null;
}

/**
 * Prefix a root-relative URL with the base path. Anything that is not
 * root-relative — absolute URLs, protocol-relative `//host`, relative
 * `./x`, or a URL already under the base path — is returned unchanged.
 */
export function withBasePath(basePath: string, url: string): string {
  if (!basePath) return url;
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  if (url === basePath || url.startsWith(`${basePath}/`) || url.startsWith(`${basePath}?`)) return url;
  return `${basePath}${url}`;
}

/**
 * Remove the base path from a pathname. The base path itself becomes `/`;
 * a pathname outside the base path is returned unchanged.
 */
export function stripBasePath(basePath: string, pathname: string): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname;
}

/**
 * The WebSocket endpoint for a viewer served under `basePath`. The project
 * server accepts the upgrade on any path; the hub routes it by the prefix.
 */
export function webSocketUrl(protocol: string, host: string, basePath: string): string {
  const scheme = protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${host}${basePath}`;
}
