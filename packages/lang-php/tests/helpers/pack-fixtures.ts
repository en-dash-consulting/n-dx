/**
 * Where this pack keeps its fixture project, for `@n-dx/lang-runtime`'s
 * golden harness (`fixtureDirFor(PACK_FIXTURE_ROOT, pack)`).
 */

import { join } from "node:path";

export const PACK_FIXTURE_ROOT = join(import.meta.dirname, "..", "fixtures", "language-packs");
