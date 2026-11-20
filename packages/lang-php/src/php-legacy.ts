/**
 * Removed and deprecated PHP constructs over the PHP pack: per file, each use
 * of a construct a later PHP version removed or deprecated, and two review
 * notices, as lang-kit's `LegacyConstructFact`.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-legacy/legacy.scm`) runs in the PHP parse only when legacy
 * constructs are wanted. Each rule in {@link LEGACY_RULES} names the php.net
 * page of every version it gives (deprecated, removed, changed): the
 * migration guide from 5.6 on, the PHP 5 changelog for 5.3 to 5.5
 * (`php-version-sources.ts`); no version comes from anywhere else. A fact's `status` is
 * `removed` when the rule has a removal, else `deprecated`, and `notice` for
 * the two rules that only ask for a review:
 *
 * - `short-open-tag`: `<?` is PHP only while `short_open_tag` is on; never a
 *   removal.
 * - `string-number-comparison`: `==`, `!=` or `<>` between a non-numeric
 *   string literal and a number, whose result PHP 8.0 changed.
 *
 * How each rule reads the captures:
 *
 * - Function rules: a call that reaches the global function, in any letter
 *   case (`mysql_*`, `ereg*`, `mcrypt_*`, `each`, …), resolved as PHP does
 *   (`php-namespaces.ts`). A namespaced call (`\App\each()`) and a call that
 *   resolves to a function the repository declares (a namespaced helper of
 *   the same name, a global polyfill) are not PHP's function; `\mysql_query()`
 *   is PHP's even beside a namespaced helper of that name.
 * - `__autoload`: a function declared with that name.
 * - `long-superglobal-arrays`, `http-raw-post-data`: each read or write of
 *   the variable, in `global`, strings and heredocs too; a property, static
 *   property or parameter of that name, or an array key, is not a use.
 * - `string-dollar-brace`: `"${…}"` in a string or heredoc, never
 *   `"{${…}}"` (a variable variable in the complex syntax).
 * - `php4-constructor`: a method named as its class (no `__construct`, class
 *   outside any namespace), as `php-symbols.ts` reads PHP 4 constructors.
 * - `dynamic-property`: the first `$this->name = …` per name in a class that
 *   extends nothing, uses no trait, declares no `__set` and carries no
 *   `#[AllowDynamicProperties]`, when the class declares no such property.
 *   `likely`: a property can still be declared where no rule sees it.
 * - Constructs the grammar cannot parse are read from what parsing left:
 *   ASP tags (outside script elements: a `<%` in one is a JavaScript
 *   template) and `<script language="php">` from inline HTML. A curly-brace
 *   offset is usually rewritten to `$s[0]` before the parse
 *   (`php-legacy-syntax.ts`) and read from `PackSourceFile.rewrites`; one the
 *   rewrite missed is read from a statement ending in a MISSING token
 *   right before a `{`, or from an ERROR node's text (strings and comments
 *   skipped). php-corpus-report.mjs counts a file whose every parse error sits
 *   on a curly-offset line as legacy, not as a grammar failure.
 *
 * @module lang-php/php-legacy
 */

