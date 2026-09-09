// @vitest-environment jsdom
/**
 * The shared clipboard helper.
 *
 * The view-level suites (`ask-view.test.ts`, `pr-markdown.test.ts`) already
 * cover copying through the UI. What only this file can check is the
 * classification at the boundary — which failures count as a permission
 * denial, what happens when the modern API is absent versus present-and-
 * rejecting — and the wording parity that is the whole reason both views
 * share one module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clipboardFailureMessage,
  clipboardSuccessMessage,
  copyTextToClipboard,
  copyTextWithExecCommand,
  isPermissionDeniedClipboardError,
  manualCopyHint,
} from "../../../src/viewer/utils/clipboard.js";

function setClipboard(writeText: ReturnType<typeof vi.fn> | null): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText === null ? undefined : { writeText },
    configurable: true,
    writable: true,
  });
}

describe("copyTextToClipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn(async () => {});
    setClipboard(writeText);
  });

  afterEach(() => {
    setClipboard(null);
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const spy = vi.fn(() => result);
    (document as unknown as { execCommand: unknown }).execCommand = spy;
    return spy;
  }

  it("prefers the modern API and does not touch the fallback when it works", async () => {
    const execCommand = stubExecCommand(true);

    expect(await copyTextToClipboard("hello")).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("hello");
    // A browser that grants clipboard access must not be routed through a
    // hidden textarea as well.
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("uses execCommand when the clipboard API is absent", async () => {
    setClipboard(null);
    const execCommand = stubExecCommand(true);

    expect(await copyTextToClipboard("hello")).toEqual({ ok: true });
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports generic failure — not a denial — when there is no API and no fallback", async () => {
    setClipboard(null);
    // No execCommand at all, which is the insecure-context-plus-old-browser
    // case. Nothing here is evidence of a permission decision.
    expect(await copyTextToClipboard("hello")).toEqual({ ok: false, reason: "generic" });
  });

  it("treats a successful fallback as success whatever the API's reason was", async () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    writeText.mockRejectedValueOnce(denied);
    stubExecCommand(true);

    expect(await copyTextToClipboard("hello")).toEqual({ ok: true });
  });

  it("classifies a denial only once the fallback has also failed", async () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    writeText.mockRejectedValueOnce(denied);
    stubExecCommand(false);

    expect(await copyTextToClipboard("hello")).toEqual({ ok: false, reason: "permission-denied" });
  });

  it("classifies any other rejection as generic", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard is on fire"));
    stubExecCommand(false);

    expect(await copyTextToClipboard("hello")).toEqual({ ok: false, reason: "generic" });
  });

  it("does not leave the hidden textarea behind", async () => {
    setClipboard(null);
    stubExecCommand(true);
    const before = document.body.childElementCount;

    await copyTextToClipboard("hello");

    expect(document.body.childElementCount).toBe(before);
  });

  it("returns false rather than throwing when execCommand is unavailable", () => {
    expect(copyTextWithExecCommand("hello")).toBe(false);
  });
});

describe("isPermissionDeniedClipboardError", () => {
  it("recognises the spec'd error name", () => {
    const err = new Error("nope");
    err.name = "NotAllowedError";
    expect(isPermissionDeniedClipboardError(err)).toBe(true);
  });

  it("recognises vendors that only say so in the message", () => {
    expect(isPermissionDeniedClipboardError(new Error("Write permission denied."))).toBe(true);
    expect(isPermissionDeniedClipboardError(new Error("DENIED by user"))).toBe(true);
  });

  it("does not guess from a non-Error or an unrelated failure", () => {
    expect(isPermissionDeniedClipboardError("permission denied")).toBe(false);
    expect(isPermissionDeniedClipboardError(null)).toBe(false);
    expect(isPermissionDeniedClipboardError(new Error("document is not focused"))).toBe(false);
  });
});

describe("wording", () => {
  it("keeps the PR Markdown view's messages byte-identical", () => {
    // These four strings were the PR Markdown view's inlined literals before
    // the helper existed. If a refactor changes them, that view's own suite
    // fails too — this assertion says which change caused it.
    expect(clipboardSuccessMessage("markdown")).toBe("Copied markdown to clipboard.");
    expect(clipboardFailureMessage("permission-denied", "markdown")).toBe(
      "Clipboard access was blocked by browser permissions. "
      + "Copy manually: select the markdown and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).",
    );
    expect(clipboardFailureMessage("generic", "markdown")).toBe(
      "Failed to copy markdown to clipboard. "
      + "Copy manually: select the markdown and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).",
    );
    expect(manualCopyHint("markdown")).toBe(
      "Copy manually: select the markdown and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).",
    );
  });

  it("names the subject the caller supplied", () => {
    expect(clipboardSuccessMessage("answer")).toBe("Copied answer to clipboard.");
    expect(clipboardFailureMessage("generic", "answer")).toContain("Failed to copy answer to clipboard.");
    expect(clipboardFailureMessage("permission-denied", "answer")).toContain("select the answer");
  });

  it("distinguishes the two failure reasons", () => {
    const denied = clipboardFailureMessage("permission-denied", "answer");
    const generic = clipboardFailureMessage("generic", "answer");
    expect(denied).not.toBe(generic);
    expect(denied).toContain("browser permissions");
    expect(generic).not.toContain("browser permissions");
    // Both still tell the user how to copy by hand.
    expect(denied).toContain(manualCopyHint("answer"));
    expect(generic).toContain(manualCopyHint("answer"));
  });
});
