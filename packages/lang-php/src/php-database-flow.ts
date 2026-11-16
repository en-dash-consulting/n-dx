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
 * (inside an `if` condition too), `.=` adds to them, an assignment to an
 * element or property (`$a[$k] = $row`, `$o->p = $row`) adds to its root
 * variable's and never clears them, `list()` and `[…]` destructuring give
 * each variable the value's, `foreach` gives its value variable the
 * subject's, `global` clears. A value read through `$row['x']`, `$row->x`,
 * `( … )`, `.` or interpolation keeps its sources; any other call or
 * operator gives none. Parameters, properties of `$this`, loop-carried and
 * branch-merged values are never sources: what cannot be decided is missed,
 * not guessed.
 *
 * A site is database-driven when what chooses its code is database-derived
 * where it runs: an `exec` site's code argument, a `dispatch` site's
 * callable, callee, method name or class. Each one's tables and literal
 * SELECT columns (`selectColumns`) and the query or fetch calls it comes
 * from become its `DynamicCodeFact.database`.
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

type Event =
  | { readonly kind: "assign"; readonly at: SourcePosition; readonly left: Capture; readonly right: Capture; readonly append: boolean }
  | { readonly kind: "foreach"; readonly at: SourcePosition; readonly variable: string; readonly subject: Capture }
  | { readonly kind: "global"; readonly at: SourcePosition; readonly variable: string }
  | { readonly kind: "return"; readonly at: SourcePosition; readonly value: Capture }
  | { readonly kind: "site"; readonly at: SourcePosition; readonly site: FlowSite };

/** A scope's variables while its events are read. */
interface State {
  readonly vars: Map<string, Sources>;
  readonly clients: Set<string>;
}

const variable = (c: Capture): string | undefined => (c.nodeType === "variable_name" ? c.text.slice(1) : undefined);

/** One file's flow: its events by scope, and what its expressions read. */
class FileFlow {
  /** Each scope's events in the order they take effect; `undefined` is the file's top level. */
  readonly events = new Map<Capture | undefined, Event[]>();
  /** Functions and methods declared here: the repository key and the scope. */
  readonly declarations: { readonly key: string; readonly method?: string; readonly scope: Capture }[] = [];
  private readonly statements = new Map<string, { tables: string[]; columns: string[] }>();
  private readonly scopes: Capture[];
  private readonly namespaces: Capture[];
  private readonly namespaceName = new Map<Capture, string>();
  private readonly classOf = new Map<Capture, string | undefined>();
  private readonly types: Capture[];

  constructor(
    readonly path: string,
    readonly captures: FileCaptures,
    file: PackSourceFile,
    constant: ConstantLookup,
    sites: readonly FlowSite[],
  ) {
    for (const s of readSqlStatements(file, constant)) {
      const key = nodeKey(s.call);
      const into = this.statements.get(key) ?? { tables: [], columns: [] };
      for (const t of s.tables) into.tables.push(t.schema === undefined ? t.name : `${t.schema}.${t.name}`);
      into.columns.push(...s.columns);
      this.statements.set(key, into);
    }
    this.scopes = [...captures.get("function"), ...captures.get("method-decl"), ...captures.get("closure")];
    this.namespaces = captures.get("namespace");
    captures.partsOf("namespace", "namespace-name").forEach((names, key) => {
      const ns = this.namespaces.find((n) => nodeKey(n) === key);
      if (ns !== undefined) this.namespaceName.set(ns, names[0]!.text.toLowerCase());
    });
    // An anonymous class's methods belong to no class a call can name.
    this.types = [...captures.get("type"), ...captures.get("anonymous-class")];
    const typeNames = captures.partsOf("type", "type-name");
    for (const type of captures.get("type")) {
      const name = typeNames.get(nodeKey(type))?.[0]?.text;
      const ns = this.namespaceAt(type.start);
      this.classOf.set(type, name === undefined ? undefined : (ns === "" ? name : `${ns}\\${name}`).toLowerCase());
    }
    this.readDeclarations();
    this.readEvents(sites);
  }

