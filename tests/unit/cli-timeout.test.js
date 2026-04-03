import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMEOUT_MS,
  resolveCommandTimeout,
  withCommandTimeout,
} from "../../packages/core/cli-timeout.js";

// ── resolveCommandTimeout ────────────────────────────────────────────────────

describe("resolveCommandTimeout", () => {
  it("returns DEFAULT_TIMEOUT_MS for normal commands when no config is present", () => {
    expect(resolveCommandTimeout("analyze", {})).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveCommandTimeout("plan", {})).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveCommandTimeout("work", {})).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveCommandTimeout("init", {})).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("returns 0 for long-running server commands when no config is present", () => {
    expect(resolveCommandTimeout("start", {})).toBe(0);
    expect(resolveCommandTimeout("web", {})).toBe(0);
    expect(resolveCommandTimeout("dev", {})).toBe(0);
  });

  it("returns DEFAULT_TIMEOUT_MS when projectConfig is undefined", () => {
    expect(resolveCommandTimeout("analyze", undefined)).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("uses global cli.timeoutMs when set", () => {
    const cfg = { cli: { timeoutMs: 5000 } };
    expect(resolveCommandTimeout("analyze", cfg)).toBe(5000);
    expect(resolveCommandTimeout("plan", cfg)).toBe(5000);
  });

  it("global cli.timeoutMs of 0 means no timeout for all commands", () => {
    const cfg = { cli: { timeoutMs: 0 } };
    expect(resolveCommandTimeout("analyze", cfg)).toBe(0);
  });

  it("per-command override takes precedence over global cli.timeoutMs", () => {
    const cfg = { cli: { timeoutMs: 5000, timeouts: { analyze: 99000 } } };
    expect(resolveCommandTimeout("analyze", cfg)).toBe(99000);
    // Other commands still use the global setting
    expect(resolveCommandTimeout("plan", cfg)).toBe(5000);
  });

  it("per-command override of 0 means no timeout for that command", () => {
    const cfg = { cli: { timeouts: { analyze: 0 } } };
    expect(resolveCommandTimeout("analyze", cfg)).toBe(0);
  });

  it("per-command override applies to server commands too", () => {
    const cfg = { cli: { timeouts: { start: 7200000 } } };
    expect(resolveCommandTimeout("start", cfg)).toBe(7200000);
  });

  it("ignores negative per-command values and falls back to the default", () => {
    const cfg = { cli: { timeouts: { analyze: -1 } } };
    // Negative is not a valid timeout; falls back to DEFAULT_TIMEOUT_MS
    expect(resolveCommandTimeout("analyze", cfg)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

// ── withCommandTimeout ───────────────────────────────────────────────────────

describe("withCommandTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when fn completes before the timeout", async () => {
    const fn = () => Promise.resolve("done");
    const result = await withCommandTimeout("analyze", 5000, fn);
    expect(result).toBe("done");
  });

  it("rejects with a timeout error when the threshold is exceeded", async () => {
    const fn = () => new Promise(() => {}); // never resolves
    const promise = withCommandTimeout("analyze", 1000, fn);
    // Attach the rejection handler BEFORE advancing timers to avoid
    // the PromiseRejectionHandledWarning that fires when a rejection is
    // created in one microtask checkpoint and handled in another.
    const assertion = expect(promise).rejects.toThrow('Command "analyze" timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("includes the command name in the timeout error message", async () => {
    const fn = () => new Promise(() => {});
    const promise = withCommandTimeout("work", 500, fn);
    const assertion = expect(promise).rejects.toThrow('"work"');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("includes elapsed time in minutes and milliseconds in the error message", async () => {
    const fn = () => new Promise(() => {});
    const promise = withCommandTimeout("analyze", DEFAULT_TIMEOUT_MS, fn);
    // Register rejection handler before advancing timers
    const caught = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    const err = await caught;
    expect(err.message).toContain("30 min");
    expect(err.message).toContain(`${DEFAULT_TIMEOUT_MS}ms`);
  });

  it("attaches a suggestion for increasing the limit to the error", async () => {
    const fn = () => new Promise(() => {});
    const promise = withCommandTimeout("analyze", 1000, fn);
    const caught = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await caught;
    expect(err.suggestion).toContain("cli.timeouts.analyze");
    expect(err.suggestion).toContain("ndx config");
  });

  it("does not reject when fn resolves just before the timeout fires", async () => {
    let resolveInner;
    const fn = () => new Promise((r) => { resolveInner = r; });
    const promise = withCommandTimeout("analyze", 5000, fn);

    // Advance 4999ms — timeout has not fired yet
    await vi.advanceTimersByTimeAsync(4999);
    resolveInner();

    await expect(promise).resolves.toBeUndefined();
  });

  it("propagates errors thrown by fn without triggering the timeout error", async () => {
    const customErr = new Error("something went wrong");
    const fn = () => Promise.reject(customErr);
    await expect(withCommandTimeout("analyze", 5000, fn)).rejects.toThrow("something went wrong");
  });

  it("fires timeout at exactly the configured threshold", async () => {
    const fn = () => new Promise(() => {});
    const promise = withCommandTimeout("analyze", 2000, fn);

    // Attach rejection handler upfront to avoid unhandled rejection warning
    const caught = promise.catch((e) => e);

    // One millisecond before the threshold: should still be pending
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void promise.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    // Cross the threshold
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err.message).toContain("timed out");
  });
});
