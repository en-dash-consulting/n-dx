/**
 * Structural tests: run-recording discipline in canonical skill bodies.
 *
 * A skill that ends with `ndx hench record` must start by marking where its
 * token usage begins — `ndx hench usage mark --task=<id>` — and must not ask
 * the assistant to type a timestamp for `--startedAt`. The mark is a snapshot
 * of the session transcript written by code; the record computes the run's
 * spend as the difference between that snapshot and the transcript at record
 * time. A typed time was the previous mechanism: it filtered messages by a
 * value the model produced, and one slip in it silently moved the boundary.
 * Measured before the change: nine consecutive skill runs in one session
 * recorded 1.7M–18.2M tokens each, most of it the same context re-read.
 *
 * The skill list is derived from the manifest rather than hardcoded, so a
 * NEW skill that records runs is covered the moment it is added — this is the
 * guard, not a snapshot of today's skills.
 *
 * @see packages/hench/src/store/session-usage.ts — takeUsageMark, readUsageSinceMark
 * @see packages/hench/src/cli/commands/record.ts — the mark is consumed here
 * @see packages/hench/src/cli/commands/usage.ts — `hench usage mark`
 */

import { describe, it, expect } from "vitest";
import { getSkillNames, getSkillBody } from "../../packages/core/assistant-assets.js";

/** Skills whose body invokes `ndx hench record`. */
const RECORDING_SKILLS = getSkillNames().filter((name) =>
  getSkillBody(name).includes("hench record"),
);

describe("skills that record runs mark their usage start in code", () => {
  it("at least one skill records runs (guards against a vacuous suite)", () => {
    expect(RECORDING_SKILLS.length).toBeGreaterThan(0);
  });

  for (const name of RECORDING_SKILLS) {
    const body = getSkillBody(name);

    it(`${name}: runs 'hench usage mark' before it records`, () => {
      const markAt = body.indexOf("hench usage mark");
      const recordAt = body.indexOf("hench record");
      expect(
        markAt,
        `${name} invokes 'ndx hench record' without first running 'ndx hench usage mark --task=<id>'. ` +
          `Without a mark the record falls back to the session's previous watermark and may claim unrelated work.`,
      ).toBeGreaterThanOrEqual(0);
      expect(markAt, `${name}: the mark must come before the record`).toBeLessThan(recordAt);
    });

    it(`${name}: does not ask the assistant to type a start time`, () => {
      expect(
        body,
        `${name} still passes a typed time as --startedAt. Usage is measured from the mark; ` +
          `a model-typed timestamp is not a measurement.`,
      ).not.toMatch(/--startedAt=</);
      expect(
        body,
        `${name} still instructs the assistant to note or record the current time. ` +
          `Replace that step with 'ndx hench usage mark --task=<id>'.`,
      ).not.toMatch(/\b(note|record|capture) the current time\b/i);
    });

    it(`${name}: does not ask the assistant to do token arithmetic`, () => {
      // The subtraction lives in session-usage.ts. A skill that tells the
      // model to compute or compare token counts reintroduces the guesswork.
      expect(body).not.toMatch(/\b(subtract|compute|calculate)\b[^.\n]*\btokens?\b/i);
    });
  }
});
