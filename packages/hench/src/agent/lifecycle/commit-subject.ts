/**
 * Output contract for the light-tier commit-subject call.
 *
 * The pre-run commit gate asks a model for one commit subject and passes the
 * answer straight to `git commit -m`. That call is routed to the cheapest
 * adequate tier, which is only a safe trade while bad output stays
 * *detectable*: a model that replies with a preamble, a fenced block, or a
 * paragraph would otherwise write that into the repository's history.
 *
 * So this module is the validation half of that routing decision. It is
 * deliberately forgiving about *shape* — stripping fences, quotes, bullets and
 * conversational lead-ins, because those are the common cheap-model tics — and
 * strict about the *result*: one line, non-empty, within the conventional
 * subject bound, or nothing at all. Returning undefined hands the caller its
 * generic fallback message, which is a better commit than "Sure, here you go:".
 *
 * @module hench/agent/lifecycle/commit-subject
 */

/** Conventional git subject bound; the prompt asks for this too. */
export const COMMIT_SUBJECT_MAX_LENGTH = 72;

/**
 * Lines that are the model talking about the answer rather than giving it.
 * Matched only to *skip* a line, never to reject the whole response, so a
 * preamble followed by a real subject still yields the subject.
 */
const PREAMBLE_RE =
  /^(sure|certainly|of course|here('s| is| are)|okay|ok|got it|understood)\b.*$|^.*commit (subject|message)\s*:?\s*$/i;

/** Leading markdown noise: bullets, numbering, heading marks, blockquotes. */
const LEADING_MARKUP_RE = /^(?:[-*+>]\s+|#{1,6}\s+|\d+[.)]\s+)/;

/** Strip one layer of matching surrounding quotes or backticks. */
function stripWrapping(line: string): string {
  let out = line.trim();
  // Loop: a model may produce `"subject"` — quote inside backtick.
  for (let i = 0; i < 2; i++) {
    const first = out[0];
    const last = out[out.length - 1];
    if (out.length >= 2 && first === last && (first === '"' || first === "'" || first === "`")) {
      out = out.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return out;
}

/**
 * Extract a usable commit subject, or undefined when the response contains
 * none.
 *
 * @param text Raw model output.
 * @returns A single-line subject within {@link COMMIT_SUBJECT_MAX_LENGTH},
 *          or undefined to signal "use the fallback".
 */
export function extractCommitSubject(text: string | undefined | null): string | undefined {
  if (!text) return undefined;

  // Drop fence delimiters entirely rather than trying to parse the block:
  // the content inside is what was wanted, and the fence line never is.
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"));

  for (const line of lines) {
    const candidate = stripWrapping(stripWrapping(line).replace(LEADING_MARKUP_RE, ""));
    if (!candidate) continue;
    if (PREAMBLE_RE.test(candidate)) continue;
    return candidate.slice(0, COMMIT_SUBJECT_MAX_LENGTH).trim();
  }

  return undefined;
}