import { join } from "node:path";
import type { FactKind, FileFacts, LanguageBoundary, LegacyConstructFact, LegacyStatus, SourcePosition } from "@n-dx/lang-kit";
import { atOrBefore, contains, innermostEach, type Capture, type FrameworkContext, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { builtinReached, callCandidates, declaredFunctions } from "./php-namespaces.js";
import { phpVersionSource, phpVersionSourceName } from "./php-version-sources.js";

/** One removed, deprecated or changed construct, with the php.net page of every version it names. */
export interface PhpLegacyRule {
  /** The construct in words. */
  readonly construct: string;
  readonly deprecated?: LanguageBoundary;
  readonly removed?: LanguageBoundary;
  readonly changed?: LanguageBoundary;
  /** A review notice, never a removal; `source` is the page describing it. */
  readonly notice?: { readonly source: string };
  /** The rule sees only likely cases. */
  readonly likely?: true;
}

const MANUAL = "https://www.php.net/manual/en/";

/** A version and its page: the migration guide's `section` page, or the PHP 5 changelog anchor for 5.3 to 5.5 (`php-version-sources.ts`). */
const at = (version: string, section: string): LanguageBoundary => ({ version, source: phpVersionSource(version, section) });

/** Every rule, by id. */
export const LEGACY_RULES = {
  "call-time-pass-by-reference": { construct: "call-time pass-by-reference f(&$x)", removed: at("5.4", "incompatible") },
  "session-register": {
    construct: "session_register(), session_unregister() or session_is_registered()",
    deprecated: at("5.3", "deprecated"),
    removed: at("5.4", "incompatible"),
  },
  "import-request-variables": { construct: "import_request_variables()", removed: at("5.4", "incompatible") },
  "magic-quotes-runtime": {
    construct: "set_magic_quotes_runtime() or magic_quotes_runtime()",
    deprecated: at("5.3", "deprecated"),
    removed: at("7.0", "incompatible"),
  },
  "mysql-functions": { construct: "mysql_* function", deprecated: at("5.5", "deprecated"), removed: at("7.0", "removed-exts-sapis") },
  "ereg-functions": {
    construct: "ereg*, split, spliti or sql_regcase function",
    deprecated: at("5.3", "deprecated"),
    removed: at("7.0", "removed-exts-sapis"),
  },
  "asp-tags": { construct: "<% or <%= tag", removed: at("7.0", "incompatible") },
  "script-tags": { construct: "<script language=\"php\"> tag", removed: at("7.0", "incompatible") },
  "mcrypt-functions": { construct: "mcrypt_* function", deprecated: at("7.1", "deprecated"), removed: at("7.2", "other-changes") },
  "php4-constructor": { construct: "PHP 4 constructor (method named as its class)", deprecated: at("7.0", "deprecated"), removed: at("8.0", "incompatible") },
  "create-function": { construct: "create_function()", deprecated: at("7.2", "deprecated"), removed: at("8.0", "incompatible") },
  each: { construct: "each()", deprecated: at("7.2", "deprecated"), removed: at("8.0", "incompatible") },
  "unset-cast": { construct: "(unset) cast", deprecated: at("7.2", "deprecated"), removed: at("8.0", "incompatible") },
  "autoload-function": { construct: "__autoload()", deprecated: at("7.2", "deprecated"), removed: at("8.0", "incompatible") },
  "curly-offset": { construct: "curly-brace offset $s{0}", deprecated: at("7.4", "deprecated"), removed: at("8.0", "incompatible") },
  "get-magic-quotes": {
    construct: "get_magic_quotes_gpc() or get_magic_quotes_runtime()",
    deprecated: at("7.4", "deprecated"),
    removed: at("8.0", "incompatible"),
  },
  "string-dollar-brace": { construct: "${} string interpolation", deprecated: at("8.2", "deprecated") },
  "dynamic-property": { construct: "dynamic property creation", deprecated: at("8.2", "deprecated"), likely: true },
  "utf8-encode-decode": { construct: "utf8_encode() or utf8_decode()", deprecated: at("8.2", "deprecated") },
  "short-open-tag": { construct: "<? short open tag (needs short_open_tag)", notice: { source: `${MANUAL}ini.core.php#ini.short-open-tag` } },
  "string-number-comparison": {
    construct: "== between a non-numeric string and a number",
    changed: at("8.0", "incompatible"),
    notice: { source: `${MANUAL}migration80.incompatible.php` },
  },
  "long-superglobal-arrays": {
    construct: "$HTTP_GET_VARS, $HTTP_POST_VARS, $HTTP_COOKIE_VARS, $HTTP_SERVER_VARS, $HTTP_ENV_VARS, $HTTP_SESSION_VARS or $HTTP_POST_FILES",
    deprecated: at("5.3", "deprecated"),
    removed: at("5.4", "incompatible"),
  },
  "http-raw-post-data": {
    construct: "$HTTP_RAW_POST_DATA",
    deprecated: at("5.6", "deprecated"),
    removed: at("7.0", "incompatible"),
  },
} as const satisfies Record<string, PhpLegacyRule>;

export type PhpLegacyRuleId = keyof typeof LEGACY_RULES;

/** A rule's status: a notice, else removed when it has a removal, else deprecated. */
export function legacyStatus(rule: PhpLegacyRule): LegacyStatus {
  if (rule.notice !== undefined) return "notice";
  return rule.removed !== undefined ? "removed" : "deprecated";
}

/** Long superglobal variable names. */
const LONG_SUPERGLOBALS: ReadonlySet<string> = new Set([
  "$HTTP_GET_VARS",
  "$HTTP_POST_VARS",
  "$HTTP_COOKIE_VARS",
  "$HTTP_SERVER_VARS",
  "$HTTP_ENV_VARS",
  "$HTTP_SESSION_VARS",
  "$HTTP_POST_FILES",
]);

/** $HTTP_RAW_POST_DATA variable. */
const HTTP_RAW_POST_DATA = "$HTTP_RAW_POST_DATA";

/** Determine which rule a variable name matches, if any. */
function variableRule(name: string): PhpLegacyRuleId | undefined {
  if (LONG_SUPERGLOBALS.has(name)) return "long-superglobal-arrays";
  if (name === HTTP_RAW_POST_DATA) return "http-raw-post-data";
  return undefined;
}

/** Global functions by lower-cased name; prefixes after. */
const FUNCTIONS: ReadonlyMap<string, PhpLegacyRuleId> = new Map([
  ...["ereg", "eregi", "ereg_replace", "eregi_replace", "split", "spliti", "sql_regcase"].map((n) => [n, "ereg-functions"] as const),
  ...["session_register", "session_unregister", "session_is_registered"].map((n) => [n, "session-register"] as const),
  ["import_request_variables", "import-request-variables"],
  ["set_magic_quotes_runtime", "magic-quotes-runtime"],
  ["magic_quotes_runtime", "magic-quotes-runtime"],
  ["get_magic_quotes_gpc", "get-magic-quotes"],
  ["get_magic_quotes_runtime", "get-magic-quotes"],
  ["create_function", "create-function"],
  ["each", "each"],
  ["utf8_encode", "utf8-encode-decode"],
  ["utf8_decode", "utf8-encode-decode"],
]);
const FUNCTION_PREFIXES: readonly (readonly [string, PhpLegacyRuleId])[] = [
  ["mysql_", "mysql-functions"],
  ["mcrypt_", "mcrypt-functions"],
];

/** The rule a call of `name` (lower-cased, global) matches. */
function functionRule(name: string): PhpLegacyRuleId | undefined {
  return FUNCTIONS.get(name) ?? FUNCTION_PREFIXES.find(([prefix]) => name.startsWith(prefix) && name.length > prefix.length)?.[1];
}

/** A numeric string as PHP 8 reads one: whitespace, sign, digits, fraction, exponent, whitespace. */
const NUMERIC_STRING = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;

/** A deref an offset can follow (`$s`, `$a['k']`, `$o->p`), ending the text before a `{`. */
const OFFSET_BASE_END = /(\$[A-Za-z_\x80-￿][\w\x80-￿]*|\]|->\s*[A-Za-z_\x80-￿][\w\x80-￿]*)$/;
const OFFSET_BASE = /(\$[A-Za-z_\x80-￿][\w\x80-￿]*|\]|->\s*[A-Za-z_\x80-￿][\w\x80-￿]*)\{/g;

/** An ASP tag, a script element's start tag up to its `>` (which may sit in a later segment), or a script end tag. */
const ASP_OR_SCRIPT = /<%=?|<script\b[^>]*|<\/script\b/gi;
const PHP_LANGUAGE = /\blanguage\s*=\s*["']?php\b/i;
const SCRIPT_TAG = /<script\b[^>]*\blanguage\s*=\s*["']?php["']?[^>]*>/gi;

const QUERY = "legacy";
const PREFIX = "legacy.";

const samePosition = (a: SourcePosition, b: SourcePosition): boolean => a.line === b.line && a.column === b.column;

/** The position `offset` characters into a capture's text. */
function positionIn(capture: Capture, offset: number): SourcePosition {
  let { line, column } = capture.start;
  const text = capture.text;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      column = 0;
    } else column++;
  }
  return { line, column };
}

/**
 * `text` with quoted strings and comments blanked to spaces (newlines kept),
 * so offsets still line up. One linear pass.
 */
export function blankStringsAndComments(text: string): string {
  const out = [...text];
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      blank(i, Math.min(j + 1, text.length));
      i = j + 1;
    } else if (c === "#" || (c === "/" && text[i + 1] === "/")) {
      let j = text.indexOf("\n", i);
      if (j === -1) j = text.length;
      blank(i, j);
      i = j;
    } else if (c === "/" && text[i + 1] === "*") {
      let j = text.indexOf("*/", i + 2);
      j = j === -1 ? text.length : j + 2;
      blank(i, j);
      i = j;
    } else i++;
  }
  return out.join("");
}

