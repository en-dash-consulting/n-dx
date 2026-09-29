/**
 * SourceVision's paths module — the only place sourcevision names a folder of
 * its own.
 *
 * `constants.ts` used to hold `SV_DIR`, but as a bare directory *name*: every
 * call site joined it to a project root itself, which is exactly the pattern
 * that made the folder layout a decision taken in ~380 places. That constant is
 * gone; where the directory lives depends on which layout the project is on,
 * and that question is answered once, by {@link resolveLayout} in the
 * foundation tier.
 *
 * The one place that cannot ask is `src/export/`, which bundles into the
 * dependency-free standalone iso-map skill and carries a hand-written twin
 * (`analysisDirFor`) pinned by
 * `tests/integration/layout-resolver-contract.test.js`.
 *
 * The artifact filenames inside it stay in `schema/data-files.ts` — that is
 * already their single source of truth, and duplicating them here would create
 * a second one. This module composes the two.
 *
 * SourceVision may import `@n-dx/llm-client` directly — foundation-tier imports
 * are ungated for domain packages (see `packages/core/gateway-rules.json`).
 *
 * @module sourcevision/paths
 * @see packages/llm-client/src/layout.ts — the resolver and its lookup order
 */

import { join } from "node:path";

import { resolveLayout, type ResolveLayoutOptions } from "@n-dx/llm-client";

import { DATA_FILES } from "./schema/data-files.js";

/**
 * Name of the machine-local cache inside the analysis directory.
 *
 * Holds the Jev judgment cache, the narration log and the per-run analysis
 * ledger. All of it is safe to delete — the next run rebuilds what it needs.
 */
export const SV_CACHE_DIRNAME = ".cache";

/** Every path sourcevision owns inside a project, joined to the project root. */
export interface SourcevisionPaths {
  /** Analysis output directory — `.ndx/sourcevision` or `.sourcevision`. */
  svDir: string;
  /** The run manifest, which records what the last analysis did. */
  manifestPath: string;
  /** Machine-local cache directory — safe to delete. */
  cacheDir: string;
  /** Absolute path to one analysis artifact, by its {@link DATA_FILES} key. */
  dataFile: (key: keyof typeof DATA_FILES) => string;
}

/**
 * Resolve sourcevision's paths for a project root.
 *
 * @param root     Absolute project root (the directory *containing* the
 *                 analysis directory).
 * @param options  Forwarded to {@link resolveLayout} — pass `{ mode }` to ask
 *                 for a layout by name rather than detecting one.
 */
export function resolveSourcevisionPaths(
  root: string,
  options?: ResolveLayoutOptions,
): SourcevisionPaths {
  const { sourcevisionDir: svDir } = resolveLayout(root, options);
  return {
    svDir,
    manifestPath: join(svDir, DATA_FILES.manifest),
    cacheDir: join(svDir, SV_CACHE_DIRNAME),
    dataFile: (key) => join(svDir, DATA_FILES[key]),
  };
}
