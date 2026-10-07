/**
 * The labels `ndx init` prints for the three tool directories.
 *
 * Both init recaps — the Ink one on a TTY and the static one everywhere else —
 * read their names from `initDirLabels`, so this is where the names are
 * pinned. The defect it guards is a fresh init reporting `.rex/ created` when
 * `establishInitLayout` had just put the project on `.ndx/` and the directory
 * that exists is `.ndx/rex/`.
 *
 * @see packages/core/init-summary.js
 * @see tests/e2e/cli-init.test.js — the same labels, through a real init run
 */

import { describe, it, expect } from "vitest";
import { resolveLayout } from "../../packages/core/layout.js";
import { initDirLabels, padInitDirLabel } from "../../packages/core/init-summary.js";

const ROOT = "/tmp/project";

describe("initDirLabels", () => {
  it("names the container paths on the .ndx layout", () => {
    const labels = initDirLabels(resolveLayout(ROOT, { mode: "ndx" }));

    expect(labels).toEqual({
      sourcevision: ".ndx/sourcevision/",
      rex: ".ndx/rex/",
      hench: ".ndx/hench/",
    });
  });

  it("names the root paths on the legacy layout", () => {
    const labels = initDirLabels(resolveLayout(ROOT, { mode: "legacy" }));

    expect(labels).toEqual({
      sourcevision: ".sourcevision/",
      rex: ".rex/",
      hench: ".hench/",
    });
  });

  it("uses forward slashes so a Windows run reads the same", () => {
    for (const mode of ["ndx", "legacy"]) {
      const labels = initDirLabels(resolveLayout(ROOT, { mode }));
      for (const label of Object.values(labels)) expect(label).not.toContain("\\");
    }
  });
});

describe("padInitDirLabel", () => {
  it("pads every label to the widest, on either layout", () => {
    for (const mode of ["ndx", "legacy"]) {
      const labels = initDirLabels(resolveLayout(ROOT, { mode }));
      const width = Math.max(...Object.values(labels).map((l) => l.length));
      for (const label of Object.values(labels)) {
        expect(padInitDirLabel(label, labels)).toHaveLength(width);
      }
    }
  });

  it("widens the column on the .ndx layout rather than truncating", () => {
    const ndx = initDirLabels(resolveLayout(ROOT, { mode: "ndx" }));
    const legacy = initDirLabels(resolveLayout(ROOT, { mode: "legacy" }));

    expect(padInitDirLabel(ndx.rex, ndx).length)
      .toBeGreaterThan(padInitDirLabel(legacy.rex, legacy).length);
    expect(padInitDirLabel(ndx.rex, ndx).trimEnd()).toBe(".ndx/rex/");
  });
});
