/**
 * THE DECLARATION COMES FROM n-dx. `ndx graview emit .` writes the document
 * and the snapshot; this product compiles the document in the page and seeds
 * a store with the snapshot. Nothing about the graph is declared here, which
 * is the whole arrangement: one source of truth, in the tool that owns the
 * data, and a face in this repository that only adds React.
 */
import type { AnySchema, GraviewApp } from "@graview/core";
import { appFromOrCompile, sayFindings } from "@graview/core/compiled";
import { fetchSnapshot } from "@graview/core/snapshot";
import type { GraphSnapshot } from "@graview/ship/browser";
import { BASE } from "./base.js";

export type App = GraviewApp<AnySchema>;

export interface Projection {
  readonly app: App;
  readonly document: Record<string, unknown>;
  readonly snapshot: GraphSnapshot;
  /** When the snapshot says it was made; absent for one in the old `{ nodes, edges }` shape. */
  readonly generatedAt?: string;
}

/** Compile a document and pair it with its snapshot. Throws with the checker's own sentences when the document is refused. */
export async function compileProjection(document: unknown, snapshot: GraphSnapshot, generatedAt?: string): Promise<Projection> {
  const compiled = await appFromOrCompile({ document });
  if (!compiled.ok) throw new Error(`The declaration was refused:\n${sayFindings(compiled.findings)}`);
  return { app: compiled.app as App, document: document as Record<string, unknown>, snapshot, ...(generatedAt ? { generatedAt } : {}) };
}

/** Fetch /data/document.json and /data/snapshot.json, under the face's base (scripts/sync-data.mjs puts them there), and compile. */
export async function loadProjection(base = `${BASE}/data`): Promise<Projection> {
  const missing = (name: string, status: number) => new Error(`${base}/${name}: ${status}. Run \`ndx graview emit .\` in the n-dx project, then \`pnpm sync\` here.`);
  const document = await fetch(`${base}/document.json`, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw missing("document.json", response.status);
    return response.json() as Promise<unknown>;
  });
  const file = await fetchSnapshot(`${base}/snapshot.json`, { init: { cache: "no-store" } }).catch((error: unknown) => {
    const status = /answered (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
    throw status ? missing("snapshot.json", Number(status)) : error;
  });
  return compileProjection(document, file.snapshot, file.header.generatedAt);
}
