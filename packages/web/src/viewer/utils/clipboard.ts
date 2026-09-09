/**
 * Clipboard copy with an `execCommand` fallback and a named failure reason.
 *
 * Lifted out of `views/pr-markdown.ts`, whose implementation this preserves
 * verbatim in behaviour, so the Ask panel's Copy action and the PR Markdown
 * view share one copy path and one set of user-facing strings. Two consumer
 * views satisfy the two-consumer rule; a third (`components/copy-link-button.ts`)
 * and a fourth (`views/overview.ts`) still carry their own inlined variants,
 * both of which swallow failure silently and would gain a message by moving
 * here.
 *
 * ## Why the fallback exists at all
 *
 * `navigator.clipboard` is absent outside a secure context, and present but
 * permission-gated inside one. The deprecated `document.execCommand("copy")`
 * path works in both, so it is tried after the modern API rather than instead
 * of it — a browser that grants clipboard access should not be routed through
 * a hidden textarea.
 *
 * ## Why the reason is named
 *
 * "Copy failed" is not actionable; "your browser blocked clipboard access" is,
 * because the user can then select the text and press Cmd+C. A permission
 * denial is therefore distinguished from every other failure and gets its own
 * wording. The distinction is made from the error the API rejected with, so a
 * fallback that succeeds reports success regardless of why the first attempt
 * failed.
 *
 * This module deliberately holds no Preact: transient success/error feedback
 * is view state, and each consumer already owns a timer for it.
 *
 * @module web/viewer/utils/clipboard
 */

/** Why a copy attempt failed, once both the API and the fallback have. */
export type ClipboardFailureReason = "permission-denied" | "generic";

/** Outcome of {@link copyTextToClipboard}. */
export type ClipboardCopyResult =
  | { ok: true }
  | { ok: false; reason: ClipboardFailureReason };

/**
 * True when `error` is the browser refusing clipboard permission.
 *
 * `NotAllowedError` is what the spec names, but vendors have shipped plain
 * `Error`s whose only signal is the message, so the text is checked too. A
 * false positive here costs nothing worse than slightly wrong wording; a false
 * negative tells the user "copy failed" when the fix is a permission prompt.
 */
export function isPermissionDeniedClipboardError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "NotAllowedError"
    || /permission/i.test(error.message)
    || /denied/i.test(error.message);
}

/**
 * Copy via a hidden textarea and `document.execCommand("copy")`.
 *
 * Returns false rather than throwing: every caller is already handling a
 * failed modern-API attempt and wants a boolean, not a second error to
 * classify. The element is removed on the success path; a throw between
 * append and remove leaks it, which is why the whole body is guarded.
 */
export function copyTextWithExecCommand(text: string): boolean {
  try {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Put `text` on the clipboard, preferring `navigator.clipboard`.
 *
 * The modern API is skipped entirely when absent (insecure context) rather
 * than called and allowed to throw, so an unavailable clipboard is not
 * reported as a permission problem. When it is present but rejects, the
 * fallback is still attempted — an `execCommand` copy that works is a
 * successful copy, whatever the first attempt's reason was.
 */
export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
  const writeText = typeof navigator !== "undefined" ? navigator.clipboard?.writeText : undefined;

  if (typeof writeText !== "function") {
    return copyTextWithExecCommand(text) ? { ok: true } : { ok: false, reason: "generic" };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    if (copyTextWithExecCommand(text)) return { ok: true };
    return {
      ok: false,
      reason: isPermissionDeniedClipboardError(error) ? "permission-denied" : "generic",
    };
  }
}

// ---------------------------------------------------------------------------
// User-facing wording
// ---------------------------------------------------------------------------

/**
 * The manual-copy instruction appended to every failure message.
 *
 * `subject` names what the user should select ("markdown", "answer"), so the
 * sentence stays specific to the surface without each surface owning a copy of
 * the keyboard shortcuts.
 */
export function manualCopyHint(subject: string): string {
  return `Copy manually: select the ${subject} and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).`;
}

/** Confirmation shown after a successful copy. */
export function clipboardSuccessMessage(subject: string): string {
  return `Copied ${subject} to clipboard.`;
}

/** Failure wording, distinguishing a permission denial from everything else. */
export function clipboardFailureMessage(reason: ClipboardFailureReason, subject: string): string {
  const lead = reason === "permission-denied"
    ? "Clipboard access was blocked by browser permissions."
    : `Failed to copy ${subject} to clipboard.`;
  return `${lead} ${manualCopyHint(subject)}`;
}
