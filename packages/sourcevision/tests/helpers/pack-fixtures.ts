/**
 * Where sourcevision keeps its packs' fixture projects, for
 * `@n-dx/lang-runtime`'s golden harness (`fixtureDirFor(PACK_FIXTURE_ROOT, pack)`).
 */

import { fileURLToPath } from "node:url";

export const PACK_FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/language-packs", import.meta.url));
