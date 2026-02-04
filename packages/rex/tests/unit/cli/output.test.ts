import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setQuiet, isQuiet, info, warn, result } from "../../../src/cli/output.js";

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
});
