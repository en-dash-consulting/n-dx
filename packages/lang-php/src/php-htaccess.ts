/**
 * What an `.htaccess` file says about which URLs a PHP site serves, read as
 * text (no web server is run, LS16): access denials and front-controller
 * rewrites. Used by the docroot routes (`php-docroot.ts`).
 *
 * - **Directory access**, outside a `<Files>` block, read as two models and
 *   joined as Apache's default `Satisfy All` does (the stricter wins: denied,
 *   then restricted, then granted; a tie goes to the earlier line):
 *   - 2.4's mod_authz_core: sibling `Require` lines are `<RequireAny>`, so
 *     `Require all granted` grants, else `Require ip|host|local`
 *     (mod_authz_host) restricts, else `Require all denied` denies.
 *   - 2.2's mod_access_compat: under `Order deny,allow` (the default) an
 *     `Allow` overrides a `Deny`, so `Allow from all` grants, `Deny from all`
 *     with `Allow from <clients>` restricts, and `Deny from all` alone
 *     denies; under `Order allow,deny` (or `mutual-failure`) `Deny from all`
 *     denies, else `Allow from all` grants, else `Allow from <clients>`
 *     restricts. `Deny from <clients>` is not read: the rest are served.
 *   A denial covers the directory and everything below it; a grant opens it
 *   again below a denied parent. A restricted directory's files are still
 *   served, to the clients named, so they stay routes. A rule inside
 *   `<Limit>`/`<LimitExcept>` counts only when the block covers GET or POST
 *   (`<LimitExcept GET POST>` covers neither); other containers
 *   (`<IfModule>`) are read through, so both halves of the dual-version
 *   idiom are read and joined.
 * - **File access**: the same denials inside `<Files name>`,
 *   `<Files ~ "regex">` or `<FilesMatch "regex">` deny the files whose name
 *   matches, in the directory and below. A restriction inside them is not read.
 * - **`RedirectMatch 403 regex`**: denies every URL path the regex matches.
 * - **Front controllers**: `RewriteRule pattern target [flags]` whose target,
 *   less its query string and any path info after `.php`, is a literal `.php`
 *   path (`index.php?q=$1`, `index.php/$1`), not a redirect, proxy, forbidden
 *   or gone rule; `FallbackResource /index.php`. A `.php` file chosen by a
 *   back-reference or variable (`$1.php`) is a notice.
 *   A relative target is under `RewriteBase`, else the directory.
 *
 * A line ending in `\` continues on the next; a line starting with `#` is a
 * comment. Directive and container names are case-insensitive. A logical
 * line longer than 64 KiB is skipped and counted in a notice.
 *
 * @module lang-php/php-htaccess
 */

import { isOverlongLine, overlongLinesNotice } from "./php-line-cap.js";

/** A directory's access in one `.htaccess` file. */
export interface HtaccessAccess {
  readonly denied: boolean;
  readonly line: number;
  readonly restriction?: string;
}

/** A `<Files>`/`<FilesMatch>` block's denial. */
export interface HtaccessFileDenial {
  /** Whether the block names `name` (a file name, no directory). */
  readonly matches: (name: string) => boolean;
  readonly line: number;
}

/** A `RedirectMatch 403` rule. */
export interface HtaccessUrlDenial {
  readonly pattern: RegExp;
  readonly line: number;
}

/** A rewrite to a PHP file. */
export interface HtaccessFrontController {
  readonly directive: "RewriteRule" | "FallbackResource";
  /** The rule's pattern as written; absent for `FallbackResource`. */
  readonly pattern?: string;
  /** The target's file as written: query string, fragment and path info after `.php` removed. */
  readonly target: string;
  readonly line: number;
}

export interface Htaccess {
  /** Project-relative path of the file. */
  readonly file: string;
  /**
   * Directory-wide access, absent when the file sets none (rules in the
   * module comment). `restriction` is the restricting directive as written
   * (`Require ip 10.0.0.0/8`, `Allow from 10.0.0.0/8`), set when the
   * directory is served only to the clients it names.
   */
  readonly access?: HtaccessAccess;
  readonly fileDenials: readonly HtaccessFileDenial[];
  readonly urlDenials: readonly HtaccessUrlDenial[];
  /** `RewriteBase` as written. */
  readonly rewriteBase?: string;
  readonly frontControllers: readonly HtaccessFrontController[];
  /** What was skipped, one sentence each. */
  readonly notices: readonly string[];
}

