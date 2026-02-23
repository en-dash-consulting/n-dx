/** Normalize a path to always use forward slashes (no-op on Unix). */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