/** One use a rule matched; `construct` names the use when it has a name of its own. */
export interface LegacyHit {
  readonly rule: PhpLegacyRuleId;
  readonly position: SourcePosition;
  readonly construct?: string;
}

/** True when the class spanning `cls` is in a namespace: inside a braced `namespace A { … }`, or after `namespace A;`. */
function namespaced(cls: Capture, namespaces: readonly Capture[], bodies: readonly Capture[]): boolean {
  return namespaces.some((ns) => (bodies.some((b) => contains(ns, b)) ? contains(ns, cls) : atOrBefore(ns.end, cls.start)));
}

/** PHP 4 constructors and likely dynamic properties, from a file's class captures. */
function classHits(by: ReadonlyMap<string, Capture[]>): LegacyHit[] {
  const get = (name: string) => by.get(name) ?? [];
  const classes = get("class");
  if (classes.length === 0) return [];
  // Anonymous classes own what they hold, so it never reaches an outer class.
  const owners = [...classes, ...get("anonymous-class")];
  const ownerOf = (captured: readonly Capture[]) => {
    const owned = innermostEach(owners, captured);
    return (cls: Capture) => captured.filter((_, i) => owned[i] === cls);
  };
  const names = ownerOf(get("class-name"));
  const methods = ownerOf(get("method"));
  const properties = ownerOf(get("property"));
  const assigns = ownerOf(get("this-assign"));
  const extend = ownerOf(get("class-extends"));
  const traits = ownerOf(get("class-trait"));
  const attributes = ownerOf(get("class-attributes"));
  const namespaces = get("namespace");
  const bodies = get("namespace-body");

  const hits: LegacyHit[] = [];
  for (const cls of classes) {
    const name = names(cls)[0]?.text;
    if (name === undefined) continue;
    const declared = methods(cls);
    const lower = new Set(declared.map((m) => m.text.toLowerCase()));
    if (!lower.has("__construct") && !namespaced(cls, namespaces, bodies)) {
      const ctor = declared.find((m) => m.text.toLowerCase() === name.toLowerCase());
      if (ctor !== undefined) hits.push({ rule: "php4-constructor", position: ctor.start, construct: `PHP 4 constructor ${name}::${ctor.text}()` });
    }
    const open =
      extend(cls).length === 0 &&
      traits(cls).length === 0 &&
      !lower.has("__set") &&
      !attributes(cls).some((a) => /\bAllowDynamicProperties\b/i.test(a.text));
    if (!open) continue;
    const known = new Set(properties(cls).map((p) => p.text));
    for (const assign of assigns(cls)) {
      if (known.has(assign.text)) continue;
      known.add(assign.text);
      hits.push({ rule: "dynamic-property", position: assign.start, construct: `dynamic property ${name}::$${assign.text}` });
    }
  }
  return hits;
}

