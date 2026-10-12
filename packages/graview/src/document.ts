/**
 * The declaration: `n-dx.graview.json`, read as data.
 *
 * The document is checked in beside this package and shipped with it. It is
 * the schema of record for the *projection*: which kind a rex node type
 * becomes and which edge each rex relation becomes are tables here, and a
 * test holds the document to them, so a node type or derived edge added to
 * rex cannot silently fall out of the graph.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NodeType, ProductEdges } from "./rex-gateway.js";

/**
 * The declaration as this package reads it: the keys the mapping tables and
 * the emit touch, and the rest as data. The format itself is Graview's —
 * `$schema` names the JSON Schema `@graview/core` publishes per version, so
 * an editor underlines a wrong key as it is typed, and `graview check` (run
 * by `tests/unit/declaration.test.ts`) judges the whole document. Nothing
 * here restates the format.
 */
export interface GraviewDocumentData {
  $schema?: string;
  format: "graview-document";
  formatVersion: number;
  name: string;
  kinds: Record<string, { plural?: string; edges?: Record<string, unknown> } & Record<string, unknown>>;
  [key: string]: unknown;
}

/** The checked-in declaration, beside `package.json`; the same path from `src/` and from `dist/`. */
export const DOCUMENT_PATH = fileURLToPath(new URL("../n-dx.graview.json", import.meta.url));

/** The graview release the `npx` fallback pins and the document was checked against. */
export const GRAVIEW_VERSION = "0.1.26";

/** Read the declaration fresh: callers get their own copy to set `name` on. */
export function loadDocument(): GraviewDocumentData {
  return JSON.parse(readFileSync(DOCUMENT_PATH, "utf-8")) as GraviewDocumentData;
}

/** The declaration with its `name` set to the project it describes. */
export function documentFor(projectName: string): GraviewDocumentData {
  const doc = loadDocument();
  const name = projectName.trim().slice(0, 80);
  return { ...doc, name: name.length > 0 ? name : doc.name };
}

/**
 * Which kind a rex node type becomes. A subtask is a task with
 * `level: "subtask"`: Graview's horizon and places read better over one kind
 * of work than two, and nothing in rex treats a subtask as anything but a
 * smaller task.
 */
export const NODE_KINDS: Readonly<Record<NodeType, string>> = {
  area: "area",
  capability: "capability",
  constraint: "constraint",
  change: "change",
  task: "task",
  subtask: "task",
};

/**
 * Which declared edges each of rex's derived product edges is read from.
 * `changedBy` and `coChanges` are both computed from a change's `amends` and
 * `touches`; `boundBy` from a constraint's `appliesTo`. The snapshot carries
 * the stored relation and Graview walks it, so the derived table never has to
 * be a node field.
 */
export const PRODUCT_EDGE_SOURCES: Readonly<Record<keyof ProductEdges, readonly string[]>> = {
  changedBy: ["amends", "touches"],
  boundBy: ["appliesTo"],
  coChanges: ["amends", "touches"],
};

/** Every edge name a document declares, with the kind it leaves. */
export function declaredEdges(doc: GraviewDocumentData): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [kind, spec] of Object.entries(doc.kinds)) {
    for (const edge of Object.keys(spec.edges ?? {})) {
      const kinds = out.get(edge) ?? new Set<string>();
      kinds.add(kind);
      out.set(edge, kinds);
    }
  }
  return out;
}
