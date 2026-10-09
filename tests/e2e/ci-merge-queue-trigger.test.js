/**
 * The merge queue only merges once main's four required checks report on the
 * merge_group run it builds. ci.yml must therefore trigger on merge_group and
 * keep the required check names. Read as text: no YAML dependency.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8");

/** Lines of the top-level `on:` block (up to the next top-level key). */
function onBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  expect(start, "ci.yml has no top-level `on:` block").toBeGreaterThanOrEqual(0);
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l) && !l.startsWith("#")) break;
    body.push(l);
  }
  return body;
}

describe("ci.yml merge queue support", () => {
  it("triggers on merge_group alongside push and pull_request", () => {
    const body = onBlock(ci);
    for (const trigger of ["push", "pull_request", "merge_group"]) {
      expect(
        body.some((l) => new RegExp(`^  ${trigger}:`).test(l)),
        `on: block lacks ${trigger}:`,
      ).toBe(true);
    }
  });

  it.each([
    "name: Build & Validate",
    "name: CLI Smoke (macOS)",
    "name: CLI Smoke (Windows)",
    "name: CLI Smoke Parity",
  ])("keeps required check %s", (entry) => {
    expect(ci).toContain(entry);
  });

  it("keeps the pull_request guard on the changeset requirement", () => {
    const step = ci.split("- name: Require changeset")[1]?.split("\n      - name:")[0];
    expect(step).toContain("github.event_name == 'pull_request'");
  });
});
