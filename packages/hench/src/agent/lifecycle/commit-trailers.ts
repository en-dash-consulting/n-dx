/**
 * Append trailers to a commit message so they land in one final trailer block.
 *
 * git parses trailers from the message's last paragraph only. A trailer split
 * off by a blank line is body text to every reader — rex's
 * `computeChangeCommits` asks git for `%(trailers:key=N-DX-Item)` and never
 * sees it. Appending trailers one at a time, each deciding its own separator,
 * is how the work commit ended up with N-DX / blank / N-DX-Item / blank /
 * Co-Authored-By.
 *
 * @module
 */

/**
 * A `Key: value` trailer line, or a folded continuation of one. The key is
 * git's trailer token: alphanumerics and hyphens, no spaces.
 */
const TRAILER_LINE = /^[A-Za-z0-9][A-Za-z0-9-]*:\s/;
const CONTINUATION_LINE = /^[ \t]+\S/;

/**
 * True when `paragraph` is a trailer block: every line is a trailer or a
 * continuation, starting with a trailer. Stricter than git's own rule (which
 * also accepts a block that is only 25% trailers when one is git-generated),
 * so a paragraph this calls a block git also reads as one.
 */
function isTrailerBlock(paragraph: string): boolean {
  const lines = paragraph.split("\n");
  return (
    TRAILER_LINE.test(lines[0]) &&
    lines.every((line) => TRAILER_LINE.test(line) || CONTINUATION_LINE.test(line))
  );
}

/**
 * Return `message` with `trailers` appended to its final trailer block.
 *
 * - When the message already ends in a trailer block (the agent wrote its own
 *   `Co-Authored-By:`), the trailers join that block — no blank line, so git
 *   reads both the agent's and hench's.
 * - Otherwise they start a new block after one blank line. The subject is never
 *   a trailer block, even when it reads like one (`fix: …`).
 * - A trailer line already present verbatim in the final block is not repeated.
 *
 * Line endings are normalised to LF and trailing whitespace is dropped, so the result does not
 * depend on whether the writer ended its message with a newline. The result
 * ends with exactly one newline.
 */
export function appendTrailerBlock(message: string, trailers: readonly string[]): string {
  // CRLF/CR → LF first: `\n[ \t]*\n` does not match `\n\r\n`, which would hide the
  // agent's final block. git strips the \r from the commit anyway.
  const body = message.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const paragraphs = body.split(/\n[ \t]*\n/);
  const last = paragraphs[paragraphs.length - 1];
  const endsInBlock = paragraphs.length > 1 && isTrailerBlock(last);

  const existing = new Set(endsInBlock ? last.split("\n") : []);
  const added = trailers.filter((line) => !existing.has(line));
  if (added.length === 0) return `${body}\n`;

  const separator = endsInBlock ? "\n" : "\n\n";
  return `${body}${separator}${added.join("\n")}\n`;
}
