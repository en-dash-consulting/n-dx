/**
 * Base-path derivation for a viewer served behind the hub.
 *
 * Behind the hub every project's dashboard lives under `/p/<id>/`; served
 * directly by `web serve` it lives at `/`. The document's own pathname is the
 * only signal the viewer needs — the hub strips the prefix before proxying,
 * so the server never sees it and nothing has to be injected into the HTML.
 *
 * Pure string functions (framework-agnostic, no window/node) so both the
 * viewer boot path and the hub's router share one definition of the prefix
 * shape. Keep the pattern in lockstep with hub/hub.ts `matchProjectPath`.
 *
 * @module shared/base-path
 */

/**
 * The base path under which the app is served, derived from a pathname:
 * `"/p/<id>"` (no trailing slash) behind the hub, `""` when served at the
 * root. `/p/<id>` never collides with a view path — view ids are single
 * segments and `p` is not one.
 */
export function deriveBasePath(pathname: string): string {
  const m = pathname.match(/^\/p\/([^/]+)/);
  return m ? `/p/${m[1]}` : "";
}

/**
 * Remove `basePath` from `pathname`, always returning a root-form path.
 * A pathname outside the base (shouldn't happen for same-document URLs)
 * passes through unchanged.
 */
export function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === "" || !pathname.startsWith(basePath)) return pathname;
  const rest = pathname.slice(basePath.length);
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * Prefix a root-absolute path with `basePath`. Paths that are not
 * root-absolute (full URLs, relative paths) and paths already under the base
 * are returned unchanged, so the helper is safe on every URL a caller has.
 */
export function joinBasePath(basePath: string, path: string): string {
  if (basePath === "" || !path.startsWith("/")) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}
