/** Normalize a path to always use forward slashes (no-op on Unix). */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * The two roots of a pair of paths that end alike: each path with their
 * common trailing segments removed (`app/x/a.php`, `edit/x/a.php` → `app`,
 * `edit`). Undefined when the last segments differ or one path is wholly the
 * other's suffix.
 */
export function divergentRoots(a: string, b: string): [string, string] | undefined {
  const as = a.split("/");
  const bs = b.split("/");
  let i = 0;
  while (i < as.length && i < bs.length && as[as.length - 1 - i] === bs[bs.length - 1 - i]) i++;
  if (i === 0 || i === as.length || i === bs.length) return undefined;
  return [as.slice(0, as.length - i).join("/"), bs.slice(0, bs.length - i).join("/")];
}

/** The `<copy>/ mirrors <source>/` label of a mirror-copy file, from its path and its counterpart's. */
export function mirrorLabel(path: string, mirrorOf: string): string {
  const roots = divergentRoots(path, mirrorOf);
  return roots === undefined ? `mirrors ${mirrorOf}` : `${roots[0]}/ mirrors ${roots[1]}/`;
}