const isSpace = (c: string): boolean => /\s/.test(c);
const isLineTerminator = (c: string): boolean => c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";

/**
 * Where the quoted word opening before `from` closes: `closed` with the
 * closing quote's index, or not, with the index its scan stopped at (the end,
 * or a `\` before a line terminator). A `\` escapes the next character.
 */
function closingQuote(text: string, from: number): { readonly closed: boolean; readonly at: number } {
  let i = from;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') return { closed: true, at: i };
    if (c === "\\") {
      if (i + 1 >= text.length || isLineTerminator(text[i + 1]!)) return { closed: false, at: i };
      i += 2;
    } else i += 1;
  }
  return { closed: false, at: i };
}

/**
 * One directive line's words; a double-quoted word keeps its spaces, quotes
 * removed and only `\"` unescaped (regex backslashes stay). A `"` with no
 * closing quote starts a plain word, a run of non-space as any other.
 *
 * A hand-written scan: the regex it replaces, `/"((?:[^"\\]|\\.)*)"|(\S+)/g`,
 * rescans to the end from every unclosed quote, quadratic on repository input.
 * Here no stretch is scanned for a closing quote twice: a quote that starts a
 * word inside a stretch an earlier unclosed quote scanned would have closed it.
 */
export function htaccessWords(text: string): string[] {
  const out: string[] = [];
  let unclosedUntil = 0;
  let i = 0;
  while (i < text.length) {
    if (isSpace(text[i]!)) {
      i += 1;
      continue;
    }
    if (text[i] === '"' && i >= unclosedUntil) {
      const close = closingQuote(text, i + 1);
      if (close.closed) {
        out.push(text.slice(i + 1, close.at).replace(/\\"/g, '"'));
        i = close.at + 1;
        continue;
      }
      unclosedUntil = close.at;
    }
    const start = i;
    while (i < text.length && !isSpace(text[i]!)) i += 1;
    out.push(text.slice(start, i));
  }
  return out;
}

/** Logical lines with their first physical line number. */
function logicalLines(text: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let pending: { text: string; line: number } | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const continued = raw.endsWith("\\");
    const part = continued ? raw.slice(0, -1) : raw;
    pending = pending ? { text: `${pending.text} ${part.trim()}`, line: pending.line } : { text: part, line: i + 1 };
    if (continued) return;
    out.push(pending);
    pending = undefined;
  });
  if (pending) out.push(pending);
  return out;
}

const isDenial = (w: readonly string[]): boolean =>
  (w[0] === "deny" && w[1] === "from" && w[2] === "all") || (w[0] === "require" && w[1] === "all" && w[2] === "denied");

const isGrant = (w: readonly string[]): boolean =>
  (w[0] === "allow" && w[1] === "from" && w[2] === "all") || (w[0] === "require" && w[1] === "all" && w[2] === "granted");

/**
 * `Require ip|host|local` (mod_authz_host) or `Allow from <clients>`
 * (mod_access_compat): only the clients it names are served.
 */
const isRestriction = (w: readonly string[]): boolean =>
  (w[0] === "require" && (((w[1] === "ip" || w[1] === "host") && w[2] !== undefined) || w[1] === "local")) ||
  (w[0] === "allow" && w[1] === "from" && w[2] !== undefined && w[2] !== "all");

/** A directive that bears on who is served the pages, `Order` included. */
const isAccessRule = (w: readonly string[]): boolean => isDenial(w) || isGrant(w) || isRestriction(w) || w[0] === "order";

/** One access model's directives in a file, the first line of each kind. */
interface AccessLines {
  denied?: number;
  granted?: number;
  restricted?: { readonly line: number; readonly directive: string };
}

const denial = (line: number): HtaccessAccess => ({ denied: true, line });
const grant = (line: number): HtaccessAccess => ({ denied: false, line });
const restriction = (r: { readonly line: number; readonly directive: string }): HtaccessAccess => ({
  denied: false,
  line: r.line,
  restriction: r.directive,
});

