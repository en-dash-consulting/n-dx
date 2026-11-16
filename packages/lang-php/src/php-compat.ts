/**
 * The observed-syntax version floor over the PHP pack: per file, the oldest
 * PHP version whose syntax covers every construct the file uses, as
 * lang-kit's `VersionFloorFact`.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-compat/compat.scm`) runs in the PHP parse only when the
 * version floor is wanted. Each rule in {@link SYNTAX_RULES} dates one
 * construct by the php.net migration guide page that introduces it (its
 * `source`); no version comes from anywhere else. A file's floor is the
 * highest version of any rule it matches, with the first use of the construct
 * that set it (the earliest rule hit at that version). A file matching no rule
 * gets no floor: it uses nothing a rule dates.
 *
 * Most rules are one capture named `@compat.<rule>`. Read here:
 *
 * - type keywords (`@compat.primitive-type`, a keyword type or a named
 *   type's name, since the grammar takes `INT` or `String` for a class name)
 *   by name, in any case, as PHP reads them: `int`, `float`, `string`, `bool`
 *   are scalar type declarations (7.0), `void` and `iterable` 7.1, `object`
 *   7.2, `mixed` 8.0; any other name (`array`, `callable`, `null`, a class)
 *   dates nothing here.
 * - `$this` in a closure: a `$this` whose innermost enclosing body is a
 *   closure's, not a function's or a method's.
 * - flexible heredoc: a heredoc or nowdoc closing marker that is indented.
 *
 * Syntax only: what a file calls (functions, classes, extensions) and how
 * PHP is configured play no part, so a file may need a newer PHP than its
 * floor. A construct PHP never parsed before its version can still sit in a
 * file a later version reads, so the floor is a lower bound, never a claim
 * the file runs there.
 *
 * @module lang-php/php-compat
 */

import { join } from "node:path";
import { compareLanguageVersions, type FactKind, type FileFacts, type SourcePosition, type VersionFloorFact } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";

/** One construct and the PHP version that introduced it. */
export interface PhpSyntaxRule {
  /** `major.minor`. */
  readonly version: string;
  /** The construct in words. */
  readonly construct: string;
  /** The php.net migration guide page listing it among that version's new features. */
  readonly source: string;
}

const guide = (version: string): string => `https://www.php.net/manual/en/migration${version.replace(".", "")}.new-features.php`;

const rule = (version: string, construct: string): PhpSyntaxRule => ({ version, construct, source: guide(version) });

/** Every rule, by id, oldest version first. */
export const SYNTAX_RULES = {
  // PHP 5.3
  namespaces: rule("5.3", "namespace"),
  closures: rule("5.3", "closure"),
  "dir-constant": rule("5.3", "__DIR__"),
  "late-static-binding": rule("5.3", "static:: or new static"),
  goto: rule("5.3", "goto"),
  nowdoc: rule("5.3", "nowdoc"),
  "short-ternary": rule("5.3", "?: operator"),
  // PHP 5.4
  traits: rule("5.4", "trait"),
  "short-array": rule("5.4", "short array syntax []"),
  "this-in-closures": rule("5.4", "$this in a closure"),
  "short-echo-tag": rule("5.4", "<?= tag"),
  "instantiation-access": rule("5.4", "member access on instantiation (new X)->m()"),
  // PHP 5.5
  generators: rule("5.5", "generator (yield)"),
  finally: rule("5.5", "finally"),
  "class-name-resolution": rule("5.5", "::class"),
  "foreach-list": rule("5.5", "list() in foreach"),
  // PHP 5.6
  variadics: rule("5.6", "variadic parameter ..."),
  "argument-unpacking": rule("5.6", "argument unpacking ..."),
  exponentiation: rule("5.6", "** operator"),
  "use-function-const": rule("5.6", "use function or use const"),
  "constant-expressions": rule("5.6", "constant expression"),
  // PHP 7.0
  "scalar-type-declarations": rule("7.0", "scalar type declaration"),
  "return-types": rule("7.0", "return type declaration"),
  "null-coalescing": rule("7.0", "?? operator"),
  spaceship: rule("7.0", "<=> operator"),
  "anonymous-classes": rule("7.0", "anonymous class"),
  "group-use": rule("7.0", "group use declaration"),
  // PHP 7.1
  "nullable-types": rule("7.1", "nullable type"),
  "void-type": rule("7.1", "void return type"),
  "iterable-type": rule("7.1", "iterable type"),
  "short-list": rule("7.1", "[a, b] destructuring"),
  "class-constant-visibility": rule("7.1", "class constant visibility"),
  "multi-catch": rule("7.1", "multi-catch"),
  // PHP 7.2
  "object-type": rule("7.2", "object type"),
  // PHP 7.3
  "trailing-comma-in-calls": rule("7.3", "trailing comma in a call"),
  "flexible-heredoc": rule("7.3", "indented heredoc or nowdoc closing marker"),
  // PHP 7.4
  "typed-properties": rule("7.4", "typed property"),
  "arrow-functions": rule("7.4", "arrow function"),
  "null-coalescing-assignment": rule("7.4", "??= operator"),
  "array-spread": rule("7.4", "spread in an array"),
  // PHP 8.0
  match: rule("8.0", "match"),
  attributes: rule("8.0", "attribute"),
  "named-arguments": rule("8.0", "named argument"),
  nullsafe: rule("8.0", "?-> operator"),
  "union-types": rule("8.0", "union type"),
  "constructor-promotion": rule("8.0", "constructor property promotion"),
  "mixed-type": rule("8.0", "mixed type"),
  "static-return-type": rule("8.0", "static return type"),
  // PHP 8.1
  enums: rule("8.1", "enum"),
  "readonly-properties": rule("8.1", "readonly property"),
  "never-type": rule("8.1", "never return type"),
  "first-class-callables": rule("8.1", "first-class callable f(...)"),
  "new-in-initializers": rule("8.1", "new in an initializer"),
  "intersection-types": rule("8.1", "intersection type"),
  // PHP 8.2
  "readonly-classes": rule("8.2", "readonly class"),
  "dnf-types": rule("8.2", "DNF type"),
  // PHP 8.3
  "typed-class-constants": rule("8.3", "typed class constant"),
} as const satisfies Record<string, PhpSyntaxRule>;

