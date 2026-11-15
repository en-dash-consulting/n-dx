/**
 * TypeScript-compiler parsing shared by the JS/TS analyzers (imports, call
 * graph, components, server routes, zone symbols).
 *
 * The script kind follows the file extension, case-sensitively: `.tsx` and
 * `.jsx` parse as TSX, `.ts` as TS, anything else as JS. Outbound detection
 * keeps its own wider rule (`scriptKindFor` in `outbound-detection.ts`:
 * case-insensitive, `.jsx` as JSX, `.mts`/`.cts` as TS), so it does not use
 * this module.
 *
 * @module sourcevision/analyzers/ts-source
 */

import { extname } from "node:path";
import ts from "typescript";

/** The script kind the JS/TS analyzers parse a file as. */
function jsTsScriptKind(filePath: string): ts.ScriptKind {
  const ext = extname(filePath);
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".ts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/**
 * Parse a JS/TS source file at the latest language target.
 *
 * `setParentNodes` defaults to true, which every analyzer that walks up from
 * a node needs; the import extractor only walks down and passes false.
 */
export function parseJsTsSource(filePath: string, sourceText: string, setParentNodes = true): ts.SourceFile {
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, setParentNodes, jsTsScriptKind(filePath));
}
