/**
 * `--review` takes commit ownership back from the executor.
 *
 * The adversarial review pass promises that must-fix repairs land in the same
 * commit as the work they repair (see the `adversarial-review` module docs).
 * That is only possible if the working tree is still uncommitted when the
 * reviewer runs. With `hench.autoCommit: true` the executor is *instructed* to
 * commit inside its own turn, so the review pass — which runs after the spawn
 * returns — could never see uncommitted work, and the guarantee was unreachable
 * by construction rather than by any race.
 *
 * Observed on hench run 60c3a951: work committed at 09:26:19, review report
 * written at 09:34:59.
 *
 * The fix makes `autoCommit` and `--review` mutually exclusive for a run, with
 * review winning: the executor stages and proposes a message, and hench commits
 * after the review pass.
 */

import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  resolveEffectiveAutoCommit,
} from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import type { HenchConfig, TaskBriefProject } from "../../../src/schema/index.js";

const PROJECT: TaskBriefProject = { name: "demo", cliName: "ndx" };

function configWith(autoCommit: boolean): HenchConfig {
  return { ...DEFAULT_HENCH_CONFIG(), provider: "cli", autoCommit } as HenchConfig;
}

/** The instruction the executor gets when it owns the commit. */
const AGENT_COMMITS = "Commit changes with git";
/** The instruction the executor gets when hench owns the commit. */
const AGENT_DEFERS = "do NOT run `git commit`";

describe("resolveEffectiveAutoCommit", () => {
  it("leaves autoCommit on when review is off", () => {
    expect(resolveEffectiveAutoCommit(configWith(true), false)).toBe(true);
  });

  it("forces autoCommit off when review is on", () => {
    expect(resolveEffectiveAutoCommit(configWith(true), true)).toBe(false);
  });

  it("keeps autoCommit off when it was already off and review is on", () => {
    expect(resolveEffectiveAutoCommit(configWith(false), true)).toBe(false);
  });

  it("keeps autoCommit off when it was already off and review is off", () => {
    expect(resolveEffectiveAutoCommit(configWith(false), false)).toBe(false);
  });

  it("treats a missing autoCommit as off", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" } as HenchConfig;
    delete (config as { autoCommit?: boolean }).autoCommit;
    expect(resolveEffectiveAutoCommit(config, false)).toBe(false);
    expect(resolveEffectiveAutoCommit(config, true)).toBe(false);
  });
});

describe("system prompt commit instruction under --review", () => {
  it("tells the agent to defer the commit when review is enabled", () => {
    const effective = resolveEffectiveAutoCommit(configWith(true), true);
    const prompt = buildSystemPrompt(PROJECT, { ...configWith(true), autoCommit: effective });

    expect(prompt).toContain(AGENT_DEFERS);
    expect(prompt).not.toContain(AGENT_COMMITS);
  });

  it("still tells the agent to commit when review is disabled (regression guard)", () => {
    const effective = resolveEffectiveAutoCommit(configWith(true), false);
    const prompt = buildSystemPrompt(PROJECT, { ...configWith(true), autoCommit: effective });

    expect(prompt).toContain(AGENT_COMMITS);
    expect(prompt).not.toContain(AGENT_DEFERS);
  });

  it("is unchanged by review when autoCommit was already off", () => {
    const withReview = buildSystemPrompt(PROJECT, {
      ...configWith(false),
      autoCommit: resolveEffectiveAutoCommit(configWith(false), true),
    });
    const withoutReview = buildSystemPrompt(PROJECT, {
      ...configWith(false),
      autoCommit: resolveEffectiveAutoCommit(configWith(false), false),
    });

    expect(withReview).toBe(withoutReview);
    expect(withReview).toContain(AGENT_DEFERS);
  });
});
