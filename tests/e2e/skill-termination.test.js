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
 * ## What this file actually checks, and what it cannot
 *
 * Two things: that a `## Done when` section exists and is last, and that it
 * contains one of the boundary phrasings listed in {@link BOUNDARY_PHRASINGS}.
 *
 * That second check is **lexical, not semantic**. It cannot tell that a
 * sentence means "and nothing beyond this"; it recognises the phrasings the
 * skills actually use to say so. An earlier version accepted a bare `not`
 * anywhere in the section, which is a far weaker thing than its own docstring
 * claimed: "The report is delivered, whether or not the user acts on it."
 * satisfied it while stating no boundary at all. All thirteen skills happened
 * to carry a real scope statement, so the guard was honest in practice and
 * would not have stopped the fourteenth.
 *
 * The deliberate consequence of a phrase list: a genuinely new way of phrasing
 * a boundary fails until it is added here. That is the intended cost. It keeps
 * this list an explicit record of the forms the repo accepts, reviewed when it
 * grows, rather than a regex that quietly waves things through — and the
 * failure message tells an author exactly which shapes are recognised.
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

/**
 * Phrasings that count as stating a boundary, in the two shapes the skills use.
 *
 * Both are attested, which is why both are here. A negated action ("do not
 * pick up the next task") is the common form. The "no <noun>" form is how
 * `no-plan-mode` states its boundary — "It produces no output, writes no file,
 * and requires no record" — a real scope statement containing no negated verb
 * at all, so a list carrying only the first shape would reject it.
 *
 * Kept close to what is actually in use. A broader list would accept more
 * incidental prose, which is the failure being fixed rather than a safety
 * margin.
 */
const BOUNDARY_PHRASINGS = [
  // A negated action: what the skill will not do.
  { shape: "negated action", pattern: /\bdo not\b/i },
  { shape: "negated action", pattern: /\bdoes not\b/i },
  { shape: "negated action", pattern: /\bdon't\b/i },
  { shape: "negated action", pattern: /\bdoesn't\b/i },
  { shape: "negated action", pattern: /\bnever\b/i },
  { shape: "negated action", pattern: /\bis a separate run\b/i },
  { shape: "negated action", pattern: /\bstop there\b/i },
  // An absence: what the skill produces none of.
  { shape: "stated absence", pattern: /\b(?:produces|writes|requires|leaves|needs) no\b/i },
  { shape: "stated absence", pattern: /\bno (?:output|file|files|record|records|PRD item)\b/i },
  { shape: "stated absence", pattern: /\bnothing else\b/i },
];

/**
 * Whether a `## Done when` section states what the skill will not do.
 *
 * Exported shape rather than an inline regex so the fixtures below can be
 * driven through the same code path the real skills are — a guard whose
 * behaviour on a known-bad input is untested is the thing this task was about.
 *
 * @param section - text from `## Done when` to the end of the skill body
 * @returns the matching phrasing, or null when none of them appear
 */
export function statesItsBoundary(section) {
  return BOUNDARY_PHRASINGS.find(({ pattern }) => pattern.test(section)) ?? null;
}

/** The section from `## Done when` onwards, or "" when there is no such heading. */
function doneWhenSection(body) {
  const at = body.indexOf(STOP_HEADING);
  return at === -1 ? "" : body.slice(at);
}

/** Failure text that tells an author what to write, not what regex to satisfy. */
function boundaryHelp(file) {
  return [
    `${file}: the "${STOP_HEADING}" section says what completes the run but`,
    "not what is out of scope for it. Without that, \"done when the report is",
    "delivered\" still leaves open whether fixing is included.",
    "",
    "State the boundary in one of the two recognised shapes:",
    "",
    '  negated action   — "This skill does not fix anything", "Do not pick up',
    '                     the next task", "Fixing is a separate run"',
    '  stated absence   — "It produces no output, writes no file, and requires',
    '                     no record", "Nothing else."',
    "",
    "If your wording is a genuine third shape, add it to BOUNDARY_PHRASINGS in",
    "tests/e2e/skill-termination.test.js — the list is meant to be a reviewed",
    "record of accepted phrasings, so extending it is expected.",
  ].join("\n");
}

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
        // The other half of an unambiguous ending.
        expect(
          statesItsBoundary(doneWhenSection(skill.body)),
          boundaryHelp(skill.file),
        ).not.toBeNull();
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

// ── The guard's own behaviour ────────────────────────────────────────────────
//
// Thirteen passing skills say nothing about whether the check would reject a
// bad one — and it would not, before this. These fixtures pin both directions,
// so the assertion above cannot decay into one that always passes.

describe("the boundary check itself", () => {
  it("rejects an incidental negation that states no boundary", () => {
    // The exact text that satisfied the previous `\bnot\b` alternative.
    const section = [
      "## Done when",
      "The report is delivered, whether or not the user acts on it.",
    ].join("\n");

    expect(
      statesItsBoundary(section),
      '"whether or not" is a negation inside an unrelated clause, not a ' +
        "statement of what the skill will not do.",
    ).toBeNull();
  });

  it("rejects a section that states only what completes the run", () => {
    const section = ["## Done when", "The report is delivered to the user."].join("\n");
    expect(statesItsBoundary(section)).toBeNull();
  });

  it("accepts a boundary phrased as a negated action", () => {
    const section = [
      "## Done when",
      "The item exists in the PRD. Do not start implementing what was captured.",
    ].join("\n");
    expect(statesItsBoundary(section)?.shape).toBe("negated action");
  });

  it("accepts a boundary phrased as a stated absence", () => {
    // no-plan-mode's real shape: a scope statement with no negated verb, which
    // a list carrying only the first shape would have rejected. Verified
    // against the live skill before this list was narrowed.
    const section = [
      "## Done when",
      "There is no run to finish: this skill is a standing rule, not a procedure.",
      "It produces no output, writes no file, and requires no record.",
    ].join("\n");
    expect(statesItsBoundary(section)?.shape).toBe("stated absence");
  });

  it("names both recognised shapes in its failure message", () => {
    // Criterion the message has to meet: an author must be able to fix a
    // failure without reading the patterns.
    const help = boundaryHelp("some/skill/SKILL.md");
    expect(help).toContain("negated action");
    expect(help).toContain("stated absence");
    expect(help).toContain("BOUNDARY_PHRASINGS");
  });
});
