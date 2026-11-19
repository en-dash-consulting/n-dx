/**
 * Database flow over the PHP pack: which dynamic-code sites
 * (`php-dynamic-code.ts`) run or dispatch on a value read from a database,
 * and the tables and columns that value comes from. Routes kept in a table
 * and PHP stored in content rows are the database-driven sites; a migration
 * must inspect those rows. Names and locations only, never row data.
 *
 * **Sources.** A value is database-derived when it is:
 * - a query call's result: a `PHP_SQL_FUNCTIONS` call (`mysql_query`,
 *   `db_query_range`, …), a method or static call whose argument is SQL
 *   (`php-sql.ts`), or a query or getter method ({@link CLIENT_METHODS}) on a
 *   database client: a variable assigned `new PDO`, `new mysqli`, `new wpdb`,
 *   `mysqli_connect(…)` or `mysqli_init()` in its scope, or WordPress's
 *   `$wpdb`;
 * - a fetch: a {@link FETCH_FUNCTION} call (`mysql_fetch_assoc`,
 *   `mysqli_fetch_row`, `pg_fetch_array`, `oci_fetch_object`, …), a mysqli
 *   result method on any receiver ({@link MYSQLI_RESULT_METHODS}), or a
 *   `fetch…` or CodeIgniter result method on a database-derived receiver
 *   (`db_query(…)->fetchAssoc()`, `$stmt->fetch()`, `$query->row()`);
 * - a call of a repository function or method whose return value is
 *   database-derived: functions by their namespace-qualified name (PHP's
 *   fallback to the global name kept), `$this->m()`, `self::m()` and
 *   `static::m()` in the enclosing class, `Name::m()` by the class qualified
 *   in the current namespace, and `$obj->m()` when exactly one repository
 *   class declares `m`. Summaries are computed across the repository,
 *   repeated to a fixed point, at most {@link MAX_SUMMARY_ROUNDS} times.
 *
 * **Flow**, a forward pass in document order within one function, method,
 * closure or file top level: `=` and `= &` replace a variable's sources
 * (inside an `if` condition too), `.=` adds to them, `list()` and `[…]`
 * destructuring give each variable the value's, `foreach` gives its value
 * variable the subject's, `global` clears. Sources are kept per element or
 * property of a variable, one level deep (`$a['k']`, `$a[0]`, `$o->p`):
 * `$o->p = …` replaces that path's, a literal clearing it; a write with any
 * other key (`$a[$k] = $row`, `$a[] = $row`) or deeper (`$o->p['x'] = $row`)
 * adds and never clears. Reading a literal path gives what was last written
 * to it, else the variable's own (`$obj = $row; $obj['handler']`), never a
 * sibling's; reading any other key gives every such write's and the
 * variable's own; reading the variable whole gives all of them, and `$b = $a`
 * copies them. A value read through `$row['x']`, `$row->x`, `( … )`, `.` or
 * interpolation keeps its sources; any other call or operator gives none. Parameters, properties of `$this`, loop-carried and
 * branch-merged values are never sources: what cannot be decided is missed,
 * not guessed.
 *
 * A site is database-driven when what chooses its code is database-derived
 * where it runs: an `exec` site's code argument, a `dispatch` site's
 * callable, callee, method name or class. Each one's tables and literal
 * SELECT columns (`selectColumns`) and the query or fetch calls it comes
 * from become its `DynamicCodeFact.database`.
 *
 * **Memory.** Each file's flow is compiled ({@link compileFlow}) while its
 * captures are held, into what the pass reads: the events of the scopes that
 * hold a site or return a value, each expression reduced to the reads above.
 * The captures can then be released, so a repository's flow costs its
 * compiled events rather than every file's captures at once.
 *
 * @module lang-php/php-database-flow
 */

import type { DynamicCodeDatabase, SourcePosition } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";
import type { FileCaptures } from "./php-dynamic-code.js";
import type { ConstantLookup } from "./php-includes.js";
import { PHP_SQL_FUNCTIONS, readSqlStatements } from "./php-sql.js";

/** How many times repository return summaries are recomputed before they are taken as they stand. */
export const MAX_SUMMARY_ROUNDS = 10;

/** How deeply one expression's reads are followed (`.` chains, subscripts, calls) before the value is missed. */
export const MAX_EXPRESSION_DEPTH = 200;

/** Fetch functions: they return a row, a field or every row of a result. Field metadata (`*_fetch_field*`, `*_fetch_lengths`) is not data. */
export const FETCH_FUNCTION = /^(?:(?:mysql|mysqli|pg|oci|sqlsrv|odbc)_fetch_(?!field|lengths)\w+|(?:mysql|pg|oci|odbc)_result)$/;

