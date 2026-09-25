import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet, isQuiet, info, result, startSpinner } from "../../../src/cli/output.js";
import { getActiveProgressReporter, setActiveProgressReporter, printRetryLine } from "@n-dx/llm-client";

describe("CLI output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    setQuiet(false);
  });

  describe("setQuiet / isQuiet", () => {
    it("defaults to non-quiet", () => {
      expect(isQuiet()).toBe(false);
    });

    it("can enable quiet mode", () => {
      setQuiet(true);
      expect(isQuiet()).toBe(true);
    });
  });

  describe("info()", () => {
    it("prints when not quiet", () => {
      info("hello");
      expect(logSpy).toHaveBeenCalledWith("hello");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      info("hello");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("result()", () => {
    it("always prints", () => {
      setQuiet(true);
      result("essential");
      expect(logSpy).toHaveBeenCalledWith("essential");
    });
  });

  describe("startSpinner() progress-reporter integration", () => {
    let wasTTY: boolean | undefined;
    let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
    let cursorToSpy: ReturnType<typeof vi.spyOn> | undefined;
    let clearLineSpy: ReturnType<typeof vi.spyOn> | undefined;
    let moveCursorSpy: ReturnType<typeof vi.spyOn> | undefined;

    beforeEach(() => {
      wasTTY = process.stderr.isTTY;
      (process.stderr as unknown as { isTTY: boolean }).isTTY = true;
      // ora drives real readline/tty methods when it believes the stream is
      // interactive; stub the ones it calls so it doesn't blow up on a
      // stream that lacks them under the test runner.
      const stderr = process.stderr as unknown as Record<string, unknown>;
      stderr.cursorTo = stderr.cursorTo ?? (() => {});
      stderr.clearLine = stderr.clearLine ?? (() => {});
      stderr.moveCursor = stderr.moveCursor ?? (() => {});
      cursorToSpy = vi.spyOn(process.stderr as unknown as Record<string, () => void>, "cursorTo").mockImplementation(() => true);
      clearLineSpy = vi.spyOn(process.stderr as unknown as Record<string, () => void>, "clearLine").mockImplementation(() => true);
      moveCursorSpy = vi.spyOn(process.stderr as unknown as Record<string, () => void>, "moveCursor").mockImplementation(() => true);
      stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      setActiveProgressReporter(null);
    });

    afterEach(() => {
      (process.stderr as unknown as { isTTY: boolean | undefined }).isTTY = wasTTY;
      stderrWriteSpy.mockRestore();
      cursorToSpy?.mockRestore();
      clearLineSpy?.mockRestore();
      moveCursorSpy?.mockRestore();
      setActiveProgressReporter(null);
    });

    it("registers itself as the active progress reporter while running, and restores the prior one on stop", () => {
      expect(getActiveProgressReporter()).toBeNull();

      const spinner = startSpinner("working...");
      const active = getActiveProgressReporter();
      expect(active).not.toBeNull();

      spinner.stop();
      expect(getActiveProgressReporter()).toBeNull();
    });

    it("nests under an already-active reporter and restores it on stop", () => {
      const outer = { advance: () => 0, render: () => {}, retryLine: () => {} };
      setActiveProgressReporter(outer);

      const spinner = startSpinner("working...");
      expect(getActiveProgressReporter()).not.toBe(outer);

      spinner.stop();
      expect(getActiveProgressReporter()).toBe(outer);
    });

    it("pauses and resumes the spinner around a retry line instead of corrupting the redraw", () => {
      const spinner = startSpinner("Calling LLM (attempt 1/3)...");

      printRetryLine(2, 4, "rate limited, waiting 5s");

      const written = stderrWriteSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).toContain("retry 2/4: rate limited, waiting 5s\n");

      spinner.stop();
    });
  });
});