/**
 * Curly-brace offsets: those rewritten before the parse (`php-legacy-syntax.ts`),
 * then, in a file still parsed with errors, a MISSING-ended statement right
 * before a `{` and offsets inside ERROR text. Each position counts once.
 */
function curlyOffsetHits(by: ReadonlyMap<string, Capture[]>, rewrites: PackSourceFile["rewrites"] = []): LegacyHit[] {
  const seen: SourcePosition[] = [];
  const hit = (position: SourcePosition) => {
    if (!seen.some((p) => samePosition(p, position))) seen.push(position);
  };
  for (const r of rewrites) if (r.construct === "brace-offset") hit(r.position);
  const bases = by.get("brace-base") ?? [];
  const opens = by.get("brace-open") ?? [];
  for (const base of bases) {
    const open = opens.find((o) => samePosition(o.start, base.end));
    if (open !== undefined && OFFSET_BASE_END.test(base.text)) hit(open.start);
  }
  for (const error of by.get("error") ?? []) {
    const text = blankStringsAndComments(error.text);
    for (const match of text.matchAll(OFFSET_BASE)) hit(positionIn(error, match.index + match[0].length - 1));
  }
  return seen.map((position) => ({ rule: "curly-offset" as const, position }));
}

/**
 * ASP tags and `<script language="php">` in a file's inline-HTML segments.
 * A `<%` inside a script element that is not `language="php"` is a
 * JavaScript template (Underscore, EJS), never PHP, so it is skipped; the
 * element is tracked across segments in document order, since PHP blocks can
 * split one.
 */