/** mysqli_result's fetch methods: the names are mysqli's own, so any receiver counts. */
export const MYSQLI_RESULT_METHODS: ReadonlySet<string> = new Set(["fetch_all", "fetch_array", "fetch_assoc", "fetch_column", "fetch_object", "fetch_row"]);

/** CodeIgniter 3's query result methods, read on a database-derived receiver only. */
const CODEIGNITER_RESULT_METHODS: ReadonlySet<string> = new Set(["result", "result_array", "result_object", "row", "row_array", "row_object"]);

/** Query and getter methods that read through a database client: wpdb's getters and the `sql` query's methods. */
export const CLIENT_METHODS: ReadonlySet<string> = new Set([
  "get_var", "get_row", "get_col", "get_results",
  "query", "prepare", "multi_query", "real_query",
  "fetchall", "fetchassoc", "fetchrow", "fetchone", "fetchcol", "fetchpairs", "fetchcolumn",
]);

/** Classes and functions whose result is a database client, lower-cased. */
const CLIENT_CLASSES: ReadonlySet<string> = new Set(["pdo", "mysqli", "wpdb"]);
const CLIENT_FUNCTIONS: ReadonlySet<string> = new Set(["mysqli_connect", "mysqli_init"]);
/** WordPress's database client, a global by convention. */
const WPDB = "wpdb";

const SQL_FUNCTIONS: ReadonlySet<string> = new Set(PHP_SQL_FUNCTIONS);
const NAME_TYPES = new Set(["name", "qualified_name", "relative_name"]);

/** One query or fetch call a value comes from. */
interface Source {
  readonly path: string;
  readonly position: SourcePosition;
  readonly tables: readonly string[];
  readonly columns: readonly string[];
}

/** A value's sources by `path:line:column`; empty when it is not database-derived. */
type Sources = ReadonlyMap<string, Source>;
const NONE: Sources = new Map();
const union = (a: Sources, b: Sources): Sources => (a.size === 0 ? b : b.size === 0 ? a : new Map([...a, ...b]));
const sourceKey = (s: Source): string => `${s.path}:${s.position.line}:${s.position.column}`;
const single = (s: Source): Sources => new Map([[sourceKey(s), s]]);

const span = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;
/** A syntax node's identity across query patterns: its type and span. */
export const nodeKey = (c: Capture): string => `${c.nodeType}@${span(c)}`;
const order = (a: SourcePosition, b: SourcePosition): number => a.line - b.line || a.column - b.column;
const point = (at: SourcePosition): Capture => ({ name: "", nodeType: "", text: "", start: at, end: at });

/** A site whose code-choosing operands are checked. */
export interface FlowSite {
  readonly position: SourcePosition;
  /** What chooses the code the site runs; see the module comment. */
  readonly operands: readonly (Capture | undefined)[];
}

// ── Compiled form ───────────────────────────────────────────────────────────

/**
 * What an expression reads, as {@link RepositoryFlow.evaluate} reads it;
 * `undefined` reads nothing. Calls carry what their reading needs (`call`,
 * the node's key for the query it makes), resolved where they are written.
 */
type Expr =
  | { readonly t: "variable"; readonly name: string }
  | { readonly t: "path"; readonly root: string; readonly path: string }
  /** Every operand's sources: `.` and interpolation. */
  | { readonly t: "all"; readonly parts: readonly Expr[] }
  | { readonly t: "fetch"; readonly at: SourcePosition; readonly result?: Expr }
  | { readonly t: "query"; readonly at: SourcePosition; readonly call: string }
  | { readonly t: "function"; readonly keys: readonly string[] }
  | {
      readonly t: "method";
      readonly at: SourcePosition;
      readonly call: string;
      readonly method: string;
      readonly receiver?: Expr;
      readonly receiverName?: string;
      /** For `$this->m()`: the qualified class holding the call, if any. */
      readonly owner?: string;
    }
  | { readonly t: "static"; readonly at: SourcePosition; readonly call: string; readonly summary?: string };

/** Where an assignment writes. */
type Target =
  | { readonly t: "variable"; readonly name: string; readonly from?: string; readonly client: boolean }
  | { readonly t: "list"; readonly names: readonly string[] }
  | { readonly t: "path"; readonly root: string; readonly path: string; readonly whole: boolean };

