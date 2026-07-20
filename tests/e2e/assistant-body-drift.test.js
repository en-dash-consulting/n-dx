/**
 * Assistant body-drift regression — verifies that the *committed* assistant
 * artifacts are byte-for-byte what the canonical generator would produce
 * today.
 *
 * The existing parity tests cover inventory drift (which skills exist) and
 * section-level equivalence (CLAUDE.md vs AGENTS.md headings), but nothing
 * regenerated the outputs from `assistant-assets/` and diffed them against the
 * files checked into the repo. That left a gap: hand-edit a committed
 * `SKILL.md` / `CLAUDE.md` / `AGENTS.md`, or change the generator without
 * re-running `ndx init`, and every test stayed green while the shipped
 * artifacts silently diverged from the single source of truth.
 *
 * This test closes that gap — it is the "tests fail on drift" acceptance
 * criterion of the Codex workflow-parity epic (GitHub #122).
 *
 * If this test fails, the committed artifact and the canonical source have
 * diverged. Re-run `ndx init .` to regenerate the artifacts from
 * `packages/core/assistant-assets/`, or move the hand-edit back into the
 * canonical source (`project-guidance.md` / `claude-addendum.md` /
 * `skills/<name>.md`) so both vendor surfaces stay in sync.
 *
 * @see tests/e2e/instruction-alignment.test.js — section-level equivalence
 * @see tests/e2e/skill-sync.test.js — inventory drift
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  getVendors,
  getVendorTarget,
  getSkillNames,
  renderSkill,
  renderClaudeMd,
  renderAgentsMd,
} from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");

/** Normalize line endings so LF-pinned files compare equal to generator output. */
const norm = (s) => s.replace(/\r\n/g, "\n");

/** Render the instruction file for a vendor from the canonical source. */
function renderInstruction(vendor) {
  if (vendor === "claude") return renderClaudeMd();
  if (vendor === "codex") return renderAgentsMd();
  throw new Error(`No instruction renderer for vendor "${vendor}"`);
}

const VENDORS = Object.keys(getVendors());
const SKILLS = getSkillNames();

describe("assistant body-drift: committed skills match the generator", () => {
  for (const vendor of VENDORS) {
    const target = getVendorTarget(vendor);

    describe(`${vendor} (${target.skillDir})`, () => {
      for (const name of SKILLS) {
        const relPath = join(target.skillDir, name, target.skillFile);
        const absPath = join(ROOT, relPath);

        it(`${name}/${target.skillFile} is committed`, () => {
          expect(
            existsSync(absPath),
            `Missing committed skill: ${relPath}. Run \`ndx init .\` to regenerate.`,
          ).toBe(true);
        });

        it(`${name}/${target.skillFile} matches renderSkill("${name}", "${vendor}")`, () => {
          if (!existsSync(absPath)) return; // presence asserted above
          const committed = norm(readFileSync(absPath, "utf-8"));
          const generated = norm(renderSkill(name, vendor));
          expect(
            committed,
            `${relPath} has drifted from the canonical source. ` +
              `Re-run \`ndx init .\` or move the edit back into ` +
              `packages/core/assistant-assets/skills/${name}.md.`,
          ).toBe(generated);
        });
      }
    });
  }
});

describe("assistant body-drift: committed instruction files match the generator", () => {
  for (const vendor of VENDORS) {
    const target = getVendorTarget(vendor);
    const relPath = target.instructionFile;
    const absPath = join(ROOT, relPath);

    it(`${relPath} is committed`, () => {
      expect(
        existsSync(absPath),
        `Missing committed instruction file: ${relPath}.`,
      ).toBe(true);
    });

    it(`${relPath} matches the canonical generator output`, () => {
      if (!existsSync(absPath)) return; // presence asserted above
      const committed = norm(readFileSync(absPath, "utf-8"));
      const generated = norm(renderInstruction(vendor));
      expect(
        committed,
        `${relPath} has drifted from the canonical source. ` +
          `A hand-edit was made to ${relPath} that is not reflected in ` +
          `packages/core/assistant-assets/project-guidance.md (shared) or ` +
          `claude-addendum.md (Claude-only). Move the change into the ` +
          `canonical source so both CLAUDE.md and AGENTS.md stay in sync, ` +
          `then re-run \`ndx init .\`.`,
      ).toBe(generated);
    });
  }
});
