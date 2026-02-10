import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet, isQuiet, info, warn, result, startSpinner } from "../../../src/cli/output.js";

describe("CLI output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
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

    it("can disable quiet mode", () => {
      setQuiet(true);
      setQuiet(false);
      expect(isQuiet()).toBe(false);
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

    it("passes multiple args", () => {
      info("a", "b", "c");
      expect(logSpy).toHaveBeenCalledWith("a", "b", "c");
    });
  });

  describe("warn()", () => {
    it("prints to stderr when not quiet", () => {
      warn("caution");
      expect(errorSpy).toHaveBeenCalledWith("caution");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      warn("caution");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("passes multiple args", () => {
      warn("a", "b");
      expect(errorSpy).toHaveBeenCalledWith("a", "b");
    });

    it("does not write to stdout", () => {
      warn("caution");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("result()", () => {
    it("prints when not quiet", () => {
      result("data");
      expect(logSpy).toHaveBeenCalledWith("data");
    });

    it("still prints when quiet", () => {
      setQuiet(true);
      result("data");
      expect(logSpy).toHaveBeenCalledWith("data");
    });
  });

  describe("startSpinner()", () => {
    it("returns a spinner with update and stop methods", () => {
      const spinner = startSpinner("Loading...");
      expect(spinner).toHaveProperty("update");
      expect(spinner).toHaveProperty("stop");
      expect(typeof spinner.update).toBe("function");
      expect(typeof spinner.stop).toBe("function");
      spinner.stop();
    });

    it("prints initial message via info() when non-TTY", () => {
      // In test environment, stderr is not a TTY, so it falls back to info()
      const spinner = startSpinner("Processing...");
      expect(logSpy).toHaveBeenCalledWith("Processing...");
      spinner.stop();
    });

    it("prints final message on stop when non-TTY", () => {
      const spinner = startSpinner("Working...");
      logSpy.mockClear();
      spinner.stop("Done!");
      expect(logSpy).toHaveBeenCalledWith("Done!");
    });

    it("does not print final message if not provided on stop", () => {
      const spinner = startSpinner("Working...");
      logSpy.mockClear();
      spinner.stop();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("suppresses all output in quiet mode", () => {
      setQuiet(true);
      const spinner = startSpinner("Silent...");
      expect(logSpy).not.toHaveBeenCalled();
      spinner.stop("Also silent");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("stop is idempotent", () => {
      const spinner = startSpinner("Work...");
      logSpy.mockClear();
      spinner.stop("First stop");
      spinner.stop("Second stop");
      // Only the first stop should print
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith("First stop");
    });
  });
});