type Event =
  | { readonly kind: "assign"; readonly target: Target; readonly value?: Expr; readonly append: boolean }
  | { readonly kind: "foreach"; readonly variable: string; readonly subject?: Expr }
  | { readonly kind: "global"; readonly variable: string }
  | { readonly kind: "return"; readonly value?: Expr }
  /** `site` indexes the sites the flow was compiled with. */
  | { readonly kind: "site"; readonly site: number; readonly operands: readonly (Expr | undefined)[] };

/** A function or method declared in a file: its repository key, and its events when it returns a value. */
interface Declaration {
  readonly key: string;
  readonly method?: string;
  readonly events?: readonly Event[];
}

/** One file's flow, without its captures: see the module comment's Memory. */
export interface CompiledFlow {
  readonly path: string;
  readonly declarations: readonly Declaration[];
  /** The events of each scope that holds a site. */
  readonly siteScopes: readonly (readonly Event[])[];
}

/** An event before compilation, at the position it takes effect. */
type RawEvent =
  | { readonly kind: "assign"; readonly at: SourcePosition; readonly start: SourcePosition; readonly left: Capture; readonly right: Capture; readonly append: boolean }
  | { readonly kind: "foreach"; readonly at: SourcePosition; readonly variable: string; readonly subject: Capture }
  | { readonly kind: "global"; readonly at: SourcePosition; readonly variable: string }
  | { readonly kind: "return"; readonly at: SourcePosition; readonly value: Capture }
  | { readonly kind: "site"; readonly at: SourcePosition; readonly site: number };

/** The path of elements written or read by a key that is not a literal (`$a[$k]`, `$a[]`, `$o->$p`). */
const ANY_ELEMENT = "*";

const variable = (c: Capture): string | undefined => (c.nodeType === "variable_name" ? c.text.slice(1) : undefined);

/** Compiles one file's flow from its captures. */
class FlowCompiler {
  private readonly scopes: Capture[];
  private readonly namespaces: Capture[];
  private readonly namespaceName = new Map<Capture, string>();
  private readonly classOf = new Map<Capture, string | undefined>();
  private readonly types: Capture[];

  constructor(private readonly c: FileCaptures) {
    this.scopes = [...c.get("function"), ...c.get("method-decl"), ...c.get("closure")];
    this.namespaces = c.get("namespace");
    c.partsOf("namespace", "namespace-name").forEach((names, key) => {
      const ns = this.namespaces.find((n) => nodeKey(n) === key);
      if (ns !== undefined) this.namespaceName.set(ns, names[0]!.text.toLowerCase());
    });
    // An anonymous class's methods belong to no class a call can name.
    this.types = [...c.get("type"), ...c.get("anonymous-class")];
    const typeNames = c.partsOf("type", "type-name");
    for (const type of c.get("type")) {
      const name = typeNames.get(nodeKey(type))?.[0]?.text;
      const ns = this.namespaceAt(type.start);
      this.classOf.set(type, name === undefined ? undefined : (ns === "" ? name : `${ns}\\${name}`).toLowerCase());
    }
  }

  compile(path: string, sites: readonly FlowSite[]): CompiledFlow {
    const byScope = this.events(sites);
    const compiled = new Map<Capture | undefined, readonly Event[]>();
    const eventsOf = (scope: Capture | undefined): readonly Event[] => {
      let events = compiled.get(scope);
      if (events === undefined) compiled.set(scope, (events = (byScope.get(scope) ?? []).flatMap((e) => this.event(e, sites))));
      return events;
    };
    const returns = (scope: Capture): boolean => (byScope.get(scope) ?? []).some((e) => e.kind === "return");
    const declarations: Declaration[] = [];
    const declare = (key: string, scope: Capture, method?: string) => declarations.push({ key, method, events: returns(scope) ? eventsOf(scope) : undefined });
    const functionNames = this.c.partsOf("function", "function-name");
    for (const fn of this.c.get("function")) {
      const name = functionNames.get(nodeKey(fn))?.[0]?.text;
      if (name === undefined) continue;
      const ns = this.namespaceAt(fn.start);
      declare((ns === "" ? name : `${ns}\\${name}`).toLowerCase(), fn);
    }
    const methodNames = this.c.partsOf("method-decl", "method-decl-name");
    for (const m of this.c.get("method-decl")) {
      const name = methodNames.get(nodeKey(m))?.[0]?.text.toLowerCase();
      const owner = this.classAt(m.start);
      if (name !== undefined && owner !== undefined) declare(`${owner}::${name}`, m, name);
    }
    const siteScopes = [...byScope].filter(([, events]) => events.some((e) => e.kind === "site")).map(([scope]) => eventsOf(scope));
    return { path, declarations, siteScopes };
  }

