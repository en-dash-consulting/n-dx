/**
 * promptTestGateFailure must reach its question on an interactive run.
 *
 * It once built its readline interface with a bare `require()`, which does not
 * exist in an ESM module: the executor threw, the catch returned "abort", and
 * the operator was never asked. Vitest supplies `require`, so the bug only
 * showed in the built CLI — hence the injected factory and the module mock
 * below, neither of which depends on `require`.
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";

const readlineMock = vi.hoisted(() => ({ createInterface: vi.fn() }));
vi.mock("node:readline", () => readlineMock);

import { promptTestGateFailure } from "../../../../src/agent/lifecycle/shared.js";
import type { TestGateResult } from "../../../../src/schema/index.js";

const FAILED_GATE: TestGateResult = {
  ran: true,
  passed: false,
  packages: [{ name: "rex", passed: false, durationMs: 1 }] as TestGateResult["packages"],
  command: "pnpm test",
};

/** A readline stand-in that answers the first question with `answer`. */
function fakeInterface(answer: string) {
  const questions: string[] = [];
  const rl = Object.assign(new EventEmitter(), {
    question: (q: string, cb: (a: string) => void) => {
      questions.push(q);
      cb(answer);
    },
    close: vi.fn(),
  });
  const factory = vi.fn(() => rl);
  return { factory: factory as never, questions, rl };
}

describe("promptTestGateFailure", () => {
  it("asks the rerun/abort/skip question on a TTY and maps r to rerun", async () => {
    const { factory, questions, rl } = fakeInterface("r");
    const action = await promptTestGateFailure(FAILED_GATE, false, false, {
      createInterface: factory,
      isTty: true,
    });
    expect(action).toBe("rerun");
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("[r]erun tests, [a]bort");
    expect(rl.close).toHaveBeenCalled();
  });

  it.each([
    ["s", "skip"],
    ["S ", "skip"],
    ["a", "abort"],
    ["", "abort"],
    ["whatever", "abort"],
  ])("maps answer %j to %s", async (answer, expected) => {
    const { factory } = fakeInterface(answer);
    expect(
      await promptTestGateFailure(FAILED_GATE, false, false, { createInterface: factory, isTty: true }),
    ).toBe(expected);
  });

  it("aborts on Ctrl-C without an answer", async () => {
    const rl = Object.assign(new EventEmitter(), {
      question: () => {
        rl.emit("SIGINT");
      },
      close: vi.fn(),
    });
    const action = await promptTestGateFailure(FAILED_GATE, false, false, {
      createInterface: (() => rl) as never,
      isTty: true,
    });
    expect(action).toBe("abort");
    expect(rl.close).toHaveBeenCalled();
  });

  it("restores the outer SIGINT listeners after the prompt", async () => {
    const outer = vi.fn();
    process.on("SIGINT", outer);
    try {
      const { factory } = fakeInterface("a");
      await promptTestGateFailure(FAILED_GATE, false, false, { createInterface: factory, isTty: true });
      expect(process.listeners("SIGINT")).toContain(outer);
    } finally {
      process.removeListener("SIGINT", outer);
    }
  });

  it("never prompts when unattended (no TTY, --yes or autonomous)", async () => {
    const { factory } = fakeInterface("r");
    for (const [yes, auto, isTty] of [[false, false, false], [true, false, true], [false, true, true]] as const) {
      expect(
        await promptTestGateFailure(FAILED_GATE, yes, auto, { createInterface: factory, isTty }),
      ).toBe("abort");
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("uses the module's imported createInterface by default", async () => {
    const { factory, questions } = fakeInterface("s");
    readlineMock.createInterface.mockImplementation(factory);
    const action = await promptTestGateFailure(FAILED_GATE, false, false, { isTty: true });
    expect(readlineMock.createInterface).toHaveBeenCalledTimes(1);
    expect(questions).toHaveLength(1);
    expect(action).toBe("skip");
  });
});
