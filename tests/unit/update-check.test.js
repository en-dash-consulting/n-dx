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
  detectInstallManager,
  formatUpgradeCommand,
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

    /**
     * Cancellation exists so the CLI can STOP this check, not merely stop
     * waiting for it. flushAndExit races the check against 500 ms; a check that
     * loses and is abandoned leaves its request — and the DNS lookup behind it
     * — outstanding while the process exits, which aborts the process on
     * Windows with the libuv UV_HANDLE_CLOSING assertion. Reproduced at 390
     * aborts in 448 concurrent `ndx config` spawns under load.
     */
    describe("cancellation", () => {
      it("passes the caller's signal through to fetch", async () => {
        const controller = new AbortController();
        await startUpdateCheck({ currentVersion: "1.0.0", signal: controller.signal });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const { signal } = fetchMock.mock.calls[0][1];
        expect(signal).toBeInstanceOf(AbortSignal);
        // Combined with the internal timeout rather than replacing it, so an
        // uncancelled caller still gets the 3s cap.
        expect(signal.aborted).toBe(false);
        controller.abort();
        expect(signal.aborted).toBe(true);
      });

      it("resolves null when the caller aborts mid-flight", async () => {
        const controller = new AbortController();
        const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
        fetchMock.mockImplementation((_url, { signal }) =>
          new Promise((_resolve, reject) => {
            // The already-aborted case is the one that actually happens here:
            // startUpdateCheck awaits loadCache() before fetching, so a caller
            // aborting "mid-flight" has usually done so before fetch is reached.
            // An abort listener attached after the fact never fires.
            if (signal.aborted) {
              reject(abortError());
              return;
            }
            signal.addEventListener("abort", () => reject(abortError()));
          }),
        );

        const pending = startUpdateCheck({ currentVersion: "1.0.0", signal: controller.signal });
        controller.abort();

        // Never rejects — the caller awaits this during teardown and an
        // unhandled rejection there would be worse than a missing notice.
        await expect(pending).resolves.toBeNull();
      });

      it("does not write the cache when the check was cancelled", async () => {
        const controller = new AbortController();
        // Resolve the fetch, but abort before the result is used: the caller is
        // already exiting, and a cache write is one more piece of threadpool
        // work inside the teardown window.
        fetchMock.mockImplementation(async () => {
          controller.abort();
          return { ok: true, json: async () => ({ version: "99.0.0" }) };
        });

        await startUpdateCheck({ currentVersion: "1.0.0", signal: controller.signal });

        expect(writeFile).not.toHaveBeenCalled();
      });

      it("still writes the cache on a normal, uncancelled check", async () => {
        const controller = new AbortController();
        await startUpdateCheck({ currentVersion: "1.0.0", signal: controller.signal });
        expect(writeFile).toHaveBeenCalledTimes(1);
      });
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

    it("suggests the command for the detected package manager", () => {
      const notice = formatUpdateNotice({
        current: "1.0.0",
        latest: "2.0.0",
        manager: "pnpm",
      });
      expect(notice).toContain("pnpm add -g @n-dx/core@latest");
      expect(notice).not.toContain("npm i -g");
    });

    // Regression: a bare `@n-dx/core` re-resolves inside pnpm's recorded caret
    // range, which for 0.x versions cannot cross a minor boundary. Users stayed
    // stranded on 0.3.x while believing they had upgraded.
    it("always pins @latest so a caret range cannot strand the upgrade", () => {
      for (const manager of ["npm", "pnpm", "yarn"]) {
        const notice = formatUpdateNotice({ current: "0.3.1", latest: "0.4.6", manager });
        expect(notice).toContain("@n-dx/core@latest");
      }
    });
  });

  describe("detectInstallManager", () => {
    it("detects a pnpm global install from its virtual store path", () => {
      expect(
        detectInstallManager(
          "C:\\Users\\x\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\@n-dx+core@0.3.1\\node_modules\\@n-dx\\core\\update-check.js",
        ),
      ).toBe("pnpm");
    });

    it("detects pnpm on POSIX paths", () => {
      expect(
        detectInstallManager("/home/x/.local/share/pnpm/global/5/.pnpm/@n-dx+core@0.4.6/node_modules/@n-dx/core/update-check.js"),
      ).toBe("pnpm");
    });

    it("detects a yarn classic global install", () => {
      expect(
        detectInstallManager(
          "C:\\Users\\x\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@n-dx\\core\\update-check.js",
        ),
      ).toBe("yarn");
    });

    it("falls back to npm for an npm prefix install", () => {
      expect(
        detectInstallManager(
          "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@n-dx\\core\\update-check.js",
        ),
      ).toBe("npm");
    });

    it("falls back to npm for a local dev checkout", () => {
      expect(detectInstallManager("/home/x/code/n-dx/packages/core/update-check.js")).toBe("npm");
    });
  });

  describe("formatUpgradeCommand", () => {
    it("maps each manager to its own global-install syntax", () => {
      expect(formatUpgradeCommand("npm")).toBe("npm i -g @n-dx/core@latest");
      expect(formatUpgradeCommand("pnpm")).toBe("pnpm add -g @n-dx/core@latest");
      expect(formatUpgradeCommand("yarn")).toBe("yarn global add @n-dx/core@latest");
    });

    it("treats an unknown manager as npm", () => {
      expect(formatUpgradeCommand("bun")).toBe("npm i -g @n-dx/core@latest");
    });
  });

  describe("CACHE_TTL_MS", () => {
    it("is 24 hours in milliseconds", () => {
      expect(CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
