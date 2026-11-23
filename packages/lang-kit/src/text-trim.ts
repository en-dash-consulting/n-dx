/**
 * Trims of one repeated character, by index loops.
 *
 * `text.replace(/\/+$/, "")` retries from every `/` of a run that ends in
 * another character, so it is quadratic on repository input (CodeQL
 * js/polynomial-redos); these are linear.
 */

/** `text` without the run of `char` (one UTF-16 unit) at its end. */
export function trimTrailing(text: string, char: string): string {
  const code = char.charCodeAt(0);
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === code) end--;
  return text.slice(0, end);
}

/** `text` without the run of `char` (one UTF-16 unit) at its start. */
export function trimLeading(text: string, char: string): string {
  const code = char.charCodeAt(0);
  let start = 0;
  while (start < text.length && text.charCodeAt(start) === code) start++;
  return text.slice(start);
}

/** `text` without the runs of `char` (one UTF-16 unit) at either end. */
export const trimChar = (text: string, char: string): string => trimLeading(trimTrailing(text, char), char);