export type PhpSyntaxRuleId = keyof typeof SYNTAX_RULES;

const COMPAT_QUERY = "compat";
const PREFIX = "compat.";

/** Type keywords, lower-cased, and the rule each sets. */
const TYPE_KEYWORDS: ReadonlyMap<string, PhpSyntaxRuleId> = new Map([
  ["int", "scalar-type-declarations"],
  ["float", "scalar-type-declarations"],
  ["string", "scalar-type-declarations"],
  ["bool", "scalar-type-declarations"],
  ["void", "void-type"],
  ["iterable", "iterable-type"],
  ["object", "object-type"],
  ["mixed", "mixed-type"],
]);

const isRule = (id: string): id is PhpSyntaxRuleId => Object.hasOwn(SYNTAX_RULES, id);

const before = (a: SourcePosition, b: SourcePosition): number => a.line - b.line || a.column - b.column;

/** Every rule a file's captures match, each at the capture's start. */
export function syntaxHits(file: PackSourceFile): { readonly rule: PhpSyntaxRuleId; readonly position: SourcePosition }[] {
  const captures = file.captures[COMPAT_QUERY] ?? [];
  const hits: { rule: PhpSyntaxRuleId; position: SourcePosition }[] = [];
  const thisReads: Capture[] = [];
  const bodies: Capture[] = [];
  for (const capture of captures) {
    const name = capture.name.slice(PREFIX.length);
    if (isRule(name)) hits.push({ rule: name, position: capture.start });
    else if (name === "primitive-type") {
      const id = TYPE_KEYWORDS.get(capture.text.toLowerCase());
      if (id !== undefined) hits.push({ rule: id, position: capture.start });
    } else if (name === "heredoc-end") {
      if (capture.start.column > 0) hits.push({ rule: "flexible-heredoc", position: capture.start });
    } else if (name === "this") thisReads.push(capture);
    else if (name === "closure-body" || name === "function-body") bodies.push(capture);
  }
  innermostEach(bodies, thisReads).forEach((body, i) => {
    if (body?.name === `${PREFIX}closure-body`) hits.push({ rule: "this-in-closures", position: thisReads[i]!.start });
  });
  return hits;
}

/** A file's version floor, or undefined when it matches no rule. */
export function versionFloor(file: PackSourceFile): VersionFloorFact | undefined {
  let best: { rule: PhpSyntaxRuleId; position: SourcePosition } | undefined;
  for (const hit of syntaxHits(file)) {
    const order = best === undefined ? 1 : compareLanguageVersions(SYNTAX_RULES[hit.rule].version, SYNTAX_RULES[best.rule].version);
    if (order > 0 || (order === 0 && before(hit.position, best!.position) < 0)) best = hit;
  }
  if (best === undefined) return undefined;
  const { version, construct, source } = SYNTAX_RULES[best.rule];
  return { version, rule: best.rule, construct, source, position: best.position };
}

const GRAMMAR = "tree-sitter-php@0.25.1";

/** Each rule's provenance is its php.net page; the query was checked against the grammar's node types. */
const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [COMPAT_QUERY]: {
    verifiedAgainst: [GRAMMAR],
    verifiedOn: "2026-11-16",
    source: "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json",
  },
  ...Object.fromEntries(
    Object.entries(SYNTAX_RULES).map(([id, r]) => [id, { verifiedAgainst: [GRAMMAR, `PHP ${r.version} migration guide`], verifiedOn: "2026-11-16", source: r.source }]),
  ),
};

export const phpCompat: FrameworkPack = {
  id: "php-compat",
  produces: ["versionFloor"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: COMPAT_QUERY, path: join(PHP_PACKAGE.queryDir("php-compat"), `${COMPAT_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts {
    const facts = new Map<string, Omit<FileFacts, "path">>();
    if (!kinds.includes("versionFloor")) return { facts, notices: [] };
    for (const file of files) {
      const floor = versionFloor(file);
      if (floor !== undefined) facts.set(file.path, { versionFloor: floor });
    }
    return { facts, notices: [] };
  },
};
