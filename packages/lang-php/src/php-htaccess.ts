/**
 * What an `.htaccess` file says about which URLs a PHP site serves, read as
 * text (no web server is run, LS16): access denials and front-controller
 * rewrites. Used by the docroot routes (`php-docroot.ts`).
 *
 * - **Directory access**: `Deny from all` (Apache 2.2's mod_access_compat)
 *   or `Require all denied` (2.4's mod_authz_core) outside a `<Files>`
 *   block denies the directory and everything below it; `Allow from all` or
 *   `Require all granted` with no denial grants it again below a denied
 *   parent. A rule inside `<Limit>`/`<LimitExcept>` counts only when the
 *   block covers GET or POST (`<LimitExcept GET POST>` covers neither);
 *   other containers (`<IfModule>`) are read through.
 * - **File access**: the same denials inside `<Files name>`,
 *   `<Files ~ "regex">` or `<FilesMatch "regex">` deny the files whose name
 *   matches, in the directory and below.
 * - **`RedirectMatch 403 regex`**: denies every URL path the regex matches.
 * - **Front controllers**: `RewriteRule pattern target [flags]` whose target,
 *   less its query string, is a literal `.php` path (`index.php?q=$1`), not
 *   a redirect, proxy, forbidden or gone rule; `FallbackResource /index.php`.
 *   A relative target is under `RewriteBase`, else the directory.
 *
 * A line ending in `\` continues on the next; a line starting with `#` is a
 * comment. Directive and container names are case-insensitive.
 *
 * @module lang-php/php-htaccess
 */

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
  /** The target as written, query string removed. */
  readonly target: string;
  readonly line: number;
}

export interface Htaccess {
  /** Project-relative path of the file. */
  readonly file: string;
  /** Directory-wide access: `denied` wins over `granted` in one file; absent when it sets none. */
  readonly access?: { readonly denied: boolean; readonly line: number };
  readonly fileDenials: readonly HtaccessFileDenial[];
  readonly urlDenials: readonly HtaccessUrlDenial[];
  /** `RewriteBase` as written. */
  readonly rewriteBase?: string;
  readonly frontControllers: readonly HtaccessFrontController[];
  /** What was skipped, one sentence each. */
  readonly notices: readonly string[];
}

/** One directive line's words; a double-quoted word keeps its spaces, quotes removed and only `\"` unescaped (regex backslashes stay). */
function words(text: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2]!);
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
  let denied: number | undefined;
  let granted: number | undefined;
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

  for (const { text: lineText, line } of logicalLines(text)) {
    const trimmed = lineText.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const open = /^<\s*([A-Za-z]+)\b(.*?)>$/.exec(trimmed);
    if (open) {
      const name = open[1]!.toLowerCase();
      if (name === "files" || name === "filesmatch") {
        const matcher = filesMatcher(words(open[2]!), name === "filesmatch");
        if (matcher === undefined) notices.push(`${file}:${line} <${open[1]}> has a pattern that could not be read; its access rules are not applied.`);
        containers.push(matcher ?? "unreadable");
      } else if (name === "limit" || name === "limitexcept") {
        // <Limit m…> applies to the methods listed, <LimitExcept m…> to all others.
        const listed = new Set(words(open[2]!).map((m) => m.toUpperCase()));
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
    const raw = words(trimmed);
    const w = raw.map((x) => x.toLowerCase());
    // Access rules for methods other than GET and POST say nothing about the pages.
    if (containers.includes("other-methods") && (isDenial(w) || isGrant(w))) continue;
    const files = containers.find((c) => c !== null && c !== "other-methods");
    if (isDenial(w)) {
      if (files === undefined) denied ??= line;
      else if (files !== "unreadable") fileDenials.push({ matches: files, line });
      continue;
    }
    if (isGrant(w)) {
      if (files === undefined) granted ??= line;
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
        const path = phpTarget(target);
        if (path !== undefined) frontControllers.push({ directive: "RewriteRule", pattern, target: path, line });
        break;
      }
      case "fallbackresource": {
        const path = raw[1] === undefined ? undefined : phpTarget(raw[1]);
        if (path !== undefined) frontControllers.push({ directive: "FallbackResource", target: path, line });
        break;
      }
    }
  }
  const access = denied !== undefined ? { denied: true, line: denied } : granted !== undefined ? { denied: false, line: granted } : undefined;
  return { file, ...(access && { access }), fileDenials, urlDenials, ...(rewriteBase !== undefined && { rewriteBase }), frontControllers, notices };
}

/** A rewrite target's path when it is a literal local `.php` file: query string dropped, no back-reference or variable. */
function phpTarget(target: string): string | undefined {
  const path = target.split("?")[0]!;
  if (/[$%]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined;
  return path.toLowerCase().endsWith(".php") ? path : undefined;
}