  /** The lower-cased namespace in force at `at`; "" for the global one. */
  private namespaceAt(at: SourcePosition): string {
    let found = "";
    for (const ns of this.namespaces) {
      if (order(ns.start, at) > 0) break;
      // A braced namespace holds its body; an unbraced one runs to the next.
      const braced = ns.text.trimEnd().endsWith("}");
      if (!braced || order(at, ns.end) < 0) found = this.namespaceName.get(ns) ?? "";
      else found = "";
    }
    return found;
  }

  /** The lower-cased qualified class whose method holds `at`, if any. */
  private classAt(at: SourcePosition): string | undefined {
    const [type] = innermostEach(this.types, [point(at)]);
    return type === undefined ? undefined : this.classOf.get(type);
  }

  /** Each scope's events in the order they take effect; `undefined` is the file's top level. */
  private events(sites: readonly FlowSite[]): Map<Capture | undefined, RawEvent[]> {
    const all: RawEvent[] = [];
    const c = this.c;
    const lefts = c.partsOf("assign", "assign-left");
    const rights = c.partsOf("assign", "assign-right");
    for (const a of c.get("assign")) {
      const left = lefts.get(nodeKey(a))?.[0];
      const right = rights.get(nodeKey(a))?.[0];
      if (left !== undefined && right !== undefined) all.push({ kind: "assign", at: a.end, start: a.start, left, right, append: false });
    }
    const appendLefts = c.partsOf("append", "append-left");
    const appendRights = c.partsOf("append", "append-right");
    for (const a of c.get("append")) {
      const left = appendLefts.get(nodeKey(a))?.[0];
      const right = appendRights.get(nodeKey(a))?.[0];
      if (left !== undefined && right !== undefined) all.push({ kind: "assign", at: a.end, start: a.start, left, right, append: true });
    }
    const subjects = c.partsOf("foreach", "foreach-subject");
    const values = c.partsOf("foreach", "foreach-value");
    for (const f of c.get("foreach")) {
      const subject = subjects.get(nodeKey(f))?.[0];
      const value = values.get(nodeKey(f))?.[0];
      const name = value === undefined ? undefined : variable(value);
      if (subject !== undefined && name !== undefined) all.push({ kind: "foreach", at: value!.end, variable: name, subject });
    }
    for (const g of c.get("global")) {
      const name = variable(g);
      if (name !== undefined) all.push({ kind: "global", at: g.start, variable: name });
    }
    const returned = c.partsOf("return", "return-value");
    for (const r of c.get("return")) {
      const value = returned.get(nodeKey(r))?.[0];
      if (value !== undefined) all.push({ kind: "return", at: r.start, value });
    }
    sites.forEach((site, i) => all.push({ kind: "site", at: site.position, site: i }));
    all.sort((a, b) => order(a.at, b.at));
    // The scope is where an event starts: an assignment takes effect at its end, which for
    // `$f = function () { … }` is the closure's own end, inside the closure.
    const owners = innermostEach(this.scopes, all.map((e) => point(e.kind === "assign" ? e.start : e.at)));
    const byScope = new Map<Capture | undefined, RawEvent[]>();
    all.forEach((event, i) => {
      const scope = owners[i];
      const list = byScope.get(scope);
      if (list === undefined) byScope.set(scope, [event]);
      else list.push(event);
    });
    return byScope;
  }

  /** One event compiled; none for an assignment that writes nothing the flow follows. */
  private event(e: RawEvent, sites: readonly FlowSite[]): Event[] {
    switch (e.kind) {
      case "foreach":
        return [{ kind: "foreach", variable: e.variable, subject: this.expr(e.subject, 0) }];
      case "global":
        return [{ kind: "global", variable: e.variable }];
      case "return":
        return [{ kind: "return", value: this.expr(e.value, 0) }];
      case "site":
        return [{ kind: "site", site: e.site, operands: sites[e.site]!.operands.map((o) => (o === undefined ? undefined : this.expr(o, 0))) }];
      case "assign": {
        const target = this.target(e.left, e.right);
        return target === undefined ? [] : [{ kind: "assign", target, append: e.append, value: this.expr(e.right, 0) }];
      }
    }
  }

  private target(left: Capture, right: Capture): Target | undefined {
    const name = variable(left);
    if (name !== undefined) return { t: "variable", name, from: variable(right), client: this.isClient(right) };
    if (left.nodeType === "list_literal") {
      return { t: "list", names: (this.c.partsOf("list", "list-variable").get(nodeKey(left)) ?? []).map((v) => variable(v)!) };
    }
    const written = this.writtenPath(left);
    return written === undefined || written.root === "this" ? undefined : { t: "path", ...written };
  }

