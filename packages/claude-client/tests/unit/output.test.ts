import { describe, it, expect, beforeEach, vi } from "vitest";
import { setQuiet, isQuiet, info, result } from "../../src/output.js";

describe("output", () => {
  beforeEach(() => {
    setQuiet(false);
  });

  describe("setQuiet / isQuiet", () => {
    it("defaults to not quiet", () => {
      expect(isQuiet()).toBe(false);
    });

    it("enables quiet mode", () => {
      setQuiet(true);
      expect(isQuiet()).toBe(true);
    });

    it("disables quiet mode", () => {
      setQuiet(true);
      setQuiet(false);
      expect(isQuiet()).toBe(false);
    });
  });

  describe("info", () => {
    it("prints when not quiet", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      info("hello");
      expect(spy).toHaveBeenCalledWith("hello");
      spy.mockRestore();
    });

    it("suppresses when quiet", () => {
      setQuiet(true);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      info("hello");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("result", () => {
    it("prints when not quiet", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      result("data");
      expect(spy).toHaveBeenCalledWith("data");
      spy.mockRestore();
    });

    it("prints even when quiet", () => {
      setQuiet(true);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      result("data");
      expect(spy).toHaveBeenCalledWith("data");
      spy.mockRestore();
    });
  });
});
