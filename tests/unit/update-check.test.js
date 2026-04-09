import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  isNewerVersion,
  loadUpdateCache,
  saveUpdateCache,
  checkForUpdate,
  fetchLatestVersion,
  formatUpdateNotice,
  shouldSuppressNotice,
  CACHE_TTL_MS,
} from "../../packages/core/update-check.js";

// ── isNewerVersion ──────────────────────────────────────────────────────────

describe("isNewerVersion", () => {
  it("detects major version bump", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
  });

  it("detects minor version bump", () => {
    expect(isNewerVersion("1.1.0", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(false);
  });

  it("detects patch version bump", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
  });

  it("returns false for identical versions", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.2.2", "0.2.2")).toBe(false);
  });

  it("handles v-prefix", () => {
    expect(isNewerVersion("v2.0.0", "v1.0.0")).toBe(true);
    expect(isNewerVersion("v1.0.0", "2.0.0")).toBe(false);
  });

  it("handles missing patch component", () => {
    expect(isNewerVersion("1.1", "1.0")).toBe(true);
  });

  it("major takes precedence over minor", () => {
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
  });

  it("minor takes precedence over patch", () => {
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(true);
  });
});

// ── loadUpdateCache / saveUpdateCache ───────────────────────────────────────

describe("cache I/O", () => {
  let tmpDir;
  let cachePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-update-check-test-"));
    cachePath = join(tmpDir, "update-check.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when cache file does not exist", () => {
    expect(loadUpdateCache(cachePath)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    writeFileSync(cachePath, "not json", "utf-8");
    expect(loadUpdateCache(cachePath)).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    writeFileSync(cachePath, JSON.stringify({ foo: "bar" }), "utf-8");
    expect(loadUpdateCache(cachePath)).toBeNull();
  });

  it("returns null when lastChecked is not a number", () => {
    writeFileSync(cachePath, JSON.stringify({ lastChecked: "yesterday", latestVersion: "1.0.0" }), "utf-8");
    expect(loadUpdateCache(cachePath)).toBeNull();
  });

  it("returns null when latestVersion is not a string", () => {
    writeFileSync(cachePath, JSON.stringify({ lastChecked: 123, latestVersion: 456 }), "utf-8");
    expect(loadUpdateCache(cachePath)).toBeNull();
  });

  it("round-trips valid data", () => {
    saveUpdateCache("1.2.3", cachePath);
    const loaded = loadUpdateCache(cachePath);
    expect(loaded).not.toBeNull();
    expect(loaded.latestVersion).toBe("1.2.3");
    expect(typeof loaded.lastChecked).toBe("number");
    expect(loaded.lastChecked).toBeGreaterThan(0);
  });

  it("saveUpdateCache writes valid JSON with trailing newline", () => {
    saveUpdateCache("2.0.0", cachePath);
    const raw = readFileSync(cachePath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(raw);
    expect(parsed.latestVersion).toBe("2.0.0");
  });

  it("saveUpdateCache silently ignores write to non-existent directory", () => {
    const badPath = join(tmpDir, "does-not-exist", "cache.json");
    // Should not throw
    saveUpdateCache("1.0.0", badPath);
    expect(existsSync(badPath)).toBe(false);
  });
});

// ── fetchLatestVersion ──────────────────────────────────────────────────────

describe("fetchLatestVersion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns version string on successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "3.0.0" }),
    }));
    const result = await fetchLatestVersion("https://example.com");
    expect(result).toBe("3.0.0");
  });

  it("returns null on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));
    const result = await fetchLatestVersion("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when response has no version field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: "@n-dx/core" }),
    }));
    const result = await fetchLatestVersion("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when version is not a string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 123 }),
    }));
    const result = await fetchLatestVersion("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await fetchLatestVersion("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null on abort (timeout simulation)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    const result = await fetchLatestVersion("https://example.com");
    expect(result).toBeNull();
  });

  it("passes Accept header and signal to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    await fetchLatestVersion("https://registry.example.com/@n-dx/core/latest");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://registry.example.com/@n-dx/core/latest",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

// ── checkForUpdate ──────────────────────────────────────────────────────────

describe("checkForUpdate", () => {
  let tmpDir;
  let cachePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-update-check-test-"));
    cachePath = join(tmpDir, "update-check.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns update descriptor when registry has newer version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "9.0.0" }),
    }));
    const result = await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });
    expect(result).toEqual({
      updateAvailable: true,
      latestVersion: "9.0.0",
      currentVersion: "1.0.0",
    });
  });

  it("returns null when current version matches latest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.0.0" }),
    }));
    const result = await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });
    expect(result).toBeNull();
  });

  it("returns null when current version is newer than latest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "0.9.0" }),
    }));
    const result = await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });
    expect(result).toBeNull();
  });

  it("uses fresh cache instead of fetching", async () => {
    // Write a fresh cache entry
    const cacheData = { lastChecked: Date.now(), latestVersion: "5.0.0" };
    writeFileSync(cachePath, JSON.stringify(cacheData), "utf-8");

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });

    expect(result).toEqual({
      updateAvailable: true,
      latestVersion: "5.0.0",
      currentVersion: "1.0.0",
    });
    // fetch should NOT have been called — cache is fresh
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null from fresh cache when no update available", async () => {
    const cacheData = { lastChecked: Date.now(), latestVersion: "1.0.0" };
    writeFileSync(cachePath, JSON.stringify(cacheData), "utf-8");

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate("1.0.0", { cachePath });
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches from registry when cache is stale (>24h)", async () => {
    // Write a stale cache entry (25 hours old)
    const staleTime = Date.now() - CACHE_TTL_MS - 3600_000;
    const cacheData = { lastChecked: staleTime, latestVersion: "1.0.0" };
    writeFileSync(cachePath, JSON.stringify(cacheData), "utf-8");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "2.0.0" }),
    }));

    const result = await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });

    expect(result).toEqual({
      updateAvailable: true,
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
    });
  });

  it("updates cache after successful fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "3.0.0" }),
    }));

    await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });

    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(cache.latestVersion).toBe("3.0.0");
    expect(cache.lastChecked).toBeGreaterThan(0);
  });

  it("returns null when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });
    expect(result).toBeNull();
  });

  it("does not write cache when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await checkForUpdate("1.0.0", {
      cachePath,
      registryUrl: "https://example.com",
    });
    expect(existsSync(cachePath)).toBe(false);
  });
});