/** mod_authz_core: sibling `Require` lines are `<RequireAny>`, so any one that succeeds serves. */
function requireAccess(r: AccessLines): HtaccessAccess | undefined {
  if (r.granted !== undefined) return grant(r.granted);
  if (r.restricted !== undefined) return restriction(r.restricted);
  return r.denied === undefined ? undefined : denial(r.denied);
}

/**
 * mod_access_compat: `Order deny,allow` (the default) serves by default and
 * lets an `Allow` override a `Deny`; `Order allow,deny` and `mutual-failure`
 * deny by default and let a `Deny` override an `Allow`. An `Order` with no
 * `Allow`/`Deny` beside it is not read.
 */
function compatAccess(c: AccessLines, allowFirst: boolean): HtaccessAccess | undefined {
  if (allowFirst) {
    if (c.denied !== undefined) return denial(c.denied);
    if (c.granted !== undefined) return grant(c.granted);
    return c.restricted === undefined ? undefined : restriction(c.restricted);
  }
  if (c.granted !== undefined) return grant(c.granted);
  if (c.denied === undefined) return undefined;
  return c.restricted === undefined ? denial(c.denied) : restriction(c.restricted);
}

const strictness = (a: HtaccessAccess): number => (a.denied ? 2 : a.restriction !== undefined ? 1 : 0);

/** `Satisfy All`, the default: a client must pass both models, so the stricter wins. */
function joinAccess(a: HtaccessAccess | undefined, b: HtaccessAccess | undefined): HtaccessAccess | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  if (strictness(a) !== strictness(b)) return strictness(a) > strictness(b) ? a : b;
  return a.line <= b.line ? a : b;
}

/** Flags that make a rule something other than an internal rewrite: redirect, forbidden, gone, proxy. */
const NOT_INTERNAL = /^(r|redirect|f|forbidden|g|gone|p|proxy)(=|$)/i;

