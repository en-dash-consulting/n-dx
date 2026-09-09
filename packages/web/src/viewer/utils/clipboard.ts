/**
 * Clipboard copy with a legacy `execCommand` fallback and a classified failure.
 *
 * Lifted out of `views/pr-markdown.ts` when the Ask panel needed the same
 * workflow. Two consumers, so it clears the two-consumer rule in the root
 * `CLAUDE.md`; a third would not change anything here.
 *
 * ## Why a fallback at all
 *
 * `navigator.clipboard.writeText` is the only API that works without a user
 * gesture heuristic, but it is absent on `http://` origins in some browsers and
 * rejects when the permission is denied or the document is not focused. The
 * hidden-textarea + `document.execCommand("copy")` path predates it and still
 * works in exactly those cases, so it is tried second rather than not at all.
 *
 * ## Why the failure kind is part of the result
 *
 * A permission denial and a generic failure need different words: the first is
 * a browser setting the user can change, the second is not. Returning the kind
 * rather than throwing keeps that distinction at the call site, where the
 * message lives, instead of forcing every caller to re-classify the error.
 *
 * @module web/viewer/utils/clipboard
 */

/** Why a copy failed, when it did. */
export type ClipboardFailureKind = "permission-denied" | "generic";

/** Outcome of a copy attempt — success carries nothing, failure carries why. */
export type ClipboardResult =
  | { ok: true }
  | { ok: false; kind: ClipboardFailureKind };

/**
 * Copy via a hidden textarea and `document.execCommand("copy")`.
 *
 * Returns whether the copy took, rather than throwing: every call site here
 * treats a failed legacy copy the same as a refused one.
 */
export function fallbackCopyText(text: string): boolean {
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
 * True when `error` is a clipboard rejection the user could fix by granting
 * permission.
 *
 * Browsers disagree on the shape: some throw `NotAllowedError`, others a plain
 * `Error` whose message names the permission, so both are checked.
 */
export function isPermissionDeniedClipboardError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "NotAllowedError"
    || /permission/i.test(error.message)
    || /denied/i.test(error.message);
}

/**
 * Put `text` on the clipboard, falling back to `execCommand` when the async
 * API is unavailable or rejects.
 *
 * The fallback runs on rejection too, not only on absence — a rejected
 * `writeText` is often recoverable that way, and reporting a failure the
 * fallback would have handled sends the user to copy manually for nothing.
 */
export async function copyTextToClipboard(text: string): Promise<ClipboardResult> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      if (fallbackCopyText(text)) return { ok: true };
      return {
        ok: false,
        kind: isPermissionDeniedClipboardError(error) ? "permission-denied" : "generic",
      };
    }
  }

  // No async API at all — there is no error to classify, so a failed legacy
  // copy can only be reported as generic.
  return fallbackCopyText(text) ? { ok: true } : { ok: false, kind: "generic" };
}

/**
 * The user-facing message for a failed copy.
 *
 * `subject` names what could not be copied ("markdown", "answer") and is
 * substituted into both the failure sentence and the manual-copy instruction,
 * so every view says the same thing about the same situation.
 */
export function clipboardFailureMessage(kind: ClipboardFailureKind, subject: string): string {
  const manual = `Copy manually: select the ${subject} and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).`;
  return kind === "permission-denied"
    ? `Clipboard access was blocked by browser permissions. ${manual}`
    : `Failed to copy ${subject} to clipboard. ${manual}`;
}
