/**
 * Every feature toggle actually reaches the settings page.
 *
 * The settings page renders package sections in a fixed order and **drops any
 * package missing from that order**:
 *
 *   PACKAGE_ORDER.filter((pkg) => byPackage.has(pkg)).map(...)
 *
 * so a toggle whose package the viewer does not list is silently invisible —
 * no error, no empty section, nothing. That is exactly what happened when the
 * `git` package was added to the registry and to PACKAGE_META but not to
 * PACKAGE_ORDER: two toggles shipped that no user could reach, and the only
 * server test of one of them passed *because* it could not be turned on
 * (`isFeatureEnabled` returns false for a key it cannot find, which is the
 * same answer as "the toggle is off").
 *
 * A toggle nobody can switch is worse than no toggle, so this is a guard
 * rather than a style check.
 */
import { describe, it, expect } from "vitest";

import { featureRegistryPackages } from "../../../src/server/routes-features.js";
import { PACKAGE_ORDER, PACKAGE_META } from "../../../src/viewer/views/feature-toggles.js";

describe("feature toggle rendering reach", () => {
  it("renders a section for every package the registry uses", () => {
    const missing = featureRegistryPackages().filter((pkg) => !PACKAGE_ORDER.includes(pkg));
    expect(
      missing,
      `These packages have toggles in the registry but are not in PACKAGE_ORDER, ` +
        `so their toggles never render on the settings page: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has a heading and description for every package it renders", () => {
    // A package in the order but not in META falls back to the bare package
    // name with a bullet glyph, which reads as a bug on the page.
    const unlabelled = PACKAGE_ORDER.filter((pkg) => !(pkg in PACKAGE_META));
    expect(
      unlabelled,
      `These packages render without a label or description: ${unlabelled.join(", ")}`,
    ).toEqual([]);
  });

  it("does not order a package that has no toggles and no metadata", () => {
    // Keeps the order list honest as packages come and go.
    const known = new Set(featureRegistryPackages());
    const stale = PACKAGE_ORDER.filter((pkg) => !known.has(pkg) && !(pkg in PACKAGE_META));
    expect(stale, `PACKAGE_ORDER names packages that no longer exist: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("reaches the git toggles specifically", () => {
    // The regression this file exists for.
    expect(featureRegistryPackages()).toContain("git");
    expect(PACKAGE_ORDER).toContain("git");
  });
});