  /**
   * What `node` reads. Past {@link MAX_EXPRESSION_DEPTH} nested reads (a
   * generated `$a . $b . …` chain thousands of operands long) a value is
   * missed rather than overflowing the stack and losing every dynamic-code
   * fact in the repository.
   */
  private expr(node: Capture, depth: number): Expr | undefined {
    if (depth >= MAX_EXPRESSION_DEPTH) return undefined;
    const c = this.c;
    const next = depth + 1;
    const part = (owner: string, name: string): Capture | undefined => c.partsOf(owner, name).get(nodeKey(node))?.[0];
    const of = (child: Capture | undefined): Expr | undefined => (child === undefined ? undefined : this.expr(child, next));
    const each = (owner: string, name: string): Expr | undefined => {
      const parts = (c.partsOf(owner, name).get(nodeKey(node)) ?? []).flatMap((p) => this.expr(p, next) ?? []);
      return parts.length <= 1 ? parts[0] : { t: "all", parts };
    };
    switch (node.nodeType) {
      case "variable_name":
        return { t: "variable", name: node.text.slice(1) };
      case "subscript_expression":
      case "member_access_expression":
      case "nullsafe_member_access_expression": {
        const read = this.readPathOf(node);
        if (read !== undefined) return read.root === "this" ? undefined : { t: "path", ...read };
        return of(node.nodeType === "subscript_expression" ? part("subscript", "subscript-base") : part("member", "member-object"));
      }
      case "parenthesized_expression":
        return of(part("parenthesized", "parenthesized-inner"));
      case "binary_expression":
        return each("concat", "concat-operand");
      case "encapsed_string":
      case "heredoc":
        return each("interpolated", "interpolated-part");
      case "assignment_expression":
      case "reference_assignment_expression":
        return of(part("assign", "assign-right"));
      case "function_call_expression":
        return this.functionCall(node, next);
      case "member_call_expression":
      case "nullsafe_member_call_expression":
        return this.methodCall(node, next);
      case "scoped_call_expression":
        return this.staticCall(node);
      default:
        return undefined;
    }
  }

  private functionCall(call: Capture, next: number): Expr | undefined {
    const callee = this.c.callee(call);
    if (callee === undefined || !NAME_TYPES.has(callee.nodeType)) return undefined;
    const written = callee.text.replace(/^\\/, "");
    const name = written.toLowerCase();
    if (!written.includes("\\")) {
      if (FETCH_FUNCTION.test(name)) {
        const result = this.c.argumentValues(call)[0];
        return { t: "fetch", at: call.start, result: result === undefined ? undefined : this.expr(result, next) };
      }
      if (SQL_FUNCTIONS.has(name)) return { t: "query", at: call.start, call: nodeKey(call) };
    }
    const ns = this.namespaceAt(call.start);
    const keys = callee.text.startsWith("\\") || ns === "" ? [name] : [`${ns}\\${name}`, ...(written.includes("\\") ? [] : [name])];
    return { t: "function", keys };
  }

  private methodCall(call: Capture, next: number): Expr | undefined {
    const name = this.c.partsOf("method-call", "method-name").get(nodeKey(call))?.[0];
    const object = this.c.partsOf("method-call", "method-object").get(nodeKey(call))?.[0];
    if (name === undefined || object === undefined || name.nodeType !== "name") return undefined;
    const receiverName = variable(object);
    return {
      t: "method",
      at: call.start,
      call: nodeKey(call),
      method: name.text.toLowerCase(),
      receiver: this.expr(object, next),
      receiverName,
      owner: receiverName === "this" ? this.classAt(call.start) : undefined,
    };
  }

  private staticCall(call: Capture): Expr | undefined {
    const name = this.c.partsOf("static-call", "static-name").get(nodeKey(call))?.[0];
    const scope = this.c.partsOf("static-call", "static-scope").get(nodeKey(call))?.[0];
    if (name === undefined || scope === undefined || name.nodeType !== "name") return undefined;
    const method = name.text.toLowerCase();
    const written = scope.text.toLowerCase();
    let owner: string | undefined;
    if (scope.nodeType === "relative_scope") owner = written === "parent" ? undefined : this.classAt(call.start);
    else if (NAME_TYPES.has(scope.nodeType)) {
      const ns = this.namespaceAt(call.start);
      owner = written.startsWith("\\") || ns === "" ? written.replace(/^\\/, "") : `${ns}\\${written}`;
    }
    return { t: "static", at: call.start, call: nodeKey(call), summary: owner === undefined ? undefined : `${owner}::${method}` };
  }

