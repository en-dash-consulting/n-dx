/**
 * Write the two files Graview reads, under the layout's graview dir.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveLayout, type Layout } from "./llm-gateway.js";
import { documentFor } from "./document.js";
import { buildSnapshot, graviewDirOf, type BuildSnapshotOptions } from "./snapshot.js";
import { canonicalJson } from "./canonical.js";

export const DOCUMENT_FILENAME = "document.json";
export const SNAPSHOT_FILENAME = "snapshot.json";
export const DATA_DIRNAME = "data";

export interface EmitOptions extends BuildSnapshotOptions {
  /** The document's `name`; defaults to the project directory's name. */
  projectName?: string;
}

export interface EmitResult {
  layout: Layout;
  graviewDir: string;
  documentPath: string;
  snapshotPath: string;
  /** Where `serve` and `mcp` keep graview's own store. */
  dataDir: string;
  counts: Record<string, number>;
  warnings: string[];
  prdLayout: "v1" | "v2";
}

export async function emitProjection(root: string, options: EmitOptions = {}): Promise<EmitResult> {
  const layout = resolveLayout(root);
  const graviewDir = graviewDirOf(layout);
  mkdirSync(graviewDir, { recursive: true });

  const report = await buildSnapshot(layout, options);
  const document = documentFor(options.projectName ?? basename(layout.root));

  const documentPath = join(graviewDir, DOCUMENT_FILENAME);
  const snapshotPath = join(graviewDir, SNAPSHOT_FILENAME);
  writeFileSync(documentPath, canonicalJson(document));
  writeFileSync(snapshotPath, canonicalJson(report.snapshot));

  return {
    layout,
    graviewDir,
    documentPath,
    snapshotPath,
    dataDir: join(graviewDir, DATA_DIRNAME),
    counts: report.counts,
    warnings: report.warnings,
    prdLayout: report.layout,
  };
}
