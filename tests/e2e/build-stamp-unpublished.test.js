/**
 * The build stamp (dist/.build-stamp.json) is bookkeeping for the repository's
 * affected test gate, not runtime content. It stays inside dist/ (so deleting
 * dist deletes it) and is kept out of the published tarball through `files`.
 *
 * A package whose build script runs write-build-stamp.mjs must therefore
 * exclude it with "!dist/.build-stamp.json".
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
// execFileSyncCli: `pnpm` is a `.CMD` shim on Windows (see published-assets-bundled).
import { execFileSyncCli } from "../../packages/core/win-spawn.js";

const PACKAGES_DIR = join(import.meta.dirname, "../../packages");
const STAMP_EXCLUDE = "!dist/.build-stamp.json";

const packages = readdirSync(PACKAGES_DIR)
  .filter((name) => existsSync(join(PACKAGES_DIR, name, "package.json")))
  .map((name) => ({
    name,
    pkg: JSON.parse(readFileSync(join(PACKAGES_DIR, name, "package.json"), "utf-8")),
  }));

const stamped = packages.filter(({ pkg }) =>
  (pkg.scripts?.build ?? "").includes("write-build-stamp.mjs"),
);

describe("build stamp stays out of published packages", () => {
  it("at least one package writes the stamp (guard is not vacuous)", () => {
    expect(stamped.length).toBeGreaterThan(0);
  });

  it.each(stamped.map(({ name, pkg }) => [name, pkg]))(
    "%s excludes dist/.build-stamp.json from `files`",
    (_name, pkg) => {
      expect(pkg.files).toContain(STAMP_EXCLUDE);
    },
  );

  it("`pnpm pack --dry-run` of a built package does not list the stamp", () => {
    const dir = join(PACKAGES_DIR, "llm-client");
    // Precondition: the stamp exists, so its absence from the tarball is the
    // exclusion at work rather than a missing build.
    expect(existsSync(join(dir, "dist", ".build-stamp.json"))).toBe(true);
    const out = execFileSyncCli("pnpm", ["pack", "--dry-run", "--json"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const report = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const shipped = report.files.map((f) => f.path);
    expect(shipped.some((p) => p.startsWith("dist/"))).toBe(true);
    expect(shipped).not.toContain("dist/.build-stamp.json");
  });
});
