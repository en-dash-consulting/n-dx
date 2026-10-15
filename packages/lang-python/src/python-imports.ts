/**
 * Python imports as written, read from the `imports` and `guards` captures,
 * and the resolver that reports them.
 *
 * The resolver does not resolve yet: every file's references have no files
 * and no externals, only `written`. A `from __future__` import is never
 * captured, so it is never listed.
 *
 * @module lang-python/python-imports
 */

import type { FileReferences, ImportGuard, WrittenImport } from "@n-dx/lang-kit";
import { contains, innermost, type Capture, type PackResolver, type PackSourceFile } from "@n-dx/lang-runtime";

const GUARDS: Readonly<Record<string, ImportGuard>> = {
  "guard.type_checking": "type-checking",
  "guard.optional": "optional",
};

/** A dotted name as written, without the whitespace or line breaks Python allows inside it. */
const dotted = (capture: Capture): string => capture.text.replace(/\s+/g, "");

const sameSpan = (a: Capture, b: Capture): boolean =>
  a.start.line === b.start.line && a.start.column === b.start.column && a.end.line === b.end.line && a.end.column === b.end.column;

/** The file's imports in document order, each with the guard of the innermost guard block around it. */
export function readWrittenImports(file: PackSourceFile): WrittenImport[] {
  const captures = file.captures.imports ?? [];
  const named = (name: string): Capture[] => captures.filter((c) => c.name === name);
  // A statement importing several modules is captured once per module.
  const statements: Capture[] = [];
  for (const s of named("import.statement")) {
    if (!statements.some((seen) => sameSpan(seen, s))) statements.push(s);
  }
  const guards = (file.captures.guards ?? []).filter((c) => c.name in GUARDS);
  const guardOf = (statement: Capture): ImportGuard | undefined => {
    const block = innermost(guards, statement);
    return block === undefined ? undefined : GUARDS[block.name];
  };
  const inside = (statement: Capture, name: string): Capture[] => named(name).filter((c) => contains(statement, c));

  const written: WrittenImport[] = [];
  for (const statement of statements) {
    const guard = guardOf(statement);
    const withGuard = (entry: Omit<WrittenImport, "guard">): WrittenImport => (guard === undefined ? entry : { ...entry, guard });
    if (statement.nodeType === "import_statement") {
      for (const module of inside(statement, "import.module")) {
        written.push(withGuard({ specifier: dotted(module), names: [], position: module.start }));
      }
      continue;
    }
    const from = inside(statement, "import.from")[0];
    if (from === undefined) continue;
    const names = inside(statement, "import.wildcard").length > 0 ? ["*"] : inside(statement, "import.name").map(dotted);
    written.push(withGuard({ specifier: dotted(from), names, position: from.start }));
  }
  return written;
}

/**
 * Reports each file's written imports. Resolution to project files and
 * external packages is not implemented: `files` and `external` are empty, so
 * the imports phase records no Python edges or externals.
 */
export const pythonResolver: PackResolver = {
  prepare(files) {
    const byPath = new Map(files.map((file) => [file.path, readWrittenImports(file)]));
    return {
      resolve(fromFile): FileReferences {
        const written = byPath.get(fromFile);
        return written === undefined ? { files: [], external: [] } : { files: [], external: [], written };
      },
    };
  },
};