function inlineHtmlHits(segments: readonly Capture[]): LegacyHit[] {
  const hits: LegacyHit[] = [];
  let inScript = false;
  const ordered = [...segments].sort((a, b) => a.start.line - b.start.line || a.start.column - b.start.column);
  for (const html of ordered) {
    for (const m of html.text.matchAll(ASP_OR_SCRIPT)) {
      const token = m[0].toLowerCase();
      if (token.startsWith("</")) inScript = false;
      else if (token.startsWith("<s")) inScript ||= !PHP_LANGUAGE.test(m[0]);
      else if (!inScript) hits.push({ rule: "asp-tags", position: positionIn(html, m.index), construct: `${m[0]} tag` });
    }
    for (const m of html.text.matchAll(SCRIPT_TAG)) hits.push({ rule: "script-tags", position: positionIn(html, m.index) });
  }
  return hits;
}

/** A call that reaches a legacy built-in unless the repository declares one of its candidates ({@link callCandidates}). */
interface LegacyCall {
  readonly candidates: readonly string[];
  readonly position: SourcePosition;
}

/**
 * What {@link legacyHits} needs from one file's `legacy` captures, read as
 * the file is parsed (`FrameworkPack.digest`), so those captures need not
 * outlive it: the calls that may reach a legacy built-in, which only the
 * repository's declared functions settle, and every other hit.
 */
export interface LegacyDigest {
  readonly calls: readonly LegacyCall[];
  readonly hits: readonly LegacyHit[];
}

/** One file's {@link LegacyDigest}, from its captures alone. */
export function digestLegacy(file: PackSourceFile): LegacyDigest {
  const by = new Map<string, Capture[]>();
  for (const capture of file.captures[QUERY] ?? []) {
    const name = capture.name.slice(PREFIX.length);
    let list = by.get(name);
    if (list === undefined) by.set(name, (list = []));
    list.push(capture);
  }
  const calls: LegacyCall[] = [];
  const called = by.get("call") ?? [];
  if (called.length > 0) {
    const candidatesOf = callCandidates(file);
    for (const call of called) {
      const candidates = candidatesOf(call);
      // The built-in a call reaches is its last candidate (builtinReached): one no rule names is no hit, declared or not.
      const reached = candidates?.[candidates.length - 1];
      if (reached !== undefined && !reached.includes("\\") && functionRule(reached.toLowerCase()) !== undefined) calls.push({ candidates: candidates!, position: call.start });
    }
  }
  const hits: LegacyHit[] = [];
  for (const fn of by.get("function") ?? []) {
    if (fn.text.toLowerCase() === "__autoload") hits.push({ rule: "autoload-function", position: fn.start });
  }
  for (const c of by.get("call-time-reference") ?? []) hits.push({ rule: "call-time-pass-by-reference", position: c.start });
  for (const c of by.get("cast") ?? []) if (c.text.toLowerCase() === "unset") hits.push({ rule: "unset-cast", position: c.start });
  const braced = by.get("string-braced-variable") ?? [];
  for (const c of by.get("string-dollar-brace") ?? []) {
    if (!braced.some((b) => samePosition(b.start, c.start))) hits.push({ rule: "string-dollar-brace", position: c.start });
  }
  for (const c of by.get("php-tag") ?? []) if (c.text === "<?") hits.push({ rule: "short-open-tag", position: c.start });
  for (const c of by.get("compare-string") ?? []) {
    if (c.nodeType === "encapsed_string" && c.text.includes("$")) continue;
    if (!NUMERIC_STRING.test(c.text.slice(1, -1))) hits.push({ rule: "string-number-comparison", position: c.start });
  }
  const declarations = by.get("superglobal-declaration") ?? [];
  for (const v of by.get("superglobal-variable") ?? []) {
    const rule = variableRule(v.text);
    if (rule !== undefined && !declarations.some((d) => samePosition(d.start, v.start))) hits.push({ rule, position: v.start, construct: v.text });
  }

  hits.push(...inlineHtmlHits(by.get("inline-html") ?? []));
  hits.push(...classHits(by), ...curlyOffsetHits(by, file.rewrites));
  return { calls, hits };
}

