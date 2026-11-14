/**
 * Every feature toggle actually reaches the settings page.
 *
 * Settings › Project renders a section per entry of PROJECT_SECTIONS and puts
 * each toggle in the section its registry `group` names, so a toggle in a group
 * the page does not list would be silently invisible: no error, no empty
 * section, nothing. That happened once already, under the old by-package
 * layout, when the `git` package was added to the registry but not to the
 * page's order: two toggles shipped that no user could reach.
 *
 * A toggle nobody can switch is worse than no toggle, so this is a guard
 * rather than a style check.
 */
import { describe, it, expect } from "vitest";

import { featureRegistryGroups } from "../../../src/server/routes-features.js";
import { PROJECT_SECTIONS } from "../../../src/viewer/views/project-sections.js";

describe("feature toggle rendering reach", () => {
  const sectionIds = PROJECT_SECTIONS.map((s) => s.id as string);

  it("has a section for every group the registry uses", () => {
    const missing = featureRegistryGroups().filter((group) => !sectionIds.includes(group));
    expect(
      missing,
      `These groups have toggles in the registry but no section on Settings › Project, ` +
        `so their toggles never render: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("gives every section a title and lists each once", () => {
    expect(PROJECT_SECTIONS.every((s) => s.title.trim() !== "")).toBe(true);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });
});