// ── formatUpdateNotice ──────────────────────────────────────────────────────

describe("formatUpdateNotice", () => {
  it("includes current and latest versions", () => {
    const msg = formatUpdateNotice("2.0.0", "1.0.0");
    expect(msg).toContain("1.0.0");
    expect(msg).toContain("2.0.0");
  });

  it("includes arrow between versions", () => {
    const msg = formatUpdateNotice("2.0.0", "1.0.0");
    expect(msg).toContain("\u2192");
  });

  it("includes install command", () => {
    const msg = formatUpdateNotice("2.0.0", "1.0.0");
    expect(msg).toContain("npm install -g @n-dx/core");
  });

  it("returns a single line (no newlines)", () => {
    const msg = formatUpdateNotice("2.0.0", "1.0.0");
    expect(msg).not.toContain("\n");
  });
});

// ── shouldSuppressNotice ────────────────────────────────────────────────────

describe("shouldSuppressNotice", () => {
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    // Default: pretend we're in a TTY
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true, configurable: true });
  });

  it("suppresses on non-zero exit code", () => {
    expect(shouldSuppressNotice(["status"], 1)).toBe(true);
  });

  it("does not suppress on exit code 0 with no flags", () => {
    expect(shouldSuppressNotice(["status"], 0)).toBe(false);
  });

  it("suppresses on --quiet", () => {
    expect(shouldSuppressNotice(["status", "--quiet"], 0)).toBe(true);
  });

  it("suppresses on -q", () => {
    expect(shouldSuppressNotice(["status", "-q"], 0)).toBe(true);
  });

  it("suppresses on --json", () => {
    expect(shouldSuppressNotice(["version", "--json"], 0)).toBe(true);
  });

  it("suppresses on --format=json", () => {
    expect(shouldSuppressNotice(["status", "--format=json"], 0)).toBe(true);
  });

  it("suppresses when stdout is not a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true, configurable: true });
    expect(shouldSuppressNotice(["status"], 0)).toBe(true);
  });

  it("does not suppress normal commands in TTY mode", () => {
    expect(shouldSuppressNotice(["analyze", "."], 0)).toBe(false);
    expect(shouldSuppressNotice(["plan", "--accept", "."], 0)).toBe(false);
  });
});