  /** `$a['k']`, `$a[0]` and `$o->p` as `['k']`, `[0]` and `->p`; {@link ANY_ELEMENT} for any other key; undefined unless `node`'s base is a variable. */
  private readPathOf(node: Capture): VariablePath | undefined {
    const c = this.c;
    if (node.nodeType === "subscript_expression") {
      const base = c.partsOf("subscript", "subscript-base").get(nodeKey(node))?.[0];
      const root = base === undefined ? undefined : variable(base);
      if (root === undefined) return undefined;
      const key = literalKey(c.partsOf("indexed", "subscript-index").get(nodeKey(node))?.[0]);
      return { root, path: key === undefined ? ANY_ELEMENT : `[${key}]` };
    }
    if (node.nodeType === "member_access_expression" || node.nodeType === "nullsafe_member_access_expression") {
      const object = c.partsOf("member", "member-object").get(nodeKey(node))?.[0];
      const root = object === undefined ? undefined : variable(object);
      if (root === undefined) return undefined;
      const name = c.partsOf("named-member", "member-name").get(nodeKey(node))?.[0];
      return { root, path: name?.nodeType === "name" ? `->${name.text}` : ANY_ELEMENT };
    }
    return undefined;
  }

  /**
   * The path an element or property assignment writes: the outermost access on
   * the variable (`['a']` of `$v['a'][$k]`, `->p` of `$o->p->q`), and whether
   * that path is written whole rather than into.
   */
  private writtenPath(left: Capture): (VariablePath & { readonly whole: boolean }) | undefined {
    const c = this.c;
    let node: Capture | undefined = left;
    for (let depth = 0; node !== undefined && depth < 64; depth++) {
      const path = this.readPathOf(node);
      if (path !== undefined) return { ...path, whole: node === left };
      if (node.nodeType === "subscript_expression") node = c.partsOf("subscript", "subscript-base").get(nodeKey(node))?.[0];
      else if (node.nodeType === "member_access_expression" || node.nodeType === "nullsafe_member_access_expression") node = c.partsOf("member", "member-object").get(nodeKey(node))?.[0];
      else return undefined;
    }
    return undefined;
  }

  /** Whether `value` makes a database client: `new PDO`, `new mysqli`, `new wpdb`, `mysqli_connect(…)`, `mysqli_init()`. */
  private isClient(value: Capture): boolean {
    const c = this.c;
    if (value.nodeType === "object_creation_expression") {
      const created = c.partsOf("new-named", "new-name").get(nodeKey(value))?.[0];
      return created !== undefined && CLIENT_CLASSES.has(created.text.replace(/^\\/, "").toLowerCase());
    }
    if (value.nodeType === "function_call_expression") {
      const callee = c.callee(value);
      return callee !== undefined && callee.nodeType === "name" && CLIENT_FUNCTIONS.has(callee.text.toLowerCase());
    }
    return false;
  }
}

/**
 * One file's flow, compiled from its captures with its exec and dispatch
 * sites; a site event names its site by index in `sites`. The result holds
 * no capture, so the file's captures can be released.
 */
