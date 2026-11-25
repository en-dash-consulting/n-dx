/**
 * The pure classifiers behind ci.yml's "Forbid edits to existing changesets"
 * and "Validate changesets" steps. The steps run `git diff` themselves and
 * pass the path lists in; these tests feed the same shapes directly.
 *
 * @see scripts/changeset-pr-checks.mjs
 * @see tests/e2e/ci-changeset-checks.test.js — the ci.yml side
 */

import { describe, it, expect } from "vitest";
import {
  isChangesetFile,
  classifyVersionPr,
  findEditedChangesets,
} from "../../scripts/changeset-pr-checks.mjs";

describe("isChangesetFile", () => {
  it.each([
    [".changeset/brave-otters-sing.md", true],
    [".changeset/README.md", false],
    [".changeset/config.json", false],
    [".changeset/nested/x.md", false],
    ["docs/x.md", false],
  ])("%s → %s", (path, expected) => {
    expect(isChangesetFile(path)).toBe(expected);
  });
});

describe("classifyVersionPr", () => {
  const consumed = [".changeset/a.md", ".changeset/b.md"];
  const scaffold = [".changeset/README.md", ".changeset/config.json"];

  it("detects the version PR: deletes changesets, adds none, leaves none", () => {
    const result = classifyVersionPr({ added: [], deleted: consumed, remaining: scaffold });
    expect(result.versionPr).toBe(true);
    expect(result.reason).toContain("consumes 2 changeset(s)");
  });

  it("is not the version PR when the branch adds a changeset", () => {
    const result = classifyVersionPr({ added: [".changeset/new.md"], deleted: consumed, remaining: [...scaffold, ".changeset/new.md"] });
    expect(result).toEqual({ versionPr: false, reason: "adds 1 changeset(s)" });
  });

  it("is not the version PR when changesets remain in the tree", () => {
    const result = classifyVersionPr({ added: [], deleted: consumed, remaining: [...scaffold, ".changeset/c.md"] });
    expect(result).toEqual({ versionPr: false, reason: "1 changeset(s) remain in the tree" });
  });

  it("is not the version PR when the branch deletes no changeset (a normal PR)", () => {
    const result = classifyVersionPr({ added: [".changeset/new.md"], deleted: [], remaining: [...scaffold, ".changeset/new.md"] });
    expect(result).toEqual({ versionPr: false, reason: "deletes no changeset" });
  });

  it("ignores README.md and config.json in every list", () => {
    expect(classifyVersionPr({ added: scaffold, deleted: consumed, remaining: scaffold }).versionPr).toBe(true);
    expect(classifyVersionPr({ added: [], deleted: scaffold, remaining: scaffold })).toEqual({
      versionPr: false,
      reason: "deletes no changeset",
    });
  });
});

describe("findEditedChangesets", () => {
  it("reports a modified changeset", () => {
    const { edited, message } = findEditedChangesets(["M\t.changeset/hench-php-guards.md"]);
    expect(edited).toEqual([".changeset/hench-php-guards.md"]);
    expect(message).toContain("edits 1 changeset(s) already on main");
    expect(message).toContain("  .changeset/hench-php-guards.md");
  });

  it("reports a renamed changeset by its old path, naming the new one", () => {
    const { edited } = findEditedChangesets(["R087\t.changeset/old.md\t.changeset/new.md"]);
    expect(edited).toEqual([".changeset/old.md (renamed to .changeset/new.md)"]);
  });

  it("ignores README.md and non-changeset paths", () => {
    const result = findEditedChangesets([
      "M\t.changeset/README.md",
      "M\t.changeset/config.json",
      "M\tpackages/rex/src/index.ts",
      "R100\tdocs/a.md\tdocs/b.md",
    ]);
    expect(result).toEqual({ edited: [], message: "" });
  });

  it("returns an empty message when nothing is edited", () => {
    expect(findEditedChangesets([])).toEqual({ edited: [], message: "" });
  });
});
