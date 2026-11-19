/**
 * Config reads and feature-flag checks over the PHP pack: lang-kit's
 * `ConfigReadFact` and `FlagCheckFact`. Names, keys, files and positions
 * only: no value is ever copied out of the code.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-config/config.scm`) runs in the PHP parse only when config
 * reads or flag checks are wanted, and these rules read its captures with the
 * PHP queries' `imports`, `guards` and `references`, and the resolved
 * includes through the framework context. Rules (keys of {@link PROVENANCE}):
 *
 * Flag checks. A check is in a condition when it sits in an `if`, `elseif`,
 * ternary or `match` condition and not inside a call's arguments (`isset`
 * and `empty` only test theirs, so they do not count); `gated` is then the
 * lines the condition controls: an `if` from its body to its end (`else`
 * included), an `elseif` from its body to the end of its `if`, a ternary from
 * its condition's last line to its end, a `match` its arms.
 *
 * - `constant` (mechanism `constant`), in a condition only: a constant read
 *   alone, negated or as an operand whose name is flag-like
 *   ({@link isFlagName}: `FEATURE_*`, `FF_*`, `ENABLE_*`, `*_ENABLED`) or
 *   that the repository defines with a boolean literal (`define`, `const`),
 *   and `defined('X')` of a flag-like name (not of any boolean constant:
 *   `if (!defined('IN_APP')) exit;` is an include guard, not a flag).
 * - `config-flags` (mechanism `config`), in a condition only: a subscript of a
 *   configuration array ({@link CONFIG_NAMES}: `$config['features']['x']`,
 *   `$this->config['feature_x']`) or a registry read (`Config::get('a.b')`,
 *   `Configure::read`, Laravel's `config('a.b')`, `->item('x')` (CodeIgniter),
 *   `->get`/`->read` on a configuration receiver) whose dotted key contains
 *   `feature`, `flag` or `enable`; the name is the dotted key.
 * - `helpers` (mechanism `function`), anywhere: `isEnabled('x')`,
 *   `feature('x')`, `isFeatureEnabled('x')`, and `->isEnabled('x')`,
 *   `->isFeatureEnabled('x')` and `->isActive('x')` on any other receiver,
 *   with a literal name; client the function, or `->method`.
 * - `sdk` (mechanism `sdk`), anywhere: in a file that imports or constructs a
 *   class of the SDK's namespace ({@link FLAG_SDKS}), LaunchDarkly's
 *   `->variation('key', …)`, Unleash's `->isEnabled('key')` and Flagsmith's
 *   `->isFeatureEnabled('key')`, with a literal key; client the SDK.
 * - `env-flags` (mechanism `env`), in a condition only: `getenv('X')`,
 *   `$_ENV['X']` and `$_SERVER['X']` of a flag-like name; client the reader.
 *
 * Config reads (`ConfigReadFact`).
 *
 * - `config-files` (source `file`): a settings file is one whose top level
 *   is `return [ … ];` (keys of the returned array) or that assigns
 *   `$config[…]`, `$conf[…]`, `$cfg[…]` or `$settings[…]` outside any
 *   function body (the subscript's keys, and those of an array assigned to
 *   it; inside a function the array is a local). Each leaf key, dotted, is a
 *   read in the file itself with `sourceFile` the file. A file reading a
 *   configuration array ({@link CONFIG_ARRAYS}, or a variable assigned an
 *   include) reads from the settings files it includes (resolved include
 *   edges, the host-selected candidates below, and itself) that hold the key
 *   or a key below or above it, `sourceFile` each; else from no known file,
 *   source `unknown`.
 * - `registry`: a registry read (as above, any key) is from the one settings
 *   file of the project that holds its key (`a.b` also as key `b` of a
 *   `…/a.php` returning an array, Laravel's layout); otherwise `unknown`.
 * - `loaders` (source `ini`, `yaml`, `xml`): `parse_ini_file`,
 *   `yaml_parse_file`, `Yaml::parseFile` and `simplexml_load_file` with a
 *   computable path (as an include's: literals, constants, `__DIR__`; a
 *   relative path against the file's directory) give key `*`, the whole file,
 *   and each subscript read of a variable assigned the load gives its keys,
 *   `sourceFile` the loaded file.
 * - `define` (source `define`): `define('NAME', …)` in a settings file, a
 *   host-selected file or a file whose name or directory says configuration
 *   ({@link isConfigPath}) is a read in that file; each read of the constant
 *   anywhere is a read from it.
 * - `host-config` (source `file`): an include that chooses its file by the
 *   request's host name (`[php-host-include]`, `php-include-notices.ts`) reads
 *   key `*` from each of its candidate files, which become settings files;
 *   a `[php-host-include]` notice counts them.
 *
 * Environment reads stay outbound calls (`php-outbound.ts`): they are not
 * repeated as config reads.
 *
 * @module lang-php/php-config
 */