/** Every rule a file matches, from its digest. `declared` holds the functions the repository declares ({@link declaredFunctions}). */
export function legacyHits(file: PackSourceFile | LegacyDigest, declared: ReadonlySet<string> = new Set()): LegacyHit[] {
  const digest = "captures" in file ? digestLegacy(file) : file;
  const hits: LegacyHit[] = [];
  for (const { candidates, position } of digest.calls) {
    const name = builtinReached(candidates, declared);
    const rule = name === undefined ? undefined : functionRule(name.toLowerCase());
    if (rule !== undefined) hits.push({ rule, position, construct: `${name}()` });
  }
  // Stable: calls first, then the rest, each in capture order, as one pass read them.
  return [...hits, ...digest.hits].sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column);
}

/** The page behind a rule's status: the notice's page, else the removal's, else the deprecation's. */
export function legacySource(rule: PhpLegacyRule): string {
  const page = rule.notice?.source ?? (rule.removed ?? rule.deprecated)?.source;
  if (page === undefined) throw new Error(`PHP legacy rule "${rule.construct}" cites no page`);
  return page;
}

/** A hit as lang-kit's fact. */
export function legacyFact(hit: LegacyHit): LegacyConstructFact {
  const rule: PhpLegacyRule = LEGACY_RULES[hit.rule];
  const status = legacyStatus(rule);
  const source = legacySource(rule);
  return {
    rule: hit.rule,
    construct: hit.construct ?? rule.construct,
    status,
    ...(rule.deprecated === undefined ? {} : { deprecated: rule.deprecated }),
    ...(rule.removed === undefined ? {} : { removed: rule.removed }),
    ...(rule.changed === undefined ? {} : { changed: rule.changed }),
    source,
    ...(rule.likely === undefined ? {} : { likely: true as const }),
    position: hit.position,
  };
}

const GRAMMAR = "tree-sitter-php@0.25.1";

/** The documents a rule's versions cite, each once (`PHP 7.2 migration guide`, `PHP 5 changelog`); the PHP manual for a notice with no version. */
export function legacyDocuments(rule: PhpLegacyRule): string[] {
  const names = [rule.deprecated, rule.removed, rule.changed].flatMap((b) => (b === undefined ? [] : [phpVersionSourceName(b.version)]));
  return names.length === 0 ? ["PHP manual"] : [...new Set(names)];
}

/** Each rule's provenance is the page behind its status; the query was checked against the grammar's node types. */
const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [QUERY]: {
    verifiedAgainst: [GRAMMAR],
    verifiedOn: "2026-11-16",
    source: "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json",
  },
  ...Object.fromEntries(
    Object.entries(LEGACY_RULES).map(([id, r]: [string, PhpLegacyRule]) => [
      id,
      { verifiedAgainst: [GRAMMAR, ...legacyDocuments(r)], verifiedOn: "2026-11-16", source: legacySource(r) },
    ]),
  ),
};

export const phpLegacy: FrameworkPack<LegacyDigest> = {
  id: "php-legacy",
  produces: ["legacyConstructs"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: QUERY, path: join(PHP_PACKAGE.queryDir("php-legacy"), `${QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  digest: digestLegacy,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], _context?: FrameworkContext, digests?: ReadonlyMap<string, LegacyDigest>): FrameworkFacts {
    const facts = new Map<string, Omit<FileFacts, "path">>();
    if (!kinds.includes("legacyConstructs")) return { facts, notices: [] };
    const declared = declaredFunctions(files);
    for (const file of files) {
      const digest = digests === undefined ? file : digests.get(file.path);
      if (digest === undefined) continue;
      const hits = legacyHits(digest, declared);
      if (hits.length > 0) facts.set(file.path, { legacyConstructs: hits.map(legacyFact) });
    }
    return { facts, notices: [] };
  },
};
