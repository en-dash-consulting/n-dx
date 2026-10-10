/**
 * THE DECLARATION COMES FROM n-dx. `ndx graview emit .` writes the document
 * and the snapshot; this product compiles the document in the page and seeds
 * a store with the snapshot. Nothing about the graph is declared here, which
 * is the whole arrangement: one source of truth, in the tool that owns the
 * data, and a face in this repository that only adds React.
 */
import type { AnySchema, GraviewApp } from "@graview/core";
import { appFromOrCompile, sayFindings } from "@graview/core/compiled";
import type { GraphSnapshot } from "@graview/ship/browser";

export type App = GraviewApp<AnySchema>;

export interface Projection {
  readonly app: App;
  readonly document: Record<string, unknown>;
  readonly snapshot: GraphSnapshot;
}

/** Compile a document and pair it with its snapshot. Throws with the checker's own sentences when the document is refused. */
export async function compileProjection(document: unknown, snapshot: GraphSnapshot): Promise<Projection> {
  const compiled = await appFromOrCompile({ document });
  if (!compiled.ok) throw new Error(`The declaration was refused:\n${sayFindings(compiled.findings)}`);
  return { app: compiled.app as App, document: document as Record<string, unknown>, snapshot };
}

/** Fetch /data/document.json and /data/snapshot.json (scripts/sync-data.mjs puts them there) and compile. */
export async function loadProjection(base = "/data"): Promise<Projection> {
  const read = async (name: string): Promise<unknown> => {
    const response = await fetch(`${base}/${name}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${base}/${name}: ${response.status}. Run \`ndx graview emit .\` in the n-dx project, then \`pnpm sync\` here.`);
    return response.json();
  };
  const [document, snapshot] = await Promise.all([read("document.json"), read("snapshot.json")]);
  return compileProjection(document, snapshot as GraphSnapshot);
}