import { join } from "node:path";
import { normalizeFlagName, type ConfigReadFact, type ConfigSource, type FactKind, type FileFacts, type FlagCheckFact, type LineRange, type SourcePosition } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type FrameworkContext, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { before, scopeAt } from "./php-assignments.js";
import { hostReader, PHP_HOST_INCLUDE } from "./php-include-notices.js";
import { evaluatePath, isInclude, owned, repositoryConstants, repositoryPath, type ConstantLookup } from "./php-includes.js";
import { CONFIG_NAMES, configSubscript, envKey } from "./php-outbound.js";
import { readPhpReferences } from "./php-resolver.js";

export const CONFIG_QUERY = "config";

// ── Provenance ──────────────────────────────────────────────────────────────

const rule = (verifiedAgainst: readonly string[], source: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-11-16", source });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [CONFIG_QUERY]: rule(["tree-sitter-php@0.25.1"], "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json"),
  // if / elseif / else, the alternative syntax, the ternary and match.
  conditions: rule(["PHP manual"], "https://www.php.net/manual/en/control-structures.elseif.php"),
  // defined(string $constant_name): whether a constant exists.
  constant: rule(["PHP manual"], "https://www.php.net/manual/en/function.defined.php"),
  // isset() and empty() are language constructs that test, not read, their argument.
  "config-flags": rule(["PHP manual"], "https://www.php.net/manual/en/function.isset.php"),
  helpers: rule(["n-dx task efa70788"], "https://www.php.net/manual/en/functions.user-defined.php"),
  // LDClient::variation($flagKey, $context, $defaultValue); Unleash::isEnabled($featureName); Flags::isFeatureEnabled($featureName).
  sdk: rule(["LaunchDarkly php-server-sdk", "unleash-client-php", "flagsmith-php-client"], "https://github.com/launchdarkly/php-server-sdk"),
  // getenv(?string $name); $_ENV.
  "env-flags": rule(["PHP manual"], "https://www.php.net/manual/en/function.getenv.php"),
  // An included file's `return` value is the include's value.
  "config-files": rule(["PHP manual"], "https://www.php.net/manual/en/function.include.php"),
  // config('app.name') reads key `name` of config/app.php; CodeIgniter's $this->config->item('x') reads $config['x'].
  registry: rule(["Laravel 11", "CodeIgniter 3"], "https://laravel.com/docs/11.x/configuration#accessing-configuration-values"),
  // parse_ini_file, yaml_parse_file, simplexml_load_file; Symfony's Yaml::parseFile.
  loaders: rule(["PHP manual", "Symfony Yaml"], "https://www.php.net/manual/en/function.parse-ini-file.php"),
  // define(string $constant_name, mixed $value).
  define: rule(["PHP manual"], "https://www.php.net/manual/en/function.define.php"),
  "host-config": rule(["n-dx php-host-include"], "https://www.php.net/manual/en/reserved.variables.server.php"),
};

// ── Names ───────────────────────────────────────────────────────────────────

/** Whether a constant or environment variable is named as a flag: `FEATURE_*`, `FF_*`, `ENABLE_*`, `*_ENABLED`. */
export const isFlagName = (name: string): boolean => /^(?:FEATURE|FF|ENABLE)_\w+$|^\w+_ENABLED$/i.test(name);

/** Whether a configuration key path names a flag. */
export const isFlagKey = (key: string): boolean => /feature|flag|enable/i.test(key);

/** The arrays a configuration read is taken from, compared in lowercase. */
export const CONFIG_ARRAYS: ReadonlySet<string> = new Set(["config", "conf", "cfg", "configuration", "settings"]);

/** The arrays whose assignment makes a settings file. */
const DEFINING_ARRAYS: ReadonlySet<string> = new Set(["config", "conf", "cfg", "settings"]);

/** Whether a path's name or a directory says configuration: `config.php`, `includes/configure.php`, `config/app.php`. */
export function isConfigPath(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  const base = segments.pop()!.replace(/\.[^.]*$/, "");
  return (
    /^(?:config|configure|configuration|conf|settings|defines?|constants)(?:[._-].*)?$/.test(base) ||
    segments.some((s) => s === "config" || s === "configs" || s === "conf" || s === "settings")
  );
}

/** Flag SDKs by namespace prefix (lowercase, with its `\`): the client name and the method that checks a flag. */
export const FLAG_SDKS: ReadonlyArray<{ readonly namespace: string; readonly client: string; readonly method: string }> = [
  { namespace: "launchdarkly\\", client: "LaunchDarkly", method: "variation" },
  { namespace: "unleash\\client\\", client: "Unleash", method: "isenabled" },
  { namespace: "flagsmith\\", client: "Flagsmith", method: "isfeatureenabled" },
];

const HELPER_FUNCTIONS: ReadonlySet<string> = new Set(["isenabled", "feature", "isfeatureenabled"]);
const HELPER_METHODS: ReadonlySet<string> = new Set(["isenabled", "isfeatureenabled", "isactive"]);
/** Calls that test their arguments rather than take them as input. */
const TESTING_CALLS: ReadonlySet<string> = new Set(["isset", "empty"]);
const REGISTRY_CLASSES: ReadonlySet<string> = new Set(["config", "configure"]);
const LOADERS: Readonly<Record<string, ConfigSource>> = { parse_ini_file: "ini", yaml_parse_file: "yaml", simplexml_load_file: "xml" };

