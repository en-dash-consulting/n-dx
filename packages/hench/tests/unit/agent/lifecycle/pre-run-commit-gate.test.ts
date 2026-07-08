import { describe, it, expect, vi } from "vitest";
import {
  performPreRunCommitGateIfNeeded,
  type PreRunCommitChoice,
  type PreRunCommitGateOptions,
} from "../../../../src/agent/lifecycle/shared.js";
import type { ReviewDiff } from "../../../../src/agent/analysis/review.js";

const DIFF: ReviewDiff = { diff: "diff --git a b", stat: " 1 file changed, 2 insertions(+)" };

/**
 * Build gate options with fully injected, spy-able dependencies so the gate
 * can be exercised without touching real git, the LLM, or a live TTY.
 */
function makeOpts(
  overrides: Partial<PreRunCommitGateOptions> &
    Partial<NonNullable<PreRunCommitGateOptions["deps"]>> & {
      dirty?: string[];
      choice?: PreRunCommitChoice;
      isTTY?: boolean;
    } = {},
) {
  const listDirty = vi.fn(async () => overrides.dirty ?? [" M file.ts"]);
  const collectDiff = vi.fn(async () => DIFF);
  const proposeMessage = vi.fn(async () => "chore: tidy up");
  const promptChoice = vi.fn(async () => overrides.choice ?? "proceed");
  const commit = vi.fn(async () => {});

  const opts: PreRunCommitGateOptions = {
    projectDir: "/tmp/proj",
    henchDir: "/tmp/proj/.hench",
    model: overrides.model,
    yes: overrides.yes,
    autonomous: overrides.autonomous,
    allowDirty: overrides.allowDirty,
    dryRun: overrides.dryRun,
    deps: {
      listDirty: overrides.listDirty ?? listDirty,
      collectDiff: overrides.collectDiff ?? collectDiff,
      proposeMessage: overrides.proposeMessage ?? proposeMessage,
      promptChoice: overrides.promptChoice ?? promptChoice,
      commit: overrides.commit ?? commit,
      isTTY: overrides.isTTY ?? true,
    },
  };

  return { opts, listDirty, collectDiff, proposeMessage, promptChoice, commit };
}

describe("performPreRunCommitGateIfNeeded", () => {
  it("proceeds without inspecting git on a dry run", async () => {
    const { opts, listDirty } = makeOpts({ dryRun: true });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(listDirty).not.toHaveBeenCalled();
  });

  it("proceeds with no prompt when the tree is clean", async () => {
    const { opts, promptChoice, collectDiff } = makeOpts({ dirty: [] });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(collectDiff).not.toHaveBeenCalled();
    expect(promptChoice).not.toHaveBeenCalled();
  });

  it("proceeds without prompting when not a TTY", async () => {
    const { opts, promptChoice, commit } = makeOpts({ isTTY: false });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(promptChoice).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("aborts a dirty autonomous run without prompting", async () => {
    const { opts, promptChoice, commit } = makeOpts({ autonomous: true });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("stop");
    expect(promptChoice).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("proceeds without prompting for a clean autonomous run", async () => {
    const { opts, promptChoice } = makeOpts({ autonomous: true, dirty: [] });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(promptChoice).not.toHaveBeenCalled();
  });

  it("proceeds without prompting for a dirty autonomous run when --allow-dirty is set", async () => {
    const { opts, promptChoice } = makeOpts({ autonomous: true, allowDirty: true });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(promptChoice).not.toHaveBeenCalled();
  });

  it("proceeds without prompting when --yes is set", async () => {
    const { opts, promptChoice } = makeOpts({ yes: true });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(promptChoice).not.toHaveBeenCalled();
  });

  it("commits the proposed message and proceeds on 'commit'", async () => {
    const { opts, commit } = makeOpts({ choice: "commit" });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(commit).toHaveBeenCalledWith("/tmp/proj", "chore: tidy up");
  });

  it("returns 'stop' and never commits on 'stop'", async () => {
    const { opts, commit } = makeOpts({ choice: "stop" });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("stop");
    expect(commit).not.toHaveBeenCalled();
  });

  it("proceeds without committing on 'proceed'", async () => {
    const { opts, commit } = makeOpts({ choice: "proceed" });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(commit).not.toHaveBeenCalled();
  });

  it("proceeds gracefully when the commit fails", async () => {
    const commit = vi.fn(async () => {
      throw new Error("nothing to commit");
    });
    const { opts } = makeOpts({ choice: "commit", commit });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(commit).toHaveBeenCalledOnce();
  });
});
