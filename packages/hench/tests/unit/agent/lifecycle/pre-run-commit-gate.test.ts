import { describe, it, expect, vi } from "vitest";
import {
  performPreRunCommitGateIfNeeded,
  resolvePreRunCommitAnswer,
  type PreRunCommitChoice,
  type PreRunCommitGateOptions,
} from "../../../../src/agent/lifecycle/shared.js";
import type { ReviewDiff } from "../../../../src/agent/analysis/review.js";
import type { ChangeMagnitude } from "../../../../src/agent/analysis/change-magnitude.js";

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
      magnitude?: ChangeMagnitude;
    } = {},
) {
  const listDirty = vi.fn(async () => overrides.dirty ?? [" M file.ts"]);
  const measureMagnitude = vi.fn(
    async () => overrides.magnitude ?? { files: 1, linesChanged: 2 },
  );
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
    checkpointThreshold: overrides.checkpointThreshold,
    requireCleanTree: overrides.requireCleanTree,
    deps: {
      listDirty: overrides.listDirty ?? listDirty,
      measureMagnitude: overrides.measureMagnitude ?? measureMagnitude,
      collectDiff: overrides.collectDiff ?? collectDiff,
      proposeMessage: overrides.proposeMessage ?? proposeMessage,
      promptChoice: overrides.promptChoice ?? promptChoice,
      commit: overrides.commit ?? commit,
      isTTY: overrides.isTTY ?? true,
    },
  };

  return { opts, listDirty, measureMagnitude, collectDiff, proposeMessage, promptChoice, commit };
}

describe("performPreRunCommitGateIfNeeded", () => {
  it("proceeds without inspecting git on a dry run", async () => {
    const { opts, listDirty } = makeOpts({ dryRun: true });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(listDirty).not.toHaveBeenCalled();
  });

  it("proceeds with no prompt when the tree is clean", async () => {
    const { opts, promptChoice, collectDiff, measureMagnitude } = makeOpts({ dirty: [] });
    expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    expect(measureMagnitude).not.toHaveBeenCalled();
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

  describe("checkpoint threshold escalation", () => {
    it("does not escalate below the threshold (quiet path unchanged)", async () => {
      const { opts, promptChoice } = makeOpts({
        magnitude: { files: 1, linesChanged: 199 },
        checkpointThreshold: 200,
      });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: false, allowProceed: true });
    });

    it("escalates at the threshold", async () => {
      const { opts, promptChoice } = makeOpts({
        magnitude: { files: 3, linesChanged: 200 },
        checkpointThreshold: 200,
      });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: true, allowProceed: true });
    });

    it("uses the default threshold (200) when none is configured", async () => {
      const { opts, promptChoice } = makeOpts({
        magnitude: { files: 3, linesChanged: 500 },
      });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: true, allowProceed: true });
    });

    it("threshold 0 disables escalation entirely", async () => {
      const { opts, promptChoice } = makeOpts({
        magnitude: { files: 50, linesChanged: 10_000 },
        checkpointThreshold: 0,
      });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: false, allowProceed: true });
    });

    it("--allow-dirty suppresses escalation (flag overrides config)", async () => {
      const { opts, promptChoice } = makeOpts({
        magnitude: { files: 50, linesChanged: 10_000 },
        checkpointThreshold: 200,
        allowDirty: true,
      });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: false, allowProceed: true });
    });
  });

  describe("requireCleanTree", () => {
    it("drops the 'proceed' option in interactive mode", async () => {
      const { opts, promptChoice } = makeOpts({
        requireCleanTree: true,
        choice: "commit",
      });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: false, allowProceed: false });
    });

    it("stops a dirty --yes run", async () => {
      const { opts, promptChoice } = makeOpts({ requireCleanTree: true, yes: true });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("stop");
      expect(promptChoice).not.toHaveBeenCalled();
    });

    it("stops a dirty non-TTY run", async () => {
      const { opts, promptChoice } = makeOpts({ requireCleanTree: true, isTTY: false });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("stop");
      expect(promptChoice).not.toHaveBeenCalled();
    });

    it("--allow-dirty overrides requireCleanTree for a --yes run (flag > config)", async () => {
      const { opts } = makeOpts({ requireCleanTree: true, yes: true, allowDirty: true });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
    });

    it("--allow-dirty restores the 'proceed' option interactively (flag > config)", async () => {
      const { opts, promptChoice } = makeOpts({ requireCleanTree: true, allowDirty: true });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).toHaveBeenCalledWith({ escalate: false, allowProceed: true });
    });

    it("does not affect clean trees", async () => {
      const { opts, promptChoice } = makeOpts({ requireCleanTree: true, dirty: [], yes: true });
      expect(await performPreRunCommitGateIfNeeded(opts)).toBe("proceed");
      expect(promptChoice).not.toHaveBeenCalled();
    });
  });
});

describe("resolvePreRunCommitAnswer", () => {
  const normal = { escalate: false, allowProceed: true };
  const escalated = { escalate: true, allowProceed: true };
  const cleanOnly = { escalate: false, allowProceed: false };

  it("defaults to proceed on bare Enter normally", () => {
    expect(resolvePreRunCommitAnswer("", normal)).toBe("proceed");
  });

  it("defaults to commit on bare Enter when escalated", () => {
    expect(resolvePreRunCommitAnswer("", escalated)).toBe("commit");
  });

  it("defaults to commit on bare Enter when proceed is disallowed", () => {
    expect(resolvePreRunCommitAnswer("", cleanOnly)).toBe("commit");
  });

  it("still allows an explicit proceed when escalated", () => {
    expect(resolvePreRunCommitAnswer("p", escalated)).toBe("proceed");
  });

  it("does not allow proceed when disallowed", () => {
    expect(resolvePreRunCommitAnswer("p", cleanOnly)).toBe("commit");
    expect(resolvePreRunCommitAnswer("proceed", cleanOnly)).toBe("commit");
  });

  it("maps commit/stop answers regardless of mode", () => {
    for (const mode of [normal, escalated, cleanOnly]) {
      expect(resolvePreRunCommitAnswer("c", mode)).toBe("commit");
      expect(resolvePreRunCommitAnswer("stop", mode)).toBe("stop");
    }
  });

  it("treats Ctrl-C (null) as stop in every mode", () => {
    for (const mode of [normal, escalated, cleanOnly]) {
      expect(resolvePreRunCommitAnswer(null, mode)).toBe("stop");
    }
  });
});
