import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for update-check.js.
 *
 * Uses vi.mock to intercept fs/promises and fetch calls so no real
 * network requests or temp-file writes occur during tests.
 */

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

// Polyfill globalThis.fetch with a controllable mock
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { readFile, writeFile } from "node:fs/promises";
import {
  startUpdateCheck,
  formatUpdateNotice,
  CACHE_TTL_MS,
} from "../../packages/core/update-check.js";

describe("update-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no cached data
    readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    // Default: fetch succeeds
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ version: "99.0.0" }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("startUpdateCheck", () => {
    it("returns null when the registry fetch fails", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toBeNull();
    });

    it("returns null when the registry returns a non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toBeNull();
    });

    it("returns null when current version is already up to date", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toBeNull();
    });

    it("returns null when current version is ahead of latest", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.9.0" }),
      });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toBeNull();
    });

    it("returns update info when a newer version is available", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toEqual({ current: "1.0.0", latest: "2.0.0" });
    });

    it("detects patch-level updates", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.0.1" }),
      });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toEqual({ current: "1.0.0", latest: "1.0.1" });
    });

    it("detects minor-level updates", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "1.1.0" }),
      });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toEqual({ current: "1.0.0", latest: "1.1.0" });
    });

    it("uses cached result when cache is fresh", async () => {
      const cachedData = {
        checkedAt: Date.now() - 1000, // 1 second ago — well within TTL
        latestVersion: "3.0.0",
      };
      readFile.mockResolvedValue(JSON.stringify(cachedData));

      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toEqual({ current: "1.0.0", latest: "3.0.0" });
      // Should not hit the network when cache is valid
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores cache and fetches when cache is expired", async () => {
      const cachedData = {
        checkedAt: Date.now() - CACHE_TTL_MS - 1000, // Expired
        latestVersion: "3.0.0",
      };
      readFile.mockResolvedValue(JSON.stringify(cachedData));
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "4.0.0" }),
      });

      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toEqual({ current: "1.0.0", latest: "4.0.0" });
      expect(fetchMock).toHaveBeenCalled();
    });

    it("ignores malformed cache and fetches fresh", async () => {
      readFile.mockResolvedValue("not-valid-json{{{");
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      });
      const result = await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(result).toEqual({ current: "1.0.0", latest: "2.0.0" });
    });

    it("writes result to cache after a successful fetch", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      });
      await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(writeFile).toHaveBeenCalledOnce();
      const [, writtenContent] = writeFile.mock.calls[0];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.latestVersion).toBe("2.0.0");
      expect(typeof parsed.checkedAt).toBe("number");
    });

    it("does not write to cache when fetch fails", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));
      await startUpdateCheck({ currentVersion: "1.0.0" });
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("returns null when currentVersion is not provided", async () => {
      const result = await startUpdateCheck({ currentVersion: null });
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never rejects — always resolves with null on unexpected errors", async () => {
      fetchMock.mockImplementation(() => {
        throw new TypeError("Unexpected crash");
      });
      await expect(startUpdateCheck({ currentVersion: "1.0.0" })).resolves.toBeNull();
    });
  });

  describe("formatUpdateNotice", () => {
    it("returns a non-empty string when update is available", () => {
      const notice = formatUpdateNotice({ current: "1.0.0", latest: "2.0.0" });
      expect(typeof notice).toBe("string");
      expect(notice.length).toBeGreaterThan(0);
    });

    it("includes both the current and latest version in the output", () => {
      const notice = formatUpdateNotice({ current: "1.0.0", latest: "2.0.0" });
      expect(notice).toContain("1.0.0");
      expect(notice).toContain("2.0.0");
    });

    it("includes the install command in the output", () => {
      const notice = formatUpdateNotice({ current: "1.0.0", latest: "2.0.0" });
      expect(notice).toMatch(/npm|pnpm|install|update/i);
    });
  });

  describe("CACHE_TTL_MS", () => {
    it("is 24 hours in milliseconds", () => {
      expect(CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