/** A plain single- or double-quoted string's content; undefined for anything else. */
function literal(text: string | undefined): string | undefined {
  const m = text === undefined ? null : /^\s*(?:'([^'\\]*)'|"([^"\\$]*)")\s*$/.exec(text);
  return m ? (m[1] ?? m[2])! : undefined;
}

/** The last segment of a class name as written, lowercase: `config` for `\Illuminate\Support\Facades\Config`. */
const lastSegment = (name: string): string => name.slice(name.lastIndexOf("\\") + 1).toLowerCase();

/** The last identifier of a receiver as written: `config` in `$this->config`. */
const receiverName = (text: string): string => (/(\w+)\s*$/.exec(text)?.[1] ?? "").toLowerCase();

// ── Spans ───────────────────────────────────────────────────────────────────

const spanKey = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;
const samePosition = (a: SourcePosition, b: SourcePosition): boolean => a.line === b.line && a.column === b.column;
const byPosition = (a: SourcePosition, b: SourcePosition): number => (before(a, b) ? -1 : before(b, a) ? 1 : 0);

/** Each part paired with its strictly innermost owner, by owner span. */
function partsByOwner(owners: readonly Capture[], parts: readonly Capture[]): Map<string, Capture[]> {
  const out = new Map<string, Capture[]>();
  innermostEach(owners, parts, true).forEach((owner, i) => {
    if (!owner) return;
    const list = out.get(spanKey(owner)) ?? [];
    list.push(parts[i]!);
    out.set(spanKey(owner), list);
  });
  return out;
}

const firstNamed = (parts: readonly Capture[] | undefined, name: string): Capture | undefined =>
  parts?.filter((c) => c.name === name).sort((a, b) => byPosition(a.start, b.start))[0];

// ── One file's captures ─────────────────────────────────────────────────────

/** A condition and the lines it controls. */
interface Condition {
  readonly gated?: LineRange;
}

interface Call {
  readonly node: Capture;
  /** Lowercase, without a leading `\`. */
  readonly function?: string;
  readonly receiver?: string;
  /** Lowercase. */
  readonly method?: string;
  /** The function or method name as written, without a leading `\`. */
  readonly written?: string;
  readonly scope?: string;
  readonly staticMethod?: string;
  readonly argument?: Capture;
}

/** A settings key a file holds, dotted, with where it is written. */
interface DefinedKey {
  readonly key: string;
  readonly position: SourcePosition;
}

/** What a variable was assigned: an include's value, or a settings file a loader read. */
type Bound = { readonly kind: "include" } | ({ readonly kind: "load" } & Load);

/** A loader call's source and file. */
interface Load {
  readonly source: ConfigSource;
  readonly sourceFile: string;
}

/** A settings loader call's source and its path argument as written. */
interface Loader {
  readonly source: ConfigSource;
  readonly path: string;
}

/**
 * An assignment to a variable, in document order: an include's value, or the
 * value of the call at `call` in {@link ConfigDigest.calls}, a settings loader
 * whose file is known only once the repository's constants are.
 */
type BoundStep = { readonly name: string; readonly kind: "include" } | { readonly name: string; readonly kind: "load"; readonly call: number };

/** A constant name or a subscript read, and the condition it is checked in. */
interface Checked {
  readonly text: string;
  readonly start: SourcePosition;
  readonly condition?: Condition;
}

/** A call as the read needs it. */
interface DigestCall {
  readonly at: SourcePosition;
  readonly condition?: Condition;
  /** Lowercase, without a leading `\`. */
  readonly function?: string;
  /** Lowercase. */
  readonly method?: string;
  /** The function or method name as written, without a leading `\`. */
  readonly written?: string;
  /** The first argument's content, when it is a plain string. */
  readonly argument?: string;
  /** `getenv`'s variable ({@link envKey}). */
  readonly envKey?: string;
  readonly registryKey?: string;
  readonly loader?: Loader;
}

/**
 * What {@link readConfigFacts} needs from one file's `config` captures, read
 * as the file is parsed (`FrameworkPack.digest`), so those captures need not
 * outlive it. What the read resolves through the repository is kept as
 * written: a loader's path (the repository's constants), constant names
 * (boolean and config-file constants), registry keys and subscript reads (the
 * settings files, found through the resolver's context).
 */
export interface ConfigDigest {
  readonly keys: readonly DefinedKey[];
  readonly names: readonly Checked[];
  readonly calls: readonly DigestCall[];
  /** Outermost subscript reads, writes excluded, their text trimmed. */
  readonly reads: readonly Checked[];
  readonly bound: readonly BoundStep[];
  /** The flag SDKs whose classes the file references, when it calls a method. */
  readonly sdks: readonly (typeof FLAG_SDKS)[number][];
}

const EMPTY_DIGEST: ConfigDigest = { keys: [], names: [], calls: [], reads: [], bound: [], sdks: [] };

