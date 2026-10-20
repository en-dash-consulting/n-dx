/**
 * Dynamic imports: `importlib.import_module(…)` (or `import_module(…)`
 * imported from importlib) and `__import__(…)`. Their module is a run-time
 * value, so they never become import facts; the pack counts them in its
 * notices when imports are wanted.
 *
 * @module lang-python/python-notices
 */

import type { FactKind, SourcePosition } from "@n-dx/lang-kit";
import { callSites, type PackSourceFile } from "@n-dx/lang-runtime";

export interface DynamicImport {
  readonly path: string;
  readonly position: SourcePosition;
  /** The call as written up to its argument list: `importlib.import_module`, `__import__`. */
  readonly callee: string;
}

/** The dynamic imports in one file's `calls` captures, in document order. */
export function findDynamicImports(file: PackSourceFile): DynamicImport[] {
  const found: DynamicImport[] = [];
  for (const site of callSites(file.captures.calls ?? [])) {
    const name = site.name?.text;
    const receiver = site.receiver?.text;
    const dynamic =
      (name === "import_module" && (receiver === undefined || receiver === "importlib")) ||
      (name === "__import__" && receiver === undefined);
    if (!dynamic || site.name === undefined) continue;
    const callee = receiver === undefined ? name! : `${receiver}.${name}`;
    found.push({ path: file.path, position: (site.invocation ?? site.name).start, callee });
  }
  return found;
}

/** How many notices name a location before the rest are counted. */
const NOTICE_LOCATIONS = 5;

/** The notice for a project's dynamic imports; undefined when there are none. */
export function dynamicImportsNotice(found: readonly DynamicImport[]): string | undefined {
  if (found.length === 0) return undefined;
  const where = found.slice(0, NOTICE_LOCATIONS).map((d) => `${d.path}:${d.position.line} (${d.callee})`);
  const more = found.length > NOTICE_LOCATIONS ? `, and ${found.length - NOTICE_LOCATIONS} more` : "";
  const subject =
    found.length === 1
      ? "1 dynamic import names its module at run time and is not an import fact"
      : `${found.length} dynamic imports name their module at run time and are not import facts`;
  return `Python: ${subject}: ${where.join(", ")}${more}.`;
}

/** The pack entry's notices: dynamic imports, when imports are wanted. */
export function pythonProjectNotices(files: readonly PackSourceFile[], kinds: readonly FactKind[]): string[] {
  if (!kinds.includes("imports")) return [];
  const notice = dynamicImportsNotice(files.flatMap(findDynamicImports));
  return notice === undefined ? [] : [notice];
}
