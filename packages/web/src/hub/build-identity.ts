/**
 * Which build of `@n-dx/web` this hub is running, for `GET /api/hub/health`.
 *
 * `ndx start` compares it with the build it would spawn itself, so a hub left
 * running from an older `dist/` — the case where a source-linked CLI mints a
 * landing nonce the hub has no route for — is named as such instead of
 * surfacing as a missing sign-in link.
 *
 * The version is the package's own; the source hash is what the build stamp
 * (`dist/.build-stamp.json`, scripts/write-build-stamp.mjs) recorded when this
 * `dist/` was built. A published install ships no stamp, so its hash is null.
 *
 * Read once, as the module loads: the files describe the build this process
 * loaded, and a rebuild while the hub runs must not make it claim the new one.
 *
 * Also where the hub asks which package a directory is ({@link isPackageNamed}),
 * for the binaries it is willing to spawn.
 *
 * @module web/hub/build-identity
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface HubBuildIdentity {
  /** `@n-dx/web`'s package version. */
  version: string | null;
  /** The source hash its dist/ build stamp records; null without a stamp. */
  sourceHash: string | null;
  /**
   * The package root this hub runs from. `ndx start` replaces a hub of the
   * same version but another source hash only when this is its own web
   * package: a rebuild of the same checkout, not another checkout's build.
   */
  packageRoot: string;
}

/** File name of the stamp inside dist/ (scripts/lib/stale-dist.mjs, packages/core/build-identity.mjs). */
const BUILD_STAMP_FILE = ".build-stamp.json";

/** `@n-dx/web`'s own root: this module sits at `<pkg>/src/hub/` or `<pkg>/dist/hub/`. */
export const WEB_PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Whether `dir` is the package called `name`, by its own package.json.
 * No package.json, an unreadable one, or one that is not JSON is not the package.
 */
export function isPackageNamed(dir: string, name: string): boolean {
  return readJson(join(dir, "package.json"))?.name === name;
}

/** Read the identity of the package rooted at `packageRoot`. */
function readBuildIdentity(packageRoot: string): HubBuildIdentity {
  const version = readJson(join(packageRoot, "package.json"))?.version;
  const sourceHash = readJson(join(packageRoot, "dist", BUILD_STAMP_FILE))?.sourceHash;
  return {
    version: typeof version === "string" ? version : null,
    sourceHash: typeof sourceHash === "string" ? sourceHash : null,
    packageRoot,
  };
}

/** Read when the hub's modules load, so a later rebuild cannot change the answer. */
const OWN_IDENTITY = readBuildIdentity(WEB_PACKAGE_ROOT);

/** This hub's own build identity. */
export function hubBuildIdentity(): HubBuildIdentity {
  return OWN_IDENTITY;
}