/** One file's {@link ConfigDigest}, from its captures alone. */
export function digestConfig(file: PackSourceFile): ConfigDigest {
  const scan = new FileScan(file);
  const checked = (nodes: readonly Capture[], text: (node: Capture) => string): Checked[] => {
    const conditions = scan.conditionsOf(nodes);
    return nodes.map((node, i) => ({ text: text(node), start: node.start, ...(conditions[i] && { condition: conditions[i] }) }));
  };
  const sdks = new Set<(typeof FLAG_SDKS)[number]>();
  if (scan.calls.some((c) => c.method !== undefined)) {
    for (const ref of readPhpReferences(file)) {
      const qualified = ref.qualified.toLowerCase();
      for (const sdk of FLAG_SDKS) if (qualified.startsWith(sdk.namespace)) sdks.add(sdk);
    }
  }
  const callConditions = scan.conditionsOf(scan.calls.map((c) => c.node));
  const calls = scan.calls.map((call, i): DigestCall => {
    const argument = literal(call.argument?.text);
    const envKeyOf = call.function === "getenv" ? envKey(call.node.text) : undefined;
    const registry = registryKey(call);
    const loader = loaderOf(call);
    return {
      at: call.node.start,
      ...(callConditions[i] && { condition: callConditions[i] }),
      ...(call.function !== undefined && { function: call.function }),
      ...(call.method !== undefined && { method: call.method }),
      ...(call.written !== undefined && { written: call.written }),
      ...(argument !== undefined && { argument }),
      ...(envKeyOf !== undefined && { envKey: envKeyOf }),
      ...(registry !== undefined && { registryKey: registry }),
      ...(loader !== undefined && { loader }),
    };
  });
  return {
    keys: scan.keys,
    names: checked(scan.names, (node) => node.text),
    calls,
    reads: checked(scan.reads, (node) => node.text.trim()),
    bound: scan.bound,
    sdks: [...sdks],
  };
}

class FileScan {
  readonly captures: readonly Capture[];
  private readonly conditions = new Map<string, Condition>();
  /** Conditions and the argument lists that hide a value from them, for {@link conditionOf}. */
  private readonly owners: Capture[] = [];
  readonly calls: Call[];
  /** Outermost subscript reads, writes excluded. */
  readonly reads: Capture[];
  readonly names: Capture[];
  readonly keys: DefinedKey[];
  readonly bound: BoundStep[] = [];

  constructor(readonly file: PackSourceFile) {
    this.captures = file.captures[CONFIG_QUERY] ?? [];
    const named = (name: string): Capture[] => this.captures.filter((c) => c.name === name);
    this.readConditions(named("cfg.gate"), named("cfg.condition"), named("cfg.body"));
    this.readArguments(named("cfg.arguments"), named("cfg.callee"));
    this.calls = this.readCalls(named("cfg.call"));
    const written = new Set(named("cfg.written").map(spanKey));
    this.reads = outermost(named("cfg.subscript")).filter((c) => !written.has(spanKey(c)));
    this.names = named("cfg.name");
    this.keys = this.readKeys(named("cfg.write"), named("cfg.written"), named("cfg.written_value"), named("cfg.returned"), named("cfg.element"));
    this.readBound(named("cfg.bound"), named("cfg.bound_variable"), named("cfg.bound_value"));
  }

  private readConditions(gates: readonly Capture[], conditions: readonly Capture[], bodies: readonly Capture[]): void {
    const parts = partsByOwner(gates, [...conditions, ...bodies]);
    const ifs = gates.filter((g) => g.nodeType === "if_statement");
    const elseIfs = gates.filter((g) => g.nodeType === "else_if_clause");
    const enclosingIf = new Map<string, Capture>();
    innermostEach(ifs, elseIfs, true).forEach((owner, i) => owner && enclosingIf.set(spanKey(elseIfs[i]!), owner));
    for (const gate of gates) {
      const own = parts.get(spanKey(gate));
      const condition = firstNamed(own, "cfg.condition");
      if (condition === undefined) continue;
      const body = firstNamed(own, "cfg.body");
      let gated: LineRange | undefined;
      if (gate.nodeType === "if_statement" && body) gated = { start: body.start.line, end: gate.end.line };
      else if (gate.nodeType === "else_if_clause" && body) gated = { start: body.start.line, end: (enclosingIf.get(spanKey(gate)) ?? gate).end.line };
      else if (gate.nodeType === "conditional_expression") gated = { start: condition.end.line, end: gate.end.line };
      else if (gate.nodeType === "match_expression" && body) gated = { start: body.start.line, end: body.end.line };
      this.conditions.set(spanKey(condition), gated && gated.end >= gated.start ? { gated } : {});
      this.owners.push(condition);
    }
  }

  /** Argument lists hide their values from an enclosing condition, except `isset(…)` and `empty(…)`'s. */
  private readArguments(lists: readonly Capture[], callees: readonly Capture[]): void {
    // A callee ends where its argument list starts, so the list's callee is the one ending at its start.
    const calleeAt = new Map(callees.map((c) => [`${c.end.line}:${c.end.column}`, c]));
    for (const list of lists) {
      const callee = calleeAt.get(`${list.start.line}:${list.start.column}`);
      if (callee && TESTING_CALLS.has(callee.text.replace(/^\\/, "").toLowerCase())) continue;
      this.owners.push(list);
    }
  }

