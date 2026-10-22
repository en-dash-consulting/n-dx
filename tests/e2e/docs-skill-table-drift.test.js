/**
 * docs/guide/skills.md says its Skill Inventory table is derived from
 * packages/core/assistant-assets/manifest.json. Nothing generates it, so this
 * test is the check: each Purpose cell must equal the skill's manifest
 * description verbatim, and the table must list exactly the manifest's skills.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { getManifest } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");

function readTableRows() {
  const lines = readFileSync(join(ROOT, "docs/guide/skills.md"), "utf-8").split("\n");
  const rows = [];
  for (const line of lines) {
    // Skill rows start with a linked, backtick-quoted name: | [`name`](#name) | ...
    const name = /^\|\s*\[`([^`]+)`\]/.exec(line)?.[1];
    if (!name) continue;
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    rows.push({ name, purpose: cells[2] });
  }
  return rows;
}

describe("docs/guide/skills.md skill table matches manifest.json", () => {
  const skills = getManifest().skills;
  const rows = readTableRows();

  it("lists exactly the manifest's skills", () => {
    expect(rows.map((r) => r.name).sort()).toEqual(Object.keys(skills).sort());
  });

  it.each(rows)("$name Purpose equals the manifest description", ({ name, purpose }) => {
    expect(purpose).toBe(skills[name]?.description);
  });
});
