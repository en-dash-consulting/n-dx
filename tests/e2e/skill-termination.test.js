/**
 * Every skill says where it stops.
 *
 * A skill without a stopping condition does not fail loudly — it overruns. The
 * agent finishes the work that was asked for, finds itself still holding
 * context and tools, and continues into whatever looks adjacent: fixing the
 * defect it was only asked to report, committing files the run was only asked
 * to inspect, planning the next task after finishing this one. Each step is
 * locally reasonable, which is exactly why prose alone does not prevent it.
 *
 * `ndx-adversarial-review` is the model. It states the boundary three ways —
 * "By itself, this skill changes nothing", a Step 5 that stops and asks, and a
 * closing "Fixing is a separate run" — and it is the only skill that did. The
 * other twelve ended on their last action with nothing marking it as the last.
 *
 * What counts as a terminating action, and why the bar is a distinct final
 * section rather than a keyword: a skill can use the word "stop" in passing
 * ("stop and ask if the ID is ambiguous") without ever saying what completion
 * looks like. The assertion therefore looks for an explicit statement of the
 * final action and of what is deliberately *not* done — the two halves that
 * together make an ending unambiguous.
 *
 * @see tests/helpers/all-skills.js — covers repo-local skills too
 */

import { describe, it, expect } from "vitest";
import { allSkills } from "../helpers/all-skills.js";

const SKILLS = allSkills();

/**
 * The marker a skill uses to declare its ending.
 *
 * A literal heading, so the check cannot be satisfied by incidental prose. It
 * is deliberately the same string in every skill: an agent reading any of them
 * meets the same signal in the same place.
 */
const STOP_HEADING = "## Done when";

describe("every skill declares a terminating action", () => {
  it("finds skills to check (guards against a vacuous suite)", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(13);
  });

  it("covers repo-local skills, not just the shipped ten", () => {
    // The bug this file was written alongside: content guards derived their
    // list from the manifest, silently exempting iso-map, triage and dev-link.
    const local = SKILLS.filter((s) => !s.shipped).map((s) => s.name);
    expect(local).toEqual(expect.arrayContaining(["dev-link", "iso-map", "triage"]));
  });

  for (const skill of SKILLS) {
    describe(skill.name, () => {
      it("has a 'Done when' section", () => {
        expect(
          skill.body.includes(STOP_HEADING),
          `${skill.file} has no "${STOP_HEADING}" section. A skill that does ` +
            "not say where it stops will continue into adjacent work.",
        ).toBe(true);
      });

      it("names what it does not do", () => {
        // The other half of an unambiguous ending. Without it, "done when the
        // report is delivered" still leaves open whether fixing is included.
        const section = skill.body.slice(skill.body.indexOf(STOP_HEADING));
        expect(
          /\bnot\b|\bnever\b|\bseparate run\b|\bdoes not\b/i.test(section),
          `${skill.file}: the "${STOP_HEADING}" section states what completes ` +
            "the run but not what is out of scope for it.",
        ).toBe(true);
      });

      it("puts the stopping condition last", () => {
        // A stopping condition buried mid-document is a step, not an ending.
        // Allow trailing notes, but nothing that reads as further work.
        const after = skill.body.slice(
          skill.body.indexOf(STOP_HEADING) + STOP_HEADING.length,
        );
        expect(
          /^\s*##\s+(?!Done when)/m.test(after),
          `${skill.file}: another "##" section follows "${STOP_HEADING}". ` +
            "The stopping condition must be the final section.",
        ).toBe(false);
      });
    });
  }
});