  private readCalls(nodes: readonly Capture[]): Call[] {
    const unique = [...new Map(nodes.map((n) => [spanKey(n), n])).values()];
    const partNames = ["cfg.function", "cfg.receiver", "cfg.method", "cfg.scope", "cfg.static_method", "cfg.argument"];
    const parts = partsByOwner(unique, this.captures.filter((c) => partNames.includes(c.name)));
    return unique.map((node) => {
      const own = parts.get(spanKey(node));
      const text = (name: string): string | undefined => firstNamed(own, name)?.text;
      const written = (text("cfg.function") ?? text("cfg.method"))?.replace(/^\\/, "");
      return {
        node,
        function: text("cfg.function")?.replace(/^\\/, "").toLowerCase(),
        receiver: text("cfg.receiver")?.replace(/\s+/g, ""),
        method: text("cfg.method")?.toLowerCase(),
        ...(written !== undefined && { written }),
        scope: text("cfg.scope"),
        staticMethod: text("cfg.static_method")?.toLowerCase(),
        argument: firstNamed(own, "cfg.argument"),
      };
    });
  }

  /** The keys of a returned settings array and of `$config[…] = …` assignments. */
  private readKeys(writes: readonly Capture[], written: readonly Capture[], values: readonly Capture[], returned: readonly Capture[], elements: readonly Capture[]): DefinedKey[] {
    const out: DefinedKey[] = [];
    const roots: Array<{ readonly root: Capture; readonly prefix: string }> = returned.map((root) => ({ root, prefix: "" }));
    const parts = partsByOwner(writes, [...written, ...values]);
    for (const write of writes) {
      const own = parts.get(spanKey(write));
      const target = firstNamed(own, "cfg.written");
      const value = firstNamed(own, "cfg.written_value");
      const subscript = target && configSubscript(target.text);
      if (!target || !value || !subscript || !DEFINING_ARRAYS.has(subscript.array) || subscript.key === "") continue;
      // In a function body `$config` is a local (CodeIgniter's `$config['per_page'] = 20; $this->pagination->initialize($config);`).
      if (scopeAt(this.file, write.start) !== undefined) continue;
      if (value.nodeType === "array_creation_expression") roots.push({ root: value, prefix: subscript.key });
      else out.push({ key: subscript.key, position: target.start });
    }
    if (roots.length === 0) return out;
    const keyParts = partsByOwner(elements, this.captures.filter((c) => c.name === "cfg.element_key"));
    const keyOf = (element: Capture): { key?: string; at: SourcePosition } => {
      const k = firstNamed(keyParts.get(spanKey(element)), "cfg.element_key");
      return { key: literal(k?.text), at: k?.start ?? element.start };
    };
    const rootCaptures = roots.map((r) => r.root);
    const rootOf = innermostEach(rootCaptures, elements, true);
    const parentOf = innermostEach(elements, elements, true);
    const index = new Map(elements.map((e, i) => [spanKey(e), i]));
    const hasChild = new Set<string>();
    elements.forEach((_, i) => {
      const parent = parentOf[i];
      if (parent && rootOf[index.get(spanKey(parent))!] === rootOf[i]) hasChild.add(spanKey(parent));
    });
    const prefixOf = new Map(roots.map((r) => [spanKey(r.root), r.prefix]));
    elements.forEach((element, i) => {
      const root = rootOf[i];
      if (!root || hasChild.has(spanKey(element))) return;
      const path: string[] = [];
      let at: SourcePosition | undefined;
      for (let j: number | undefined = i; j !== undefined; ) {
        const { key, at: keyAt } = keyOf(elements[j]!);
        if (key === undefined || key === "") return; // a list entry or a computed key: no settings key
        path.unshift(key);
        at ??= keyAt;
        const parent: Capture | undefined = parentOf[j];
        const k: number | undefined = parent && index.get(spanKey(parent));
        j = k !== undefined && rootOf[k] === root ? k : undefined;
      }
      const prefix = prefixOf.get(spanKey(root))!;
      out.push({ key: prefix === "" ? path.join(".") : `${prefix}.${path.join(".")}`, position: at! });
    });
    return out;
  }

  private readBound(nodes: readonly Capture[], variables: readonly Capture[], values: readonly Capture[]): void {
    const parts = partsByOwner(nodes, [...variables, ...values]);
    // A loader call's span is its value's: the value is the call.
    const loaders = new Map<string, number>();
    this.calls.forEach((call, i) => {
      if (loaderOf(call) !== undefined) loaders.set(spanKey(call.node), i);
    });
    for (const node of nodes) {
      const own = parts.get(spanKey(node));
      const variable = firstNamed(own, "cfg.bound_variable");
      const value = firstNamed(own, "cfg.bound_value");
      if (!variable || !value) continue;
      const name = variable.text.replace(/^\$/, "").toLowerCase();
      if (/^(?:include|require)/.test(value.nodeType)) this.bound.push({ name, kind: "include" });
      else {
        const call = loaders.get(spanKey(value));
        if (call !== undefined) this.bound.push({ name, kind: "load", call });
      }
    }
  }