  /** The lower-cased namespace in force at `at`; "" for the global one. */
  namespaceAt(at: SourcePosition): string {
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
  classAt(at: SourcePosition): string | undefined {
    const [type] = innermostEach(this.types, [point(at)]);
    return type === undefined ? undefined : this.classOf.get(type);
  }

  /** The query a call makes, as a source; undefined when the call is no query the `sql` query read. */
  statementAt(call: Capture): Source | undefined {
    const statement = this.statements.get(nodeKey(call));
    return statement === undefined ? undefined : this.source(call, statement.tables, statement.columns);
  }

  source(call: Capture, tables: readonly string[] = [], columns: readonly string[] = []): Source {
    return { path: this.path, position: call.start, tables, columns };
  }

  private readDeclarations(): void {
    const functionNames = this.captures.partsOf("function", "function-name");
    for (const fn of this.captures.get("function")) {
      const name = functionNames.get(nodeKey(fn))?.[0]?.text;
      if (name === undefined) continue;
      const ns = this.namespaceAt(fn.start);
      this.declarations.push({ key: (ns === "" ? name : `${ns}\\${name}`).toLowerCase(), scope: fn });
    }
    const methodNames = this.captures.partsOf("method-decl", "method-decl-name");
    for (const m of this.captures.get("method-decl")) {
      const name = methodNames.get(nodeKey(m))?.[0]?.text.toLowerCase();
      const owner = this.classAt(m.start);
      if (name !== undefined && owner !== undefined) this.declarations.push({ key: `${owner}::${name}`, method: name, scope: m });
    }
  }

  private readEvents(sites: readonly FlowSite[]): void {
    const all: Event[] = [];
    const c = this.captures;
    const lefts = c.partsOf("assign", "assign-left");
    const rights = c.partsOf("assign", "assign-right");
    for (const a of c.get("assign")) {
      const left = lefts.get(nodeKey(a))?.[0];
      const right = rights.get(nodeKey(a))?.[0];
      if (left !== undefined && right !== undefined) all.push({ kind: "assign", at: a.end, left, right, append: false });
    }
    const appendLefts = c.partsOf("append", "append-left");
    const appendRights = c.partsOf("append", "append-right");
    for (const a of c.get("append")) {
      const left = appendLefts.get(nodeKey(a))?.[0];
      const right = appendRights.get(nodeKey(a))?.[0];
      if (left !== undefined && right !== undefined) all.push({ kind: "assign", at: a.end, left, right, append: true });
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
    for (const site of sites) all.push({ kind: "site", at: site.position, site });
    all.sort((a, b) => order(a.at, b.at));
    const owners = innermostEach(this.scopes, all.map((e) => point(e.at)));
    all.forEach((event, i) => {
      const scope = owners[i];
      const list = this.events.get(scope);
      if (list === undefined) this.events.set(scope, [event]);
      else list.push(event);
    });
  }
}

/** Repository-wide flow: return summaries and resolution. */
class RepositoryFlow {
  private readonly summaries = new Map<string, Sources>();
  /** Each method name's one declaring `class::method` key; null when several classes declare it. */
  private readonly methodOwners = new Map<string, string | null>();

  constructor(private readonly files: readonly FileFlow[]) {
    for (const file of files) {
      for (const d of file.declarations) {
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
        for (const d of file.declarations) {
          if (!(file.events.get(d.scope) ?? []).some((e) => e.kind === "return")) continue;
          let returned: Sources = NONE;
          this.run(file, d.scope, (event, state) => {
            if (event.kind === "return") returned = union(returned, this.evaluate(file, event.value, state));
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

  /** The database data each site of `file` runs on; sites with none are left out. */
  feeds(file: FileFlow): Map<FlowSite, DynamicCodeDatabase> {
    const out = new Map<FlowSite, DynamicCodeDatabase>();
    for (const [scope, events] of file.events) {
      if (!events.some((e) => e.kind === "site")) continue;
      this.run(file, scope, (event, state) => {
        if (event.kind !== "site") return;
        let sources: Sources = NONE;
        for (const operand of event.site.operands) if (operand !== undefined) sources = union(sources, this.evaluate(file, operand, state));
        if (sources.size > 0) out.set(event.site, database(sources));
      });
    }
    return out;
  }

  /** Reads one scope's events in order, calling `visit` on each with the state before it takes effect. */
  private run(file: FileFlow, scope: Capture | undefined, visit: (event: Event, state: State) => void): void {
    const state: State = { vars: new Map(), clients: new Set() };
    for (const event of file.events.get(scope) ?? []) {
      visit(event, state);
      if (event.kind === "assign") this.assign(file, event.left, event.right, event.append, state);
      else if (event.kind === "foreach") set(state, event.variable, this.evaluate(file, event.subject, state));
      else if (event.kind === "global") {
        state.vars.delete(event.variable);
        state.clients.delete(event.variable);
      }
    }
  }

  private assign(file: FileFlow, left: Capture, right: Capture, append: boolean, state: State): void {
    const value = this.evaluate(file, right, state);
    const name = variable(left);
    if (name !== undefined) {
      if (append) set(state, name, union(state.vars.get(name) ?? NONE, value));
      else {
        set(state, name, value);
        if (isClient(file, right)) state.clients.add(name);
        else state.clients.delete(name);
      }
      return;
    }
    if (left.nodeType === "list_literal") {
      for (const v of file.captures.partsOf("list", "list-variable").get(nodeKey(left)) ?? []) set(state, variable(v)!, value);
      return;
    }
    const root = rootVariable(file, left);
    if (root !== undefined && root !== "this" && value.size > 0) set(state, root, union(state.vars.get(root) ?? NONE, value));
  }

  /** The sources of what `node` evaluates to. */
  private evaluate(file: FileFlow, node: Capture, state: State): Sources {
    const c = file.captures;
    const part = (owner: string, name: string): Capture | undefined => c.partsOf(owner, name).get(nodeKey(node))?.[0];
    const each = (owner: string, name: string): Sources => {
      let out: Sources = NONE;
      for (const p of c.partsOf(owner, name).get(nodeKey(node)) ?? []) out = union(out, this.evaluate(file, p, state));
      return out;
    };
    const of = (next: Capture | undefined): Sources => (next === undefined ? NONE : this.evaluate(file, next, state));
    switch (node.nodeType) {
      case "variable_name":
        return state.vars.get(node.text.slice(1)) ?? NONE;
      case "subscript_expression":
        return of(part("subscript", "subscript-base"));
      case "member_access_expression":
      case "nullsafe_member_access_expression":
        return of(part("member", "member-object"));
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
        return this.functionCall(file, node, state);
      case "member_call_expression":
      case "nullsafe_member_call_expression":
        return this.methodCall(file, node, state);
      case "scoped_call_expression":
        return this.staticCall(file, node);
      default:
        return NONE;
    }
  }

  private functionCall(file: FileFlow, call: Capture, state: State): Sources {
    const callee = file.captures.callee(call);
    if (callee === undefined || !NAME_TYPES.has(callee.nodeType)) return NONE;
    const written = callee.text.replace(/^\\/, "");
    const name = written.toLowerCase();
    if (!written.includes("\\")) {
      if (FETCH_FUNCTION.test(name)) {
        const result = file.captures.argumentValues(call)[0];
        const from = result === undefined ? NONE : this.evaluate(file, result, state);
        return from.size > 0 ? from : single(file.source(call));
      }
      if (SQL_FUNCTIONS.has(name)) return single(file.statementAt(call) ?? file.source(call));
    }
    const ns = file.namespaceAt(call.start);
    const keys = callee.text.startsWith("\\") || ns === "" ? [name] : [`${ns}\\${name}`, ...(written.includes("\\") ? [] : [name])];
    for (const key of keys) {
      const summary = this.summaries.get(key);
      if (summary !== undefined) return summary;
    }
    return NONE;
  }

  private methodCall(file: FileFlow, call: Capture, state: State): Sources {
    const c = file.captures;
    const name = c.partsOf("method-call", "method-name").get(nodeKey(call))?.[0];
    const object = c.partsOf("method-call", "method-object").get(nodeKey(call))?.[0];
    if (name === undefined || object === undefined || name.nodeType !== "name") return NONE;
    const method = name.text.toLowerCase();
    const receiver = this.evaluate(file, object, state);
    if (receiver.size > 0 && (method.startsWith("fetch") || CODEIGNITER_RESULT_METHODS.has(method))) return receiver;
    if (MYSQLI_RESULT_METHODS.has(method)) return single(file.source(call));
    const statement = file.statementAt(call);
    if (statement !== undefined) return single(statement);
    const receiverName = variable(object);
    if (receiverName !== undefined && CLIENT_METHODS.has(method) && (receiverName === WPDB || state.clients.has(receiverName))) return single(file.source(call));
    if (receiverName === "this") {
      const owner = file.classAt(call.start);
      return owner === undefined ? NONE : (this.summaries.get(`${owner}::${method}`) ?? NONE);
    }
    const only = this.methodOwners.get(method);
    return only ? (this.summaries.get(only) ?? NONE) : NONE;
  }

  private staticCall(file: FileFlow, call: Capture): Sources {
    const c = file.captures;
    const name = c.partsOf("static-call", "static-name").get(nodeKey(call))?.[0];
    const scope = c.partsOf("static-call", "static-scope").get(nodeKey(call))?.[0];
    if (name === undefined || scope === undefined || name.nodeType !== "name") return NONE;
    const statement = file.statementAt(call);
    if (statement !== undefined) return single(statement);
    const method = name.text.toLowerCase();
    const written = scope.text.toLowerCase();
    let owner: string | undefined;
    if (scope.nodeType === "relative_scope") owner = written === "parent" ? undefined : file.classAt(call.start);
    else if (NAME_TYPES.has(scope.nodeType)) {
      const ns = file.namespaceAt(call.start);
      owner = written.startsWith("\\") || ns === "" ? written.replace(/^\\/, "") : `${ns}\\${written}`;
    }
    return owner === undefined ? NONE : (this.summaries.get(`${owner}::${method}`) ?? NONE);
  }
}

const NAME_TYPES = new Set(["name", "qualified_name", "relative_name"]);

function set(state: State, name: string, value: Sources): void {
  if (value.size === 0) state.vars.delete(name);
  else state.vars.set(name, value);
}

/** Whether `value` makes a database client: `new PDO`, `new mysqli`, `new wpdb`, `mysqli_connect(…)`, `mysqli_init()`. */
function isClient(file: FileFlow, value: Capture): boolean {
  const c = file.captures;
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

/** The variable an element or property assignment writes into (`$a` of `$a[$k]['x']`, `$o` of `$o->p`). */
function rootVariable(file: FileFlow, left: Capture): string | undefined {
  const c = file.captures;
  let node: Capture | undefined = left;
  for (let depth = 0; node !== undefined && depth < 64; depth++) {
    if (node.nodeType === "variable_name") return variable(node);
    if (node.nodeType === "subscript_expression") node = c.partsOf("subscript", "subscript-base").get(nodeKey(node))?.[0];
    else if (node.nodeType === "member_access_expression" || node.nodeType === "nullsafe_member_access_expression") node = c.partsOf("member", "member-object").get(nodeKey(node))?.[0];
    else return undefined;
  }
  return undefined;
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

/** One file to read: its captures and its exec and dispatch sites. */
export interface FlowFile {
  readonly file: PackSourceFile;
  readonly captures: FileCaptures;
  readonly sites: readonly FlowSite[];
}

/** The database data each site runs on, across the repository; sites fed by none are left out. */
export function databaseFeeds(files: readonly FlowFile[], constant: ConstantLookup): Map<FlowSite, DynamicCodeDatabase> {
  const flows = files.map(({ file, captures, sites }) => new FileFlow(file.path, captures, file, constant, sites));
  const repository = new RepositoryFlow(flows);
  repository.summarize();
  const out = new Map<FlowSite, DynamicCodeDatabase>();
  for (const flow of flows) for (const [site, db] of repository.feeds(flow)) out.set(site, db);
  return out;
}
