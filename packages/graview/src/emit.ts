/**
 * Write the two files Graview reads, under the layout's graview dir: the
 * declaration as canonical JSON, the snapshot in Graview's line format
 * (`snapshot-file.ts`), whose first line says when it was made and what it
 * holds. Beside them, when sourcevision has analyzed the project, the
 * isometric architecture map in embed mode (`iso-map.html`), which the face's
 * Code map page and zone pages frame.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveLayout, type Layout } from "./llm-gateway.js";
import { documentFor } from "./document.js";
import { buildSnapshot, graviewDirOf, type BuildSnapshotOptions } from "./snapshot.js";
import { canonicalJson } from "./canonical.js";
import { writeSnapshotFile } from "./snapshot-file.js";
import { fitSnapshot, type Misfit } from "./fit.js";
import { buildIsoModel, loadFromSourcevision, renderIsoMap } from "./sourcevision-gateway.js";
import type { Warn } from "./types.js";

export const DOCUMENT_FILENAME = "document.json";
export const SNAPSHOT_FILENAME = "snapshot.json";
export const DATA_DIRNAME = "data";
export const ISO_MAP_FILENAME = "iso-map.html";
/**
 * Ignores the whole graview dir from inside it. `ndx init` gitignores the dir,
 * but a project initialized before the projection existed has no such entry,
 * and nothing in here is ever meant to be committed.
 */
export const GITIGNORE_FILENAME = ".gitignore";

export interface EmitOptions extends BuildSnapshotOptions {
  /** The document's `name`; defaults to the project directory's name. */
  projectName?: string;
  /** What the snapshot's header says it was made at; now when unset. */
  generatedAt?: string | Date;
  /** Write the isometric map beside the snapshot. Default true; it needs sourcevision's analysis. */
  isoMap?: boolean;
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
  /** Where the product layer came from: the v2 tree, rex's migration plan over a v1 tree, or nowhere. */
  productLayer: "stored" | "proposed" | "none";
  /** Records and edges the declaration does not admit (`fit.ts`); `check` fails on any. */
  misfits: Misfit[];
  /** The isometric map, when one was written. */
  isoMapPath?: string;
}

/**
 * The isometric map in embed mode, from the analysis on disk: written when
 * sourcevision has analyzed the project, and a stale one removed when it no
 * longer has, so the face never frames a map of an analysis that is gone.
 */
function writeIsoMap(root: string, graviewDir: string, title: string, warn: Warn | undefined): string | undefined {
  const path = join(graviewDir, ISO_MAP_FILENAME);
  try {
    const input = loadFromSourcevision(root);
    if (!input) {
      if (existsSync(path)) rmSync(path);
      return undefined;
    }
    writeAtomically(path, renderIsoMap(buildIsoModel(input), { embed: true, title: `${title} — code map` }));
    return path;
  } catch (error) {
    warn?.(`The code map was not written: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function writeAtomically(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export async function emitProjection(root: string, options: EmitOptions = {}): Promise<EmitResult> {
  const layout = resolveLayout(root);
  const graviewDir = graviewDirOf(layout);
  mkdirSync(graviewDir, { recursive: true });
  const gitignore = join(graviewDir, GITIGNORE_FILENAME);
  if (!existsSync(gitignore)) writeFileSync(gitignore, "# Derived by ndx graview; never committed.\n*\n");

  const report = await buildSnapshot(layout, options);
  const document = documentFor(options.projectName ?? basename(layout.root));

  const documentPath = join(graviewDir, DOCUMENT_FILENAME);
  const snapshotPath = join(graviewDir, SNAPSHOT_FILENAME);
  // Written whole: a face reads these while a re-emit runs, and a half-written file is not JSON.
  writeAtomically(documentPath, canonicalJson(document));
  writeAtomically(snapshotPath, writeSnapshotFile(report.snapshot, options.generatedAt ?? new Date()));
  const isoMapPath = options.isoMap === false ? undefined : writeIsoMap(layout.root, graviewDir, document.name, options.warn);

  return {
    layout,
    graviewDir,
    documentPath,
    snapshotPath,
    dataDir: join(graviewDir, DATA_DIRNAME),
    counts: report.counts,
    warnings: report.warnings,
    prdLayout: report.layout,
    productLayer: report.productLayer,
    misfits: fitSnapshot(document, report.snapshot),
    ...(isoMapPath ? { isoMapPath } : {}),
  };
}