  /** The condition a value at `node` is checked in, when it is in one and not behind a call's arguments. */
  conditionsOf(nodes: readonly Capture[]): (Condition | undefined)[] {
    return innermostEach(this.owners, nodes).map((owner) => (owner ? this.conditions.get(spanKey(owner)) : undefined));
  }
}

/** Subscripts not inside another that starts with them (`$a['x']` inside `$a['x']['y']`). */
function outermost(subscripts: readonly Capture[]): Capture[] {
  const unique = [...new Map(subscripts.map((s) => [spanKey(s), s])).values()];
  const owners = innermostEach(unique, unique, true);
  return unique.filter((s, i) => !(owners[i] && samePosition(owners[i]!.start, s.start)));
}

/** A settings loader call's source and path as written; undefined for any other call, or a loader without an argument. */
function loaderOf(call: Call): Loader | undefined {
  let source: ConfigSource | undefined;
  if (call.function !== undefined) source = Object.hasOwn(LOADERS, call.function) ? LOADERS[call.function] : undefined;
  else if (call.scope !== undefined && call.staticMethod === "parsefile" && lastSegment(call.scope) === "yaml") source = "yaml";
  return source === undefined || call.argument === undefined ? undefined : { source, path: call.argument.text };
}

/** A loader's source and the repository file it reads; undefined when the path is not computable or not in the repository. */
function loadOf(loader: Loader, file: string, constant: ConstantLookup): Load | undefined {
  const value = evaluatePath(loader.path, file, constant);
  const sourceFile = value === undefined ? undefined : repositoryPath(file, value);
  return sourceFile === undefined ? undefined : { source: loader.source, sourceFile };
}

/** A registry read's dotted key: `Config::get('a.b')`, `config('a.b')`, `$this->config->item('a')`. */
function registryKey(call: Call): string | undefined {
  const isRegistry =
    call.function === "config" ||
    (call.scope !== undefined && (call.staticMethod === "get" || call.staticMethod === "read") && REGISTRY_CLASSES.has(lastSegment(call.scope))) ||
    (call.receiver !== undefined && (call.method === "item" || call.method === "get" || call.method === "read") && CONFIG_NAMES.has(receiverName(call.receiver)));
  return isRegistry ? literal(call.argument?.text) : undefined;
}

// ── The project ─────────────────────────────────────────────────────────────

/** Constants the repository defines with a boolean literal (`define('X', true)`, `const X = false;`). */
function booleanConstants(files: readonly PackSourceFile[]): Set<string> {
  const out = new Set<string>();
  const boolean = (text: string | undefined): boolean => text !== undefined && /^\s*\\?(?:true|false)\s*$/i.test(text);
  for (const file of files) {
    const captures = file.captures.imports ?? [];
    const values = owned(captures, "include.define", "include.define_value");
    for (const [call, name] of owned(captures, "include.define", "include.define_name")) {
      const constant = literal(name.text);
      if (constant !== undefined && boolean(values.get(call)?.text)) out.add(constant);
    }
    const constValues = owned(captures, "include.const", "include.const_value");
    for (const [element, name] of owned(captures, "include.const", "include.const_name")) {
      if (boolean(constValues.get(element)?.text)) out.add(name.text);
    }
  }
  return out;
}

/** `define('NAME', …)` calls with a literal name, with the name's position. */
function definesOf(file: PackSourceFile): Array<{ readonly name: string; readonly position: SourcePosition }> {
  const captures = file.captures.imports ?? [];
  const out: Array<{ name: string; position: SourcePosition }> = [];
  for (const [, name] of owned(captures, "include.define", "include.define_name")) {
    const constant = literal(name.text);
    if (constant !== undefined) out.push({ name: constant, position: name.start });
  }
  return out;
}

/** A settings file's keys, and every dotted prefix of them (`a`, `a.b` for `a.b.c`). */
class SettingsKeys {
  private readonly prefixes = new Set<string>();
  constructor(readonly keys: ReadonlySet<string>) {
    for (const key of keys) for (let dot = key.indexOf("."); dot > 0; dot = key.indexOf(".", dot + 1)) this.prefixes.add(key.slice(0, dot));
  }

  /** Whether the file holds `key`, a key below it or a key above it. */
  holds(key: string): boolean {
    if (this.keys.has(key) || this.prefixes.has(key)) return true;
    for (let dot = key.indexOf("."); dot > 0; dot = key.indexOf(".", dot + 1)) if (this.keys.has(key.slice(0, dot))) return true;
    return false;
  }
}

/** How many tenant files a notice names before the rest are counted. */
const NOTICE_FILES = 5;

/** A file's digest with its loads, which follow the repository's constants: each call's, and each variable's. */
interface Scan {
  readonly path: string;
  readonly digest: ConfigDigest;
  readonly loads: readonly (Load | undefined)[];
  readonly bound: ReadonlyMap<string, Bound>;
}

