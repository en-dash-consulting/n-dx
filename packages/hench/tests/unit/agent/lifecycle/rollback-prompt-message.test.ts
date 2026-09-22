import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Unit coverage for {@link promptRollbackConfirm}'s message and default —
 * narrower than tests/integration/rollback-prompt.test.ts, which drives the
 * same prompt end-to-end through finalizeRun against a real git fixture.
 *
 * Regression: the prompt used to ask "Revert N uncommitted file(s)? [y/N]"
 * without naming the files or saying what they were, and defaulted to No —
 * so a bare Enter left hench's own dirty status writes in place, the actual
 * damage. It now names the paths, says what they are, and defaults to Yes.
 */

interface FakeReadlineHandle {
  answer: (text: string) => void;
  question: string;
}

function installFakeReadline(): { fakes: FakeReadlineHandle[] } {
  const fakes: FakeReadlineHandle[] = [];
  vi.doMock("node:readline", () => ({
    createInterface: () => {
      let answerCb: ((answer: string) => void) | undefined;
      return {
        question: (q: string, cb: (answer: string) => void) => {
          answerCb = cb;
          fakes.push({ answer: (text: string) => answerCb?.(text), question: q });
        },
        close: () => {},
        on: () => {},
        removeListener: () => {},
      };
    },
  }));
  return { fakes };
}

/** `readLineWithSuspendedSigint` opens the interface via a dynamic import, so
 * the fake is installed a tick after the call — poll for it. */
async function waitForFakePrompt(fakes: FakeReadlineHandle[]): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (fakes.length === 0 && Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

function detachExistingSigintListeners(): Array<(...a: unknown[]) => void> {
  const saved = process.listeners("SIGINT") as Array<(...a: unknown[]) => void>;
  for (const l of saved) process.removeListener("SIGINT", l);
  return saved;
}

function restoreSigintListeners(saved: Array<(...a: unknown[]) => void>): void {
  for (const l of process.listeners("SIGINT") as Array<(...a: unknown[]) => void>) {
    process.removeListener("SIGINT", l);
  }
  for (const l of saved) process.on("SIGINT", l);
}

describe("promptRollbackConfirm", () => {
  afterEach(() => {
    vi.doUnmock("node:readline");
    vi.resetModules();
  });

  it("names the dirty paths and says they are hench's own writes, restoring the pre-run PRD state", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackConfirm } = await import("../../../../src/agent/lifecycle/shared.js");
      const pending = promptRollbackConfirm([
        ".rex/prd_tree/epic/task/index.md",
        ".rex/tree-meta.json",
      ]);

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);
      const question = fakes[0].question;

      expect(question).toContain("2 uncommitted file(s)");
      expect(question).toContain("hench's status writes from this run");
      expect(question).toContain(".rex/prd_tree/epic/task/index.md");
      expect(question).toContain(".rex/tree-meta.json");
      expect(question).toContain("restore the pre-run PRD state");
      expect(question).toContain("[Y/n]");

      fakes[0].answer("n");
      await pending;
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("defaults to Yes — a bare Enter resolves to revert", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackConfirm } = await import("../../../../src/agent/lifecycle/shared.js");
      const pending = promptRollbackConfirm(["src.ts"]);

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);
      fakes[0].answer("");

      await expect(pending).resolves.toBe(true);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });

  it("an explicit 'n' declines the revert", async () => {
    const { fakes } = installFakeReadline();
    vi.resetModules();

    const priorListeners = detachExistingSigintListeners();
    try {
      const { promptRollbackConfirm } = await import("../../../../src/agent/lifecycle/shared.js");
      const pending = promptRollbackConfirm(["src.ts"]);

      await waitForFakePrompt(fakes);
      expect(fakes).toHaveLength(1);
      fakes[0].answer("n");

      await expect(pending).resolves.toBe(false);
    } finally {
      restoreSigintListeners(priorListeners);
    }
  });
});
