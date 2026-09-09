// @vitest-environment jsdom
/**
 * Tests for the shared clipboard helper.
 *
 * The four paths that matter to callers: the async API succeeds, the async API
 * is absent so `execCommand` carries the copy, the async API rejects but
 * `execCommand` recovers it, and both fail — where a permission denial has to
 * stay distinguishable from a generic failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  copyTextToClipboard,
  fallbackCopyText,
  isPermissionDeniedClipboardError,
  clipboardFailureMessage,
} from "../../../src/viewer/utils/clipboard.js";

/** Install a `document.execCommand` that reports `ok` and records the copy. */
function stubExecCommand(ok: boolean) {
  const copied: string[] = [];
  const exec = vi.fn((command: string) => {
    if (command !== "copy") return false;
    // The helper selects a textarea it just appended; read what it holds.
    const active = document.querySelector("textarea");
    if (active) copied.push((active as HTMLTextAreaElement).value);
    return ok;
  });
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true, writable: true });
  return { exec, copied };
}

/** Replace `navigator.clipboard` — jsdom does not provide one. */
function stubAsyncClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

describe("copyTextToClipboard", () => {
  beforeEach(() => {
    stubExecCommand(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stubAsyncClipboard(null);
  });

  it("uses navigator.clipboard when it is available", async () => {
    const writeText = vi.fn(async () => {});
    stubAsyncClipboard(writeText);

    const result = await copyTextToClipboard("the answer text");

    expect(result).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("the answer text");
  });

  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    stubAsyncClipboard(null);
    const { exec, copied } = stubExecCommand(true);

    const result = await copyTextToClipboard("the answer text");

    expect(result).toEqual({ ok: true });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copied).toEqual(["the answer text"]);
  });

  it("falls back to execCommand when navigator.clipboard rejects", async () => {
    stubAsyncClipboard(async () => { throw new Error("Document is not focused"); });
    const { copied } = stubExecCommand(true);

    const result = await copyTextToClipboard("the answer text");

    // Reporting a failure the fallback would have handled sends the user to
    // copy manually for nothing, so the fallback runs on rejection too.
    expect(result).toEqual({ ok: true });
    expect(copied).toEqual(["the answer text"]);
  });

  it("reports a permission denial distinctly when the fallback also fails", async () => {
    const denied = new Error("Write permission denied.");
    denied.name = "NotAllowedError";
    stubAsyncClipboard(async () => { throw denied; });
    stubExecCommand(false);

    expect(await copyTextToClipboard("the answer text")).toEqual({
      ok: false,
      kind: "permission-denied",
    });
  });

  it("reports any other double failure as generic", async () => {
    stubAsyncClipboard(async () => { throw new Error("clipboard is broken"); });
    stubExecCommand(false);

    expect(await copyTextToClipboard("the answer text")).toEqual({
      ok: false,
      kind: "generic",
    });
  });

  it("cannot classify a failure with no async API, so calls it generic", async () => {
    stubAsyncClipboard(null);
    stubExecCommand(false);

    expect(await copyTextToClipboard("the answer text")).toEqual({
      ok: false,
      kind: "generic",
    });
  });

  it("leaves no textarea behind after a successful fallback", async () => {
    stubAsyncClipboard(null);
    stubExecCommand(true);

    await copyTextToClipboard("the answer text");

    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("fallbackCopyText", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns false rather than throwing when execCommand throws", () => {
    Object.defineProperty(document, "execCommand", {
      value: () => { throw new Error("not supported"); },
      configurable: true,
      writable: true,
    });

    expect(fallbackCopyText("text")).toBe(false);
  });
});

describe("isPermissionDeniedClipboardError", () => {
  it("recognises NotAllowedError by name", () => {
    const err = new Error("nope");
    err.name = "NotAllowedError";
    expect(isPermissionDeniedClipboardError(err)).toBe(true);
  });

  it("recognises browsers that only say so in the message", () => {
    expect(isPermissionDeniedClipboardError(new Error("Clipboard permission missing"))).toBe(true);
    expect(isPermissionDeniedClipboardError(new Error("write access denied"))).toBe(true);
  });

  it("does not claim a permission problem for other failures", () => {
    expect(isPermissionDeniedClipboardError(new Error("Document is not focused"))).toBe(false);
    expect(isPermissionDeniedClipboardError("denied")).toBe(false);
    expect(isPermissionDeniedClipboardError(null)).toBe(false);
  });
});

describe("clipboardFailureMessage", () => {
  it("names the browser permission and how to copy by hand", () => {
    const message = clipboardFailureMessage("permission-denied", "answer");
    expect(message).toContain("Clipboard access was blocked by browser permissions.");
    expect(message).toContain("select the answer");
  });

  it("says what could not be copied for a generic failure", () => {
    expect(clipboardFailureMessage("generic", "markdown"))
      .toContain("Failed to copy markdown to clipboard.");
  });
});
