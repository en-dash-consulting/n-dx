/**
 * Declared architecture, as the iso map consumes it.
 *
 * Injection seams and runtime infrastructure are the two things the import
 * graph structurally cannot show. Discovering them is no longer this module's
 * job — it moved to `analyzers/infrastructure.ts` and runs at analyze time, so
 * the knowledge lands in `infrastructure.json` where anything can read it
 * rather than existing only inside a rendered HTML page.
 *
 * What is left here is the choice between the two sources:
 *
 *   - **Persisted.** `loadFromSourcevision` reads `infrastructure.json` from
 *     the analysis directory and passes it in. Nothing is recomputed.
 *   - **Computed.** A repository scanned with no analysis — which is how the
 *     standalone skill runs on an arbitrary repo — and an analysis made before
 *     the file existed both fall back to discovering it on the spot.
 *
 * The two must produce identical output; `tests/unit/export/iso-declared.test.ts`
 * renders both and compares the HTML byte for byte.
 *
 * Only `node:` builtins and type-only imports appear here and in the analyzer
 * behind it, so both bundle into the standalone skill script.
 */

import {
  computeInfrastructure,
  fromInfrastructureData,
} from "../analyzers/infrastructure.js";
import type { InfrastructureData } from "../schema/v1.js";

// Re-exported so existing consumers keep their import site while there is one
// implementation behind it. Discovery lives in the analyzer; this module only
// chooses a source.
export {
  computeInfrastructure,
  discoverFromIaC,
  linkInfrastructure,
  ndxContainer,
  projectConfigFor,
  readDeclaredConfig,
  readInfrastructure,
  toInfrastructureData,
  fromInfrastructureData,
} from "../analyzers/infrastructure.js";
export type {
  DeclaredArchitecture,
  DeclaredInfra,
  DeclaredSeam,
} from "../analyzers/infrastructure.js";

import type { DeclaredArchitecture } from "../analyzers/infrastructure.js";

/**
 * Everything the map knows that the import graph does not.
 *
 * `persisted` is the analysis's `infrastructure.json` when the caller has one;
 * passing it is what makes this a read rather than a second discovery. With
 * none, the tree is walked as before.
 *
 * `readFile` lets the scanner reuse contents it already has; when omitted,
 * files are read on demand and only if there is IaC to link. It is unused on
 * the persisted path, where nothing needs reading.
 */
export function loadDeclaredArchitecture(
  root: string,
  filePaths: string[],
  readFile?: (path: string) => string | null,
  persisted?: InfrastructureData | null,
): DeclaredArchitecture {
  if (persisted) return fromInfrastructureData(persisted);
  return computeInfrastructure(root, filePaths, readFile);
}
