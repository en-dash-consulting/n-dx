/**
 * Structural tests: run-recording discipline in canonical skill bodies.
 *
 * A skill that ends with `ndx hench record` must also tell the assistant to
 * capture a start time and pass it as `--startedAt`. Without it the FIRST
 * record in a session has no watermark to work back from, so `readUsageDelta`
 * opens its window at the top of the transcript and the record claims every
 * token the session spent before the skill was ever invoked. Measured while
 * building this: a first record in a long session claimed 549 messages and
 * 127M cache-read tokens, four earlier tasks' spend included.
 *
 * The skill list is derived from the manifest rather than hardcoded, so a
 * NEW skill that records runs is covered the moment it is added — this is the
 * guard, not a snapshot of today's skills.
 *
 * @see packages/hench/src/store/session-usage.ts — readUsageDelta, `since`
 * @see packages/hench/src/cli/commands/record.ts — flags.since || flags.startedAt
 */

import { describe, it, expect } from "vitest";
import { getSkillNames, getSkillBody } from "../../packages/core/assistant-assets.js";

/** Skills whose body invokes `ndx hench record`. */
const RECORDING_SKILLS = getSkillNames().filter((name) =>
  getSkillBody(name).includes("hench record"),
);

// ── The --startedAt window ───────────────────────────────────────────────────

describe("skills that record runs pass --startedAt", () => {
  it("at least one skill records runs (guards against a vacuous suite)", () => {
    expect(RECORDING_SKILLS.length).toBeGreaterThan(0);
  });

  for (const name of RECORDING_SKILLS) {
    it(`${name}: passes --startedAt to hench record`, () => {
      expect(
        getSkillBody(name),
        `${name} invokes 'ndx hench record' without --startedAt. The first record ` +
          `in a session would claim every token spent before the skill ran. Add a ` +
          `step that captures the current time in ISO-8601, and pass it as ` +
          `--startedAt=<that time>.`,
      ).toContain("--startedAt");
    });

    it(`${name}: tells the assistant to capture a timestamp`, () => {
      expect(
        getSkillBody(name),
        `${name} passes --startedAt but never says where the value comes from. ` +
          `Instruct capturing the current time in ISO-8601 before the work begins.`,
      ).toMatch(/ISO-8601/);
    });
  }
});

// Platform neutrality of the timestamp instruction is asserted in
// tests/e2e/skill-portability.test.js, alongside the other "does this skill
// assume one environment?" guards. This file covers recording discipline only.

// ── The timestamp example must work on BSD date too ──────────────────────────

describe("the POSIX timestamp example is not GNU-only", () => {
  for (const name of RECORDING_SKILLS) {
    it(`${name}: prescribes 'date -Iseconds', never bare 'date -Is'`, () => {
      // BSD date (macOS — this project's primary development platform)
      // rejects the short form: `date -Is` exits 1 with "invalid argument
      // 's' for -I". `date -Iseconds` is valid on BOTH GNU and BSD date.
      // The lookahead matters: 'date -Iseconds' contains 'date -Is' as a
      // substring, so a plain contains-check would reject the fix itself.
      expect(
        getSkillBody(name),
        `${name} prescribes bare 'date -Is', which BSD date rejects — ` +
          `use 'date -Iseconds' (valid on GNU and BSD).`,
      ).not.toMatch(/date -Is(?!econds)/);
    });
  }
});
