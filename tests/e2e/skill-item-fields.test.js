/**
 * Structural tests: skills that create PRD items name `add_item`'s parameters.
 *
 * A skill that says "draft the item with title, description, and acceptance
 * criteria" leaves the assistant to guess which schema field each piece belongs
 * in. The criteria land in `description` prose and `acceptanceCriteria` stays
 * empty — and that array is what `verify_criteria` (rex MCP) and the dashboard's
 * requirements view read. Criteria written as prose therefore cannot be mapped
 * to tests or checked by a later review: the item looks complete while being
 * quietly unverifiable. `level` has the same problem for a different reason —
 * it is required with no default, so an unstated level is guessed per run and
 * drifts between them.
 *
 * The skill list is derived from the manifest rather than hardcoded, so a NEW
 * skill that creates items is covered the moment it is added.
 *
 * @see packages/rex/src/cli/mcp.ts — the add_item schema these bodies write against
 * @see tests/e2e/skill-run-recording.test.js — same derive-from-manifest approach
 */

import { describe, it, expect } from "vitest";
import { getSkillNames, getSkillBody } from "../../packages/core/assistant-assets.js";

/** Skills whose body calls `add_item`. */
const ITEM_CREATING_SKILLS = getSkillNames().filter((name) =>
  getSkillBody(name).includes("add_item"),
);

describe("skills that create PRD items name add_item's fields", () => {
  it("at least one skill creates items (guards against a vacuous suite)", () => {
    expect(ITEM_CREATING_SKILLS.length).toBeGreaterThan(0);
  });

  for (const name of ITEM_CREATING_SKILLS) {
    it(`${name}: names the required \`level\` parameter`, () => {
      expect(
        getSkillBody(name),
        `${name} calls add_item without naming \`level\`. It is required and has ` +
          `no default, so each run guesses and items of the same kind land at ` +
          `different levels. State which level to use.`,
      ).toMatch(/`level`/);
    });

    it(`${name}: directs acceptance criteria to the \`acceptanceCriteria\` field`, () => {
      expect(
        getSkillBody(name),
        `${name} calls add_item without naming \`acceptanceCriteria\`. Criteria ` +
          `written into \`description\` prose are invisible to verify_criteria and ` +
          `to the dashboard's requirements view, so the item cannot be checked by ` +
          `a later review.`,
      ).toMatch(/`?acceptanceCriteria`?/);
    });
  }
});
