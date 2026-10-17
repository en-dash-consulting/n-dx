/**
 * Every package in a changesets `fixed` group must carry the same version.
 *
 * changesets bumps a fixed group together, from the highest version in it. A
 * package left behind (a new package added at the previous release's version,
 * say) is published at a version its siblings never had, and the release tags
 * stop lining up. This test names the odd one out.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, ".changeset/config.json"), "utf8"));

/** Workspace package name → version, read from packages/<dir>/package.json. */
function workspaceVersions() {
  const versions = new Map();
  for (const dir of readdirSync(join(ROOT, "packages"))) {
    const path = join(ROOT, "packages", dir, "package.json");
    if (!existsSync(path)) continue;
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    versions.set(pkg.name, pkg.version);
  }
  return versions;
}

describe("changesets fixed groups", () => {
  const versions = workspaceVersions();

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