function scanOf(path: string, digest: ConfigDigest, constant: ConstantLookup): Scan {
  const loads = digest.calls.map((call) => (call.loader === undefined ? undefined : loadOf(call.loader, path, constant)));
  const bound = new Map<string, Bound>();
  for (const step of digest.bound) {
    if (step.kind === "include") bound.set(step.name, { kind: "include" });
    else {
      const load = loads[step.call];
      if (load) bound.set(step.name, { kind: "load", ...load });
    }
  }
  return { path, digest, loads, bound };
}

/**
 * Every config read and flag check of a project, by file. `digests` are each
 * file's {@link digestConfig}, taken from `files` when absent.
 */
export function readConfigFacts(
  files: readonly PackSourceFile[],
  context?: FrameworkContext,
  digests: ReadonlyMap<string, ConfigDigest> = new Map(files.map((f) => [f.path, digestConfig(f)])),
): FrameworkFacts {
  const constant = repositoryConstants(files);
  const scans = files.map((file) => scanOf(file.path, digests.get(file.path) ?? EMPTY_DIGEST, constant));
  const booleans = booleanConstants(files);

  // Host-selected includes and their candidates, the tenant settings files.
  const tenants = new Set<string>();
  const hostIncludes = new Map<string, Array<{ readonly candidates: readonly string[]; readonly position: SourcePosition }>>();
  for (const file of files) {
    const written = context?.resolve(file.path).written ?? [];
    let readsHost: ReturnType<typeof hostReader> | undefined;
    for (const w of written) {
      if (!isInclude(w) || !w.candidates?.length) continue;
      readsHost ??= hostReader(file);
      if (!readsHost(w.specifier, w.position)) continue;
      const list = hostIncludes.get(file.path) ?? [];
      list.push({ candidates: w.candidates, position: w.position });
      hostIncludes.set(file.path, list);
      for (const c of w.candidates) tenants.add(c);
    }
  }

  // Settings files and the keys they hold; config-defined constants.
  const settings = new Map<string, SettingsKeys>();
  for (const { path, digest } of scans) if (digest.keys.length > 0) settings.set(path, new SettingsKeys(new Set(digest.keys.map((k) => k.key))));
  for (const tenant of tenants) if (!settings.has(tenant)) settings.set(tenant, new SettingsKeys(new Set()));
  const definers = new Map<string, string[]>();
  const definesByFile = new Map<string, ReturnType<typeof definesOf>>();
  for (const file of files) {
    if (!settings.has(file.path) && !isConfigPath(file.path)) continue;
    const defines = definesOf(file);
    if (defines.length === 0) continue;
    definesByFile.set(file.path, defines);
    for (const { name } of defines) {
      const list = definers.get(name) ?? [];
      if (!list.includes(file.path)) list.push(file.path);
      definers.set(name, list);
    }
  }
  /** The one settings file holding a registry key: as written, or `a.b` as key `b` of a `…/a.php` settings file. */
  const registrySource = (key: string): string | undefined => {
    const found = new Set<string>();
    const dot = key.indexOf(".");
    for (const [path, { keys }] of settings) {
      if (keys.has(key)) found.add(path);
      else if (dot > 0) {
        const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.php$/i, "");
        if (base === key.slice(0, dot) && keys.has(key.slice(dot + 1))) found.add(path);
      }
    }
    return found.size === 1 ? [...found][0] : undefined;
  };

  const facts = new Map<string, Omit<FileFacts, "path">>();
  for (const { path, digest, loads, bound: boundTo } of scans) {
    const reads: ConfigReadFact[] = [];
    const checks: FlagCheckFact[] = [];
    const read = (key: string, source: ConfigSource, position: SourcePosition, sourceFile?: string): void => {
      reads.push({ key, source, ...(sourceFile !== undefined && { sourceFile }), position });
    };
    const check = (name: string, mechanism: FlagCheckFact["mechanism"], position: SourcePosition, condition: Condition | undefined, client?: string): void => {
      const normalized = normalizeFlagName(name);
      if (normalized === "") return;
      checks.push({ name, normalized, mechanism, ...(client !== undefined && { client }), position, ...(condition?.gated && { gated: condition.gated }) });
    };

    // The settings files this file reads from: those it includes, its host-selected candidates, and itself.
    const sources = new Set<string>();
    for (const ref of context?.resolve(path).files ?? []) if (ref.symbols.includes("*") && settings.has(ref.to)) sources.add(ref.to);
    for (const { candidates } of hostIncludes.get(path) ?? []) for (const c of candidates) sources.add(c);
    if (settings.has(path)) sources.add(path);

    // Settings keys this file holds, and its config constants.
    for (const { key, position } of digest.keys) read(key, "file", position, path);
    for (const { name, position } of definesByFile.get(path) ?? []) read(name, "define", position, path);
    // Host-selected includes read their candidates whole.
    for (const { candidates, position } of hostIncludes.get(path) ?? []) for (const c of candidates) read("*", "file", position, c);

    // Constants: flags in conditions; config constants anywhere.
    for (const { text: name, start, condition } of digest.names) {
      if (condition && (isFlagName(name) || booleans.has(name))) check(name, "constant", start, condition);
      for (const definer of definers.get(name) ?? []) read(name, "define", start, definer);
    }

    // Calls.
    digest.calls.forEach((call, i) => {
      const { at, condition, argument } = call;
      const load = loads[i];
      if (load) read("*", load.source, at, load.sourceFile);
      if (call.function !== undefined) {
        if (call.function === "defined") {
          if (condition && argument !== undefined && isFlagName(argument)) check(argument, "constant", at, condition);
        } else if (HELPER_FUNCTIONS.has(call.function)) {
          if (argument !== undefined) check(argument, "function", at, condition, call.written);
        } else if (call.function === "getenv") {
          const key = call.envKey;
          if (condition && key !== undefined && isFlagName(key)) check(key, "env", at, condition, "getenv");
        }
      }
      if (call.method !== undefined && argument !== undefined) {
        const sdk = digest.sdks.find((s) => s.method === call.method);
        if (sdk) check(argument, "sdk", at, condition, sdk.client);
        else if (HELPER_METHODS.has(call.method)) check(argument, "function", at, condition, `->${call.written}`);
      }
      const key = call.registryKey;
      if (key !== undefined) {
        const source = registrySource(key);
        read(key, source === undefined ? "unknown" : "file", at, source);
        if (condition && isFlagKey(key)) check(key, "config", at, condition);
      }
    });

    // Subscript reads: environment and configuration flags, configuration reads.
    for (const { text, start, condition } of digest.reads) {
      if (condition) {
        const env = /^\$_(ENV|SERVER)\s*\[/.exec(text);
        const key = env ? envKey(text) : undefined;
        if (env && key !== undefined && isFlagName(key)) check(key, "env", start, condition, `$_${env[1]}`);
      }
      const subscript = configSubscript(text);
      if (subscript === undefined || subscript.key === "") continue;
      if (condition && CONFIG_NAMES.has(subscript.array) && isFlagKey(subscript.key)) check(subscript.key, "config", start, condition);
      const bound = /^\$\w+\s*\[/.test(text) ? boundTo.get(subscript.array) : undefined;
      if (bound?.kind === "load") {
        read(subscript.key, bound.source, start, bound.sourceFile);
        continue;
      }
      if (bound === undefined && !CONFIG_ARRAYS.has(subscript.array)) continue;
      const from = [...sources].filter((s) => settings.get(s)!.holds(subscript.key));
      if (from.length === 0) read(subscript.key, "unknown", start);
      for (const s of from) read(subscript.key, "file", start, s);
    }

    if (reads.length === 0 && checks.length === 0) continue;
    facts.set(path, {
      ...(reads.length > 0 && { configReads: distinct(reads, (r) => `${r.key}|${r.source}|${r.sourceFile ?? ""}`) }),
      ...(checks.length > 0 && { flagChecks: distinct(checks, (c) => `${c.name}|${c.mechanism}`) }),
    });
  }

  const tenantList = [...tenants].sort();
  const more = tenantList.length > NOTICE_FILES ? `, and ${tenantList.length - NOTICE_FILES} more` : "";
  const notices =
    tenantList.length === 0
      ? []
      : [`PHP: [${PHP_HOST_INCLUDE}] ${tenantList.length} file${tenantList.length === 1 ? "" : "s"} chosen by the request's host name ${tenantList.length === 1 ? "is a tenant config source" : "are tenant config sources"}: ${tenantList.slice(0, NOTICE_FILES).join(", ")}${more}.`];
  return { facts, notices };
}

/** Facts in document order, one per position and `identity`. */
function distinct<T extends { readonly position: SourcePosition }>(facts: readonly T[], identity: (fact: T) => string): T[] {
  const seen = new Set<string>();
  return [...facts]
    .sort((a, b) => byPosition(a.position, b.position))
    .filter((f) => {
      const key = `${f.position.line}:${f.position.column}|${identity(f)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export const phpConfigFlags: FrameworkPack<ConfigDigest> = {
  id: "php-config",
  produces: ["configReads", "flagChecks"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: CONFIG_QUERY, path: join(PHP_PACKAGE.queryDir("php-config"), `${CONFIG_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  digest: digestConfig,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[], context?: FrameworkContext, digests?: ReadonlyMap<string, ConfigDigest>): FrameworkFacts {
    if (!kinds.includes("configReads") && !kinds.includes("flagChecks")) return { facts: new Map(), notices: [] };
    const { facts, notices } = readConfigFacts(files, context, digests);
    if (kinds.includes("configReads") && kinds.includes("flagChecks")) return { facts, notices };
    const only = new Map<string, Omit<FileFacts, "path">>();
    for (const [path, f] of facts) {
      const kept = kinds.includes("configReads") ? { configReads: f.configReads } : { flagChecks: f.flagChecks };
      if (Object.values(kept)[0] !== undefined) only.set(path, kept);
    }
    return { facts: only, notices: kinds.includes("configReads") ? notices : [] };
  },
};
