/**
 * Final step of a package's full build: record the source content `dist/` was
 * compiled from. Run from the package directory (npm scripts do) after the
 * compile succeeds. Never run from a partial build — see scripts/lib/stale-dist.mjs.
 */
import { join } from "node:path";
import { writeBuildStamp } from "./lib/stale-dist.mjs";

const pkgDir = process.cwd();
writeBuildStamp(join(pkgDir, "src"), join(pkgDir, "dist"));
