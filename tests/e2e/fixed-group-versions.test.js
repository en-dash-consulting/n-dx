/**
 * Every package in a changesets `fixed` group must carry the same version.
 *
 * changesets bumps a fixed group together, from the highest version in it. A
 * package left behind (a new package added at the previous release's version,
 * say) is published at a version its siblings never had, and the release tags
 * stop lining up. This test names the odd one out.
 *
 * It also checks the reverse: every published (non-private) workspace package
 * is in some fixed group. A new package left out of `.changeset/config.json`
 * is versioned on its own, and RELEASING.md's single version line is false.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, ".changeset/config.json"), "utf8"));

/** Every packages/<dir>/package.json, parsed. */
function workspacePackages() {
  const packages = [];
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const path = join(ROOT, "packages", dir, "package.json");
    if (!existsSync(path)) continue;
    packages.push(JSON.parse(readFileSync(path, "utf8")));
  }
  return packages;
}

/** Names of the non-private packages that no fixed group lists, sorted. */
function publishedOutsideFixed(packages, fixed) {
  const grouped = new Set((fixed ?? []).flat());
  return packages
    .filter((pkg) => pkg.private !== true && !grouped.has(pkg.name))
    .map((pkg) => pkg.name)
    .sort();
}

describe("changesets fixed groups", () => {
  const packages = workspacePackages();
  const versions = new Map(packages.map((pkg) => [pkg.name, pkg.version]));

  it("holds every published workspace package to a fixed group", () => {
    expect(
      publishedOutsideFixed(packages, CONFIG.fixed),
      "non-private packages in no .changeset/config.json fixed group; add them to one",
    ).toEqual([]);
  });

  it("names a published package left out of the fixed groups, and skips private ones", () => {
    const pkgs = [
      { name: "@n-dx/core" },
      { name: "@n-dx/lang-rust" },
      { name: "@n-dx/scratch", private: true },
    ];
    expect(publishedOutsideFixed(pkgs, [["@n-dx/core"]])).toEqual(["@n-dx/lang-rust"]);
    expect(publishedOutsideFixed(pkgs, undefined)).toEqual(["@n-dx/core", "@n-dx/lang-rust"]);
  });

  it("declares at least one fixed group", () => {
    expect(CONFIG.fixed?.length ?? 0).toBeGreaterThan(0);
  });

  for (const [index, group] of (CONFIG.fixed ?? []).entries()) {
    it(`fixed group ${index} names only workspace packages`, () => {
      const unknown = group.filter((name) => !versions.has(name));
      expect(unknown, `.changeset/config.json fixed[${index}] names packages not in packages/*`).toEqual([]);
    });

    it(`fixed group ${index} shares one version`, () => {
      const present = group.filter((name) => versions.has(name));
      const counts = new Map();
      for (const name of present) {
        const v = versions.get(name);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      // The majority version is the group's; everything else is the odd one out.
      const [expected] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
      const odd = present
        .filter((name) => versions.get(name) !== expected)
        .map((name) => `${name} is ${versions.get(name)}, expected ${expected}`);
      expect(odd, `fixed[${index}] versions differ; set these to the group's version`).toEqual([]);
    });
  }
});