export function compileFlow(path: string, captures: FileCaptures, sites: readonly FlowSite[]): CompiledFlow {
  return new FlowCompiler(captures).compile(path, sites);
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** A scope's variables while its events are read. */
interface State {
  /** Each variable's own value, as last assigned whole. */
  readonly vars: Map<string, Sources>;
  /** Each variable's elements and properties written since (`['k']`, `->p`, {@link ANY_ELEMENT}); a cleared one is kept, empty. */
  readonly paths: Map<string, Map<string, Sources>>;
  readonly clients: Set<string>;
}

/** A compiled flow and the queries its file makes, read on first use. */
class FileFlow {
  private statements: Map<string, { tables: string[]; columns: string[] }> | undefined;

  constructor(
    readonly flow: CompiledFlow,
    private readonly file: PackSourceFile,
    private readonly constant: ConstantLookup,
  ) {}

  /** The query a call makes, as a source; undefined when the call is no query the `sql` query read. */
  statementAt(call: string, at: SourcePosition): Source | undefined {
    const statement = this.readStatements().get(call);
    return statement === undefined ? undefined : this.source(at, statement.tables, statement.columns);
  }

  source(at: SourcePosition, tables: readonly string[] = [], columns: readonly string[] = []): Source {
    return { path: this.flow.path, position: at, tables, columns };
  }

  private readStatements(): Map<string, { tables: string[]; columns: string[] }> {
    if (this.statements !== undefined) return this.statements;
    const statements = new Map<string, { tables: string[]; columns: string[] }>();
    for (const s of readSqlStatements(this.file, this.constant)) {
      const key = nodeKey(s.call);
      const into = statements.get(key) ?? { tables: [], columns: [] };
      for (const t of s.tables) into.tables.push(t.schema === undefined ? t.name : `${t.schema}.${t.name}`);
      into.columns.push(...s.columns);
      statements.set(key, into);
    }
    return (this.statements = statements);
  }
}

/** Repository-wide flow: return summaries and resolution. */
class RepositoryFlow {
  private readonly summaries = new Map<string, Sources>();
  /** Each method name's one declaring `class::method` key; null when several classes declare it. */
  private readonly methodOwners = new Map<string, string | null>();

  constructor(private readonly files: readonly FileFlow[]) {
    for (const file of files) {
      for (const d of file.flow.declarations) {
        if (d.method === undefined) continue;
        const known = this.methodOwners.get(d.method);
        this.methodOwners.set(d.method, known === undefined || known === d.key ? d.key : null);
      }
    }
  }

  /** Computes every declaration's return summary, to a fixed point or {@link MAX_SUMMARY_ROUNDS}. */
  summarize(): void {
    for (let round = 0; round < MAX_SUMMARY_ROUNDS; round++) {
      let changed = false;
      for (const file of this.files) {
        for (const d of file.flow.declarations) {
          if (d.events === undefined) continue;
          let returned: Sources = NONE;
          this.run(file, d.events, (event, state) => {
            if (event.kind === "return" && event.value !== undefined) returned = union(returned, this.evaluate(file, event.value, state));
          });
          const known = this.summaries.get(d.key) ?? NONE;
          const next = union(known, returned);
          if (next.size !== known.size) {
            this.summaries.set(d.key, next);
            changed = true;
          }
        }
      }
      if (!changed) return;
    }
  }

  /** The database data each site of `file` runs on, by site index; sites with none are left out. */
  feeds(file: FileFlow): Map<number, DynamicCodeDatabase> {
    const out = new Map<number, DynamicCodeDatabase>();
    for (const events of file.flow.siteScopes) {
      this.run(file, events, (event, state) => {
        if (event.kind !== "site") return;
        let sources: Sources = NONE;
        for (const operand of event.operands) if (operand !== undefined) sources = union(sources, this.evaluate(file, operand, state));
        if (sources.size > 0) out.set(event.site, database(sources));
      });
    }
    return out;
  }

  /** Reads one scope's events in order, calling `visit` on each with the state before it takes effect. */
  private run(file: FileFlow, events: readonly Event[], visit: (event: Event, state: State) => void): void {
    const state: State = { vars: new Map(), paths: new Map(), clients: new Set() };
    for (const event of events) {
      visit(event, state);
      if (event.kind === "assign") this.assign(file, event, state);
      else if (event.kind === "foreach") replace(state, event.variable, this.evaluate(file, event.subject, state));
      else if (event.kind === "global") {
        replace(state, event.variable, NONE);
        state.clients.delete(event.variable);
      }
    }
  }

  private assign(file: FileFlow, { target, value: expr, append }: Extract<Event, { kind: "assign" }>, state: State): void {
    const value = this.evaluate(file, expr, state);
    if (target.t === "variable") {
      const name = target.name;
      if (append) set(state, name, union(state.vars.get(name) ?? NONE, value));
      else {
        // A copy of a variable keeps what each of its elements and properties holds.
        const from = target.from;
        const paths = from === undefined ? undefined : state.paths.get(from);
        replace(state, name, from === undefined ? value : (state.vars.get(from) ?? NONE));
        if (paths !== undefined) state.paths.set(name, new Map(paths));
        if (target.client) state.clients.add(name);
        else state.clients.delete(name);
      }
      return;
    }
    if (target.t === "list") {
      for (const name of target.names) replace(state, name, value);
      return;
    }
    const { root, path, whole } = target;
    let paths = state.paths.get(root);
    if (paths === undefined) state.paths.set(root, (paths = new Map()));
    // Only a literal path written whole is replaced; any other write may leave what was there.
    if (whole && !append && path !== ANY_ELEMENT) paths.set(path, value);
    else if (value.size > 0) paths.set(path, union(path === ANY_ELEMENT ? (paths.get(path) ?? NONE) : readPath(state, root, path), value));
  }

  /** The sources of what `expr` evaluates to. */
  private evaluate(file: FileFlow, expr: Expr | undefined, state: State): Sources {
    if (expr === undefined) return NONE;
    switch (expr.t) {
      case "variable":
        return readWhole(state, expr.name);
      case "path":
        return readPath(state, expr.root, expr.path);
      case "all": {
        let out: Sources = NONE;
        for (const p of expr.parts) out = union(out, this.evaluate(file, p, state));
        return out;
      }
      case "fetch": {
        const from = this.evaluate(file, expr.result, state);
        return from.size > 0 ? from : single(file.source(expr.at));
      }
      case "query":
        return single(file.statementAt(expr.call, expr.at) ?? file.source(expr.at));
      case "function":
        for (const key of expr.keys) {
          const summary = this.summaries.get(key);
          if (summary !== undefined) return summary;
        }
        return NONE;
      case "method":
        return this.methodCall(file, expr, state);
      case "static": {
        const statement = file.statementAt(expr.call, expr.at);
        if (statement !== undefined) return single(statement);
        return expr.summary === undefined ? NONE : (this.summaries.get(expr.summary) ?? NONE);
      }
    }
  }

  private methodCall(file: FileFlow, call: Extract<Expr, { t: "method" }>, state: State): Sources {
    const { method, receiverName } = call;
    const receiver = this.evaluate(file, call.receiver, state);
    if (receiver.size > 0 && (method.startsWith("fetch") || CODEIGNITER_RESULT_METHODS.has(method))) return receiver;
    if (MYSQLI_RESULT_METHODS.has(method)) return single(file.source(call.at));
    const statement = file.statementAt(call.call, call.at);
    if (statement !== undefined) return single(statement);
    if (receiverName !== undefined && CLIENT_METHODS.has(method) && (receiverName === WPDB || state.clients.has(receiverName))) return single(file.source(call.at));
    if (receiverName === "this") return call.owner === undefined ? NONE : (this.summaries.get(`${call.owner}::${method}`) ?? NONE);
    const only = this.methodOwners.get(method);
    return only ? (this.summaries.get(only) ?? NONE) : NONE;
  }
}

/** Sets a variable's own value, keeping what its elements and properties hold (`.=`). */
function set(state: State, name: string, value: Sources): void {
  if (value.size === 0) state.vars.delete(name);
  else state.vars.set(name, value);
}

/** Assigns a variable whole: its elements and properties are what `value`'s are. */
function replace(state: State, name: string, value: Sources): void {
  set(state, name, value);
  state.paths.delete(name);
}

/** A variable read whole: its own value and everything written into it. */
function readWhole(state: State, name: string): Sources {
  let out = state.vars.get(name) ?? NONE;
  for (const held of state.paths.get(name)?.values() ?? []) out = union(out, held);
  return out;
}

/**
 * One element or property of a variable. A literal path holds what was last
 * written to it, else the variable's own value (`$obj = $row`); a path that is
 * not a literal may be any element written by such a path, or the variable's
 * own. Never another literal path's: which one it is cannot be decided.
 */
function readPath(state: State, root: string, path: string): Sources {
  const own = state.vars.get(root) ?? NONE;
  const written = state.paths.get(root)?.get(path);
  if (path === ANY_ELEMENT) return union(own, written ?? NONE);
  return written ?? own;
}

/** A path read or written: the variable and its element or property. */
interface VariablePath {
  readonly root: string;
  readonly path: string;
}

/** An array key written as a literal, as PHP compares it (`'1'` and `1` alike); undefined when it is not one. */
function literalKey(index: Capture | undefined): string | undefined {
  if (index === undefined) return undefined;
  if (index.nodeType === "integer") return index.text;
  const quoted = index.nodeType === "string" || (index.nodeType === "encapsed_string" && !index.text.includes("$"));
  return quoted && !index.text.includes("\\") ? index.text.slice(1, -1) : undefined;
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));

function database(sources: Sources): DynamicCodeDatabase {
  const list = [...sources.values()].sort((a, b) => a.path.localeCompare(b.path) || order(a.position, b.position));
  return {
    tables: sorted(list.flatMap((s) => s.tables)),
    columns: sorted(list.flatMap((s) => s.columns)),
    sources: list.map((s) => ({ path: s.path, position: s.position })),
  };
}

/** One file to read: its compiled flow, and the file for the queries it makes (`sql` captures). */
export interface FlowFile {
  readonly file: PackSourceFile;
  readonly flow: CompiledFlow;
}

/** The database data each site runs on, by file path and site index, across the repository; sites fed by none are left out. */
export function databaseFeeds(files: readonly FlowFile[], constant: ConstantLookup): Map<string, Map<number, DynamicCodeDatabase>> {
  const flows = files.map(({ file, flow }) => new FileFlow(flow, file, constant));
  const repository = new RepositoryFlow(flows);
  repository.summarize();
  return new Map(flows.map((flow) => [flow.flow.path, repository.feeds(flow)]));
}
