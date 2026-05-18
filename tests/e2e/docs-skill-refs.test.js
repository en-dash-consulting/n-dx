/**
 * Validates cross-references between docs/guide pages and the assistant-assets
 * skill manifest.
 *
 * Two invariants are enforced:
 *
 *  1. Every guide page (except skills.md itself) contains at least one link to
 *     the Skills Reference page (./skills).
 *
 *  2. Every backtick-quoted skill name (e.g. `/ndx-plan`, `no-plan-mode`) that
 *     appears in a guide page matches an entry in the manifest.  Catching typos
 *     before a PR ships is the goal — a reference to `/ndx-plann` would fail here.
 *
 * When a new skill is added to the manifest the only action required is to run
 * `ndx init` and document the skill in the relevant guide pages.  Adding a new
 * guide page requires either a "Skills used in this guide" section or at least a
 * visible link to ./skills.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { getManifest } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");
const GUIDE_DIR = join(ROOT, "docs/guide");

/** Pages excluded from both checks — the skills reference is itself exempt. */
const EXCLUDED = new Set(["skills.md"]);

function readGuidePages() {
  if (!existsSync(GUIDE_DIR)) return [];
  return readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith(".md") && !EXCLUDED.has(f))
    .map((f) => ({
      name: f,
      path: join(GUIDE_DIR, f),
      content: readFileSync(join(GUIDE_DIR, f), "utf-8"),
    }));
}

describe("docs/guide skills cross-references", () => {
  const manifest = getManifest();
  const manifestSkills = new Set(Object.keys(manifest.skills));
  const pages = readGuidePages();

  it("every guide page links to the Skills Reference", () => {
    // Match markdown links whose target starts with ./skills (with optional anchor).
    const hasLink = (content) => /\(\.\/skills[)#]/.test(content);
    const missing = pages.filter((p) => !hasLink(p.content)).map((p) => p.name);
    if (missing.length > 0) {
      expect.fail(
        `Guide pages missing a link to ./skills:\n  ${missing.join("\n  ")}\n\n` +
          "Add a 'Skills used in this guide' section or a 'See: [Skills Reference](./skills)' line.",
      );
    }
  });

  it("every skill name referenced in guide pages exists in the manifest", () => {
    // Match backtick-quoted names that look like skill identifiers:
    //   `/ndx-plan`   →  ndx-plan
    //   `ndx-plan`    →  ndx-plan
    //   `no-plan-mode` → no-plan-mode
    // Only names starting with 'ndx-' or equal to 'no-plan-mode' are checked;
    // this avoids false positives on CLI commands (ndx plan), file paths, etc.
    const SKILL_PATTERN = /`\/?([a-z][a-z0-9-]+)`/g;
    const unknown = [];

    for (const page of pages) {
      const matches = [...page.content.matchAll(SKILL_PATTERN)];
      for (const [, name] of matches) {
        if (
          (name.startsWith("ndx-") || name === "no-plan-mode") &&
          !manifestSkills.has(name)
        ) {
          unknown.push(`${page.name}: \`${name}\``);
        }
      }
    }

    if (unknown.length > 0) {
      expect.fail(
        `Skill references not found in the manifest:\n  ${unknown.join("\n  ")}\n\n` +
          "Fix typos or add the skill to packages/core/assistant-assets/manifest.json.",
      );
    }
  });
});
