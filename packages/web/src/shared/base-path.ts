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

const PROJECT_BASE_PATTERN = /^\/p\/([^/?#]+)/;

/**
 * The base path a pathname is served under: `/p/<id>` when the pathname
 * starts with a project prefix, otherwise `""` (served at the root).
 */
export function detectBasePath(pathname: string): string {
  const match = PROJECT_BASE_PATTERN.exec(pathname);
  return match ? `${PROJECT_PATH_PREFIX}${match[1]}` : "";
}

/** The project id inside a base path, or null for the root base path. */
export function projectIdFromBasePath(basePath: string): string | null {
  const match = PROJECT_BASE_PATTERN.exec(basePath);
  return match ? decodeURIComponent(match[1]) : null;
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
