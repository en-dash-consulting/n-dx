/**
 * URL userinfo removal, shared by sourcevision's output redaction and the
 * packs that report URL targets, so the two cannot disagree.
 *
 * After each `scheme://` the userinfo is found two ways:
 *
 * - **Last `@`.** The text up to the segment's last `@` (a segment ends at
 *   the next `scheme://`) is userinfo when it is a user with no `/`, `?`,
 *   `#`, `@` or `:`, then `:` and a password of anything but whitespace and
 *   quotes, and the text after that `@` starts with a host (name, IPv4 or
 *   `[IPv6]`) followed by `:port`, `/`, `?`, `#` or the end. A password
 *   holding `/`, `?`, `#` or `@` goes whole. Not when the text before the
 *   first `/`, `?` or `#` is `host:port` or an `[IPv6]` host
 *   (`https://host:8080/x@y`), which a password of one to five digits
 *   before its first `/` cannot be told from (`u:12/x@h` is kept).
 * - **First `/`.** Otherwise the authority ends at the first `/`, `?` or
 *   `#`, and everything before its last `@` goes, a user alone included (a
 *   token is often sent as the user: `https://<token>@host`).
 *
 * Text with no `scheme://` (`git@host:org/repo.git`, `mailto:a@b`) is
 * returned as it is. Linear in the text.
 */

const SCHEME = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\//g;

/** A user with no `/?#@:`, then `:` and a password with no whitespace or quote. */
const USERINFO = /^[^/?#@:\s"'`]*:[^\s"'`]*$/;

/**
 * An authority that is a host and a port (one to five digits) or an
 * `[IPv6]` host, with no userinfo. A port needs a digit and a host a
 * character, so `:/pw` and `u:/pw` (a password starting with `/`) are not one.
 */
const HOST_AND_PORT = /^(?:[^@:[\]]+:\d{1,5}|\[[^\]@]*\](?::\d*)?)$/;

/** A host name, IPv4 or `[IPv6]`, an optional `:port`, then `/`, `?`, `#` or the end. */
const HOST = /^(?:[A-Za-z0-9_~-]+(?:\.[A-Za-z0-9_~-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d*)?(?:[/?#]|$)/;

/** The authority by the first-`/` rule. */
const AUTHORITY = /^[^/?#]*/;

/** How many characters at the start of `segment` (the text after `scheme://`) are userinfo and its `@`. */
function userinfoLength(segment: string): number {
  const authority = AUTHORITY.exec(segment)![0];
  const at = segment.lastIndexOf("@");
  if (at > authority.length && !HOST_AND_PORT.test(authority) && USERINFO.test(segment.slice(0, at)) && HOST.test(segment.slice(at + 1))) {
    return at + 1;
  }
  return authority.lastIndexOf("@") + 1;
}

/** `text` with the userinfo of every `scheme://` URL in it removed. */
export function withoutUrlUserinfo(text: string): string {
  if (!text.includes("@")) return text;
  const starts = [...text.matchAll(SCHEME)];
  let out = "";
  let pos = 0;
  starts.forEach((match, i) => {
    const authority = match.index + match[0].length;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    out += text.slice(pos, authority);
    pos = authority + userinfoLength(text.slice(authority, end));
  });
  return out + text.slice(pos);
}