/** A `<Files>` block's name test: a wildcard name, or a regex with `~`. */
function filesMatcher(args: readonly string[], regex: boolean): ((name: string) => boolean) | undefined {
  const [first, second] = args;
  if (first === undefined) return undefined;
  if (regex || (first === "~" && second !== undefined)) {
    const source = regex ? first : second!;
    try {
      const re = new RegExp(source);
      return (name) => re.test(name);
    } catch {
      return undefined;
    }
  }
  // Wildcards per Apache's fnmatch: `*` and `?`, never across `/`.
  const re = new RegExp(`^${first.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);
  return (name) => re.test(name);
}

/** Read one `.htaccess` file's text. */
export function parseHtaccess(file: string, text: string): Htaccess {
  const required: AccessLines = {};
  const compat: AccessLines = {};
  let allowFirst = false;
  const fileDenials: HtaccessFileDenial[] = [];
  const urlDenials: HtaccessUrlDenial[] = [];
  const frontControllers: HtaccessFrontController[] = [];
  const notices: string[] = [];
  let rewriteBase: string | undefined;
  /**
   * Open containers: a `<Files>` block's matcher, `other-methods` for a
   * `<Limit>`/`<LimitExcept>` that covers neither GET nor POST, or null for one read through.
   */
  const containers: Array<((name: string) => boolean) | null | "unreadable" | "other-methods"> = [];

  let overlong = 0;
  for (const { text: lineText, line } of logicalLines(text)) {
    if (isOverlongLine(lineText)) {
      overlong += 1;
      continue;
    }
    const trimmed = lineText.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const open = /^<\s*([A-Za-z]+)\b(.*?)>$/.exec(trimmed);
    if (open) {
      const name = open[1]!.toLowerCase();
      if (name === "files" || name === "filesmatch") {
        const matcher = filesMatcher(htaccessWords(open[2]!), name === "filesmatch");
        if (matcher === undefined) notices.push(`${file}:${line} <${open[1]}> has a pattern that could not be read; its access rules are not applied.`);
        containers.push(matcher ?? "unreadable");
      } else if (name === "limit" || name === "limitexcept") {
        // <Limit m…> applies to the methods listed, <LimitExcept m…> to all others.
        const listed = new Set(htaccessWords(open[2]!).map((m) => m.toUpperCase()));
        const pages = name === "limit" ? listed.has("GET") || listed.has("POST") : !listed.has("GET") || !listed.has("POST");
        containers.push(pages ? null : "other-methods");
      } else {
        containers.push(null);
      }
      continue;
    }
    if (/^<\s*\//.test(trimmed)) {
      containers.pop();
      continue;
    }
    const raw = htaccessWords(trimmed);
    const w = raw.map((x) => x.toLowerCase());
    // Access rules for methods other than GET and POST say nothing about the pages.
    if (containers.includes("other-methods") && isAccessRule(w)) continue;
    const files = containers.find((c) => c !== null && c !== "other-methods");
    if (isAccessRule(w)) {
      if (files !== undefined) {
        if (isDenial(w) && files !== "unreadable") fileDenials.push({ matches: files, line });
      } else if (w[0] === "order") {
        allowFirst = /^(allow,deny|mutual-failure)$/.test(w.slice(1).join(""));
      } else {
        const lines = w[0] === "require" ? required : compat;
        if (isDenial(w)) lines.denied ??= line;
        else if (isGrant(w)) lines.granted ??= line;
        else lines.restricted ??= { line, directive: raw.join(" ") };
      }
      continue;
    }
    if (files !== undefined) continue;
    switch (w[0]) {
      case "redirectmatch": {
        if (raw[1] !== "403" || raw[2] === undefined) break;
        try {
          urlDenials.push({ pattern: new RegExp(raw[2]), line });
        } catch {
          notices.push(`${file}:${line} RedirectMatch 403 pattern ${raw[2]} could not be read; it is not applied.`);
        }
        break;
      }
      case "rewritebase":
        if (raw[1] !== undefined) rewriteBase = raw[1];
        break;
      case "rewriterule": {
        const [, pattern, target, flags] = raw;
        if (pattern === undefined || target === undefined) break;
        if (flags !== undefined && flags.replace(/^\[|\]$/g, "").split(",").some((f) => NOT_INTERNAL.test(f.trim()))) break;
        addFrontController(frontControllers, notices, file, { directive: "RewriteRule", pattern, target, line });
        break;
      }
      case "fallbackresource":
        if (raw[1] !== undefined) addFrontController(frontControllers, notices, file, { directive: "FallbackResource", target: raw[1], line });
        break;
    }
  }
  if (overlong > 0) notices.push(overlongLinesNotice(file, overlong, "access and rewrite rules"));
  const access = joinAccess(requireAccess(required), compatAccess(compat, allowFirst));
  return { file, ...(access && { access }), fileDenials, urlDenials, ...(rewriteBase !== undefined && { rewriteBase }), frontControllers, notices };
}

/**
 * A rewrite target's file part: the text before its query string or fragment,
 * cut after a `.php` followed by `/` (path info, `index.php/$1`).
 */
function targetFile(target: string): string {
  const file = target.split(/[?#]/)[0]!;
  const pathInfo = /\.php(?=\/)/i.exec(file);
  return pathInfo === null ? file : file.slice(0, pathInfo.index + 4);
}

/**
 * A rewrite target's local `.php` file: `{ path }` when literal, `"dynamic"`
 * when a back-reference or variable chooses it (`$1.php`), else undefined.
 */
function phpTarget(target: string): { readonly path: string } | "dynamic" | undefined {
  const file = targetFile(target);
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || !file.toLowerCase().endsWith(".php")) return undefined;
  return /[$%]/.test(file) ? "dynamic" : { path: file };
}

/** Records `target`'s front controller, or a notice when the request chooses its file. */
function addFrontController(
  frontControllers: HtaccessFrontController[],
  notices: string[],
  file: string,
  rule: HtaccessFrontController,
): void {
  const target = phpTarget(rule.target);
  if (target === undefined) return;
  if (target === "dynamic") notices.push(`${file}:${rule.line} ${rule.directive} target ${rule.target} takes its PHP file from the request; no route recorded.`);
  else frontControllers.push({ ...rule, target: target.path });
}
