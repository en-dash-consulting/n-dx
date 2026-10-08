/**
 * Outbound dependency detection — the consumer side of the wire.
 *
 * `server-route-detection.ts` and `go-route-detection.ts` find the routes this
 * repository *serves*. This finds the ones it *calls*, plus the interface
 * contracts it declares in files. Together they are what makes it possible to
 * say that repository A talks to repository B.
 *
 * Deterministic by construction: no LLM, no network, and no resolution beyond
 * what the source text states. Written to `outbound.json` by every
 * `sv analyze`, canonically ordered so an unchanged tree re-analyses to a
 * byte-identical file.
 *
 * ## What is here today
 *
 * Declared contracts, and JS/TS HTTP and gRPC call sites. The remaining slices
 * — JS/TS queue/database/cache, and Go — add detections to a file consumers
 * already read. Go will arrive in a sibling module and be dispatched to from
 * here, exactly as `server-route-detection.ts` dispatches to
 * `go-route-detection.ts`.
 *
 * ## How JS/TS call sites are found
 *
 * Through the TypeScript compiler API, never a regular expression over source
 * text. A regex cannot tell `axios.get(url)` from `cache.get(key)`, and the
 * difference between the two is the whole value of this file. The AST walk
 * resolves which local names are bound to which client library first, then
 * only reports calls made through those names — so an unrelated `.get()` on an
 * unrelated object is structurally incapable of being reported.
 *
 * ## Two fields, two questions
 *
 * `targetSource` answers *do we know where it points* — a URL literal, an
 * environment variable's name, a config key, or nothing. `confidence` answers
 * *is this an outbound call at all*, and nothing else: a direct call on an
 * imported client is `certain` whether its target is a literal or an env name.
 * Only indirection in reaching the call lowers it — a local alias or a
 * configured instance to `likely`, a dynamic member access to `inferred`.
 * Grading the env case lower would state one fact in two fields that can then
 * disagree.
 *
 * ## Why contracts are not found through the inventory alone
 *
 * `.proto`, `.yaml` and `.json` are not programming languages, so the default
 * `codeOnly` inventory omits them (`PROGRAMMING_LANGUAGES` in
 * `inventory.ts`). A project that disables `codeOnly`, or lists `.proto` under
 * `extraExtensions`, does have them — so both sources are consulted and the
 * results merged. Widening the inventory instead would change the input to
 * zone detection for every project, which is a far larger change than finding
 * contract files warrants.
 *
 * @module sourcevision/analyzers/outbound-detection
 */

import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import ts from "typescript";
import type {
  Confidence,
  DeclaredContract,
  Inventory,
  OutboundData,
  OutboundDependency,
} from "../schema/index.js";
import { sortOutbound } from "../util/sort.js";

/**
 * An OpenAPI or Swagger document, by filename convention.
 *
 * Matches `openapi.yaml`, `swagger.json`, `openapi.v1.yml`, `swagger-api.json`
 * and the like. Convention only — the file is not parsed, because a contract
 * that is listed but unread is still a fact a consumer can act on, and parsing
 * every YAML file in a repository to confirm it is not worth the walk.
 */
const OPENAPI_FILENAME = /^(?:openapi|swagger)[\w.-]*\.(?:ya?ml|json)$/i;

/** Directories a contract file is never meaningfully found under. */
const CONTRACT_SKIP = new Set([
  "node_modules", ".git", "dist", "build", "vendor", "coverage", "target",
]);

/** Depth and count bounds, so a pathological tree cannot stall an analysis. */
const MAX_WALK_DEPTH = 8;
const MAX_CONTRACTS = 400;

/** Classify one path as a declared contract, or `null` if it is not one. */
export function contractKindFor(path: string): DeclaredContract["kind"] | null {
  if (extname(path).toLowerCase() === ".proto") return "proto";
  if (OPENAPI_FILENAME.test(basename(path))) return "openapi";
  return null;
}

/**
 * Find declared contract files under `targetDir`, merged with any the
 * inventory already carries.
 *
 * Bounded: at most `MAX_CONTRACTS` results and `MAX_WALK_DEPTH` levels. A
 * repository with more contract files than that has a cataloguing problem this
 * analyzer is not the place to solve.
 */
export function findDeclaredContracts(
  targetDir: string,
  inventoryPaths: readonly string[],
): DeclaredContract[] {
  const byPath = new Map<string, DeclaredContract>();

  const record = (path: string): void => {
    if (byPath.size >= MAX_CONTRACTS || byPath.has(path)) return;
    const kind = contractKindFor(path);
    if (kind) byPath.set(path, { file: path, kind });
  };

  for (const path of inventoryPaths) record(path);

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || byPath.size >= MAX_CONTRACTS) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is not an analysis failure — a permission
      // boundary mid-tree should cost its own subtree, not the whole file.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (CONTRACT_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
        continue;
      }
      record(relative(targetDir, full).split(sep).join("/"));
    }
  };
  walk(targetDir, 0);

  return [...byPath.values()];
}

// ── JS/TS call sites ────────────────────────────────────────────────────────

/** Where a target came from, before it is paired with a call site. */
interface TargetInfo {
  target: string;
  targetSource: OutboundDependency["targetSource"];
}

/** No usable target. The empty string is what the schema specifies for it. */
const NO_TARGET: TargetInfo = { target: "", targetSource: "unknown" };

/**
 * One client library's call vocabulary.
 *
 * Declarative rather than a branch per library, because every one of these
 * families is the same three questions — which module, which names on it issue
 * a request, which names hand back a configured instance — and a table makes
 * adding the queue/database/cache families in the next slice an edit to data.
 */
interface ClientSpec {
  readonly client: string;
  readonly kind: OutboundDependency["kind"];
  readonly modules: readonly string[];
  /** The module's default export is itself callable: `axios(url)`. */
  readonly callableDefault: boolean;
  /** Named exports that are callable request functions: `request(url)`. */
  readonly callableNamed: ReadonlySet<string>;
  /** Methods on the client object that issue a request: `axios.get(url)`. */
  readonly methods: ReadonlySet<string>;
  /** Methods returning a configured client: `axios.create({ baseURL })`. */
  readonly factories: ReadonlySet<string>;
  /** Constructors producing a configured client: `new Pool(origin)`. */
  readonly constructors: ReadonlySet<string>;
  /** Keys under which an options object carries the target. */
  readonly urlKeys: readonly string[];
}

const NO_NAMES: ReadonlySet<string> = new Set();

function defineClient(s: {
  client: string;
  kind?: OutboundDependency["kind"];
  modules: string[];
  callableDefault?: boolean;
  callableNamed?: string[];
  methods?: string[];
  factories?: string[];
  constructors?: string[];
  urlKeys?: string[];
}): ClientSpec {
  return {
    client: s.client,
    kind: s.kind ?? "http",
    modules: s.modules,
    callableDefault: s.callableDefault ?? false,
    callableNamed: s.callableNamed ? new Set(s.callableNamed) : NO_NAMES,
    methods: s.methods ? new Set(s.methods) : NO_NAMES,
    factories: s.factories ? new Set(s.factories) : NO_NAMES,
    constructors: s.constructors ? new Set(s.constructors) : NO_NAMES,
    urlKeys: s.urlKeys ?? ["url"],
  };
}

const VERB_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/** The HTTP client families this slice covers. */
const CLIENT_SPECS: readonly ClientSpec[] = [
  defineClient({
    client: "axios",
    modules: ["axios"],
    callableDefault: true,
    methods: [...VERB_METHODS, "request", "postForm", "putForm", "patchForm"],
    factories: ["create"],
    urlKeys: ["baseURL", "url"],
  }),
  defineClient({
    client: "got",
    modules: ["got"],
    callableDefault: true,
    methods: [...VERB_METHODS, "stream", "paginate"],
    factories: ["extend"],
    urlKeys: ["prefixUrl", "url"],
  }),
  defineClient({
    client: "ky",
    modules: ["ky"],
    callableDefault: true,
    methods: VERB_METHODS,
    factories: ["create", "extend"],
    urlKeys: ["prefixUrl", "url"],
  }),
  defineClient({
    client: "node-fetch",
    modules: ["node-fetch"],
    callableDefault: true,
  }),
  defineClient({
    client: "undici",
    modules: ["undici"],
    callableNamed: ["request", "fetch", "stream", "pipeline", "upgrade", "connect"],
    methods: ["request", "stream", "dispatch"],
    constructors: ["Client", "Pool", "Agent", "ProxyAgent", "BalancedPool"],
    urlKeys: ["origin", "url"],
  }),
];

/** Modules whose presence makes a `*Client` constructor a gRPC stub. */
const GRPC_MODULES = new Set(["@grpc/grpc-js", "grpc", "@grpc/proto-loader"]);

/** Recorded for every gRPC detection: the library, not the generated stub. */
const GRPC_CLIENT = "grpc";

function specForModule(module: string): ClientSpec | undefined {
  return CLIENT_SPECS.find((s) => s.modules.includes(module));
}

/**
 * A local name that reaches a client library.
 *
 * `reach` is the only input to `confidence`: how many hops from the import to
 * the name being called. It deliberately knows nothing about the target.
 */
interface LocalBinding {
  spec: ClientSpec;
  /** `direct` — the imported name. `alias` — a local copy. `instance` — from a factory or constructor. */
  reach: "direct" | "alias" | "instance";
  /** Set when the name is one specific export rather than the module object. */
  member?: string;
  /** The base target a factory or constructor was configured with. */
  base?: TargetInfo;
}

/** Everything the declaration pass learned about one source file. */
interface FileBindings {
  locals: Map<string, LocalBinding>;
  /** Locals bound to a gRPC module object. */
  grpcModules: Set<string>;
  /** Locals holding a `loadPackageDefinition` result — their members are stubs. */
  grpcPackages: Set<string>;
  /** True once any gRPC module is imported, which licenses the `*Client` heuristic. */
  grpcImported: boolean;
  /** File-local `const` initializers, so a target named once can be resolved. */
  consts: Map<string, ts.Expression>;
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  switch (extname(filePath).toLowerCase()) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".ts":
    case ".mts":
    case ".cts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.JS;
  }
}

/** The string argument of a `require("…")` call, or `null`. */
function requiredModule(node: ts.Expression | undefined): string | null {
  if (!node || !ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "require") return null;
  const arg = node.arguments[0];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

/** `process.env.NAME` / `process.env["NAME"]` → `NAME`, else `null`. */
function envVariableName(node: ts.Expression): string | null {
  const isProcessEnv = (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "process" &&
    e.name.text === "env";

  if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    isProcessEnv(node.expression) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

/** `cfg.api.baseUrl` → `"cfg.api.baseUrl"`, or `null` if the root is not a plain name. */
function dottedPath(node: ts.Expression): string | null {
  const parts: string[] = [];
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return null;
  parts.unshift(current.text);
  return parts.length > 1 ? parts.join(".") : null;
}

/** How far a target expression is chased through file-local `const`s. */
const MAX_TARGET_HOPS = 3;

/** A scheme with nothing after it — a prefix, not an address. */
const SCHEME_ONLY = /^[a-z][\w+.-]*:\/\/$/i;

/**
 * Read where a call points out of the expression that supplies it.
 *
 * Never reports a guess: an expression it cannot account for yields
 * `unknown` with an empty target rather than something approximate. A
 * downstream matcher that must distinguish an environment variable's name from
 * an address cannot recover from a field that quietly conflates them.
 */
function extractTarget(
  node: ts.Expression | undefined,
  bindings: FileBindings,
  urlKeys: readonly string[],
  hops = 0,
): TargetInfo {
  if (!node || hops > MAX_TARGET_HOPS) return NO_TARGET;

  if (ts.isStringLiteralLike(node)) {
    return node.text ? { target: node.text, targetSource: "literal" } : NO_TARGET;
  }

  const envName = envVariableName(node);
  if (envName) return { target: envName, targetSource: "env" };

  // `${process.env.API_URL}/orders` — the variable is what a cross-repo
  // matcher can act on, so it wins over the literal tail.
  if (ts.isTemplateExpression(node)) {
    for (const span of node.templateSpans) {
      const spanEnv = envVariableName(span.expression);
      if (spanEnv) return { target: spanEnv, targetSource: "env" };
    }
    for (const span of node.templateSpans) {
      const inner = extractTarget(span.expression, bindings, urlKeys, hops + 1);
      if (inner.targetSource !== "unknown") return inner;
    }
    // A head that is only a scheme — `` `http://${host}/x` `` — names nothing.
    // Reporting it as a literal target would fill the artifact with rows that
    // say "this repository makes HTTP requests", which it already said by
    // having an `http` dependency at all.
    const head = node.head.text;
    return head && !SCHEME_ONLY.test(head)
      ? { target: head, targetSource: "literal" }
      : NO_TARGET;
  }

  // `new URL("/orders", base)` — the URL is in the arguments, not the call.
  if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
    const callee = ts.isNewExpression(node) ? node.expression : node.expression;
    if (ts.isIdentifier(callee) && callee.text === "URL") {
      for (const arg of node.arguments ?? []) {
        const inner = extractTarget(arg, bindings, urlKeys, hops + 1);
        if (inner.targetSource !== "unknown") return inner;
      }
    }
    return NO_TARGET;
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const key of urlKeys) {
      for (const prop of node.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) &&
          prop.name.text === key
        ) {
          const inner = extractTarget(prop.initializer, bindings, urlKeys, hops + 1);
          if (inner.targetSource !== "unknown") return inner;
        }
      }
    }
    return NO_TARGET;
  }

  if (ts.isIdentifier(node)) {
    const init = bindings.consts.get(node.text);
    return init ? extractTarget(init, bindings, urlKeys, hops + 1) : NO_TARGET;
  }

  // Anything else reached by name through an object is a config read: the key
  // is what we know, and the value is somewhere this analyzer does not follow.
  if (ts.isPropertyAccessExpression(node)) {
    const path = dottedPath(node);
    return path ? { target: path, targetSource: "config" } : NO_TARGET;
  }

  return NO_TARGET;
}

/**
 * Collect which local names reach a client library, in one pass before
 * detection.
 *
 * Separate pass rather than one interleaved walk so a client aliased below its
 * use — a `const` hoisted by a later refactor, a re-export at the foot of the
 * file — is still resolved. Scope is flat: a detector gains nothing from
 * modelling shadowing that it does not lose to a false negative elsewhere.
 */
function collectBindings(sf: ts.SourceFile): FileBindings {
  const bindings: FileBindings = {
    locals: new Map(),
    grpcModules: new Set(),
    grpcPackages: new Set(),
    grpcImported: false,
    consts: new Map(),
  };

  /** Bind every name introduced by `import X`/`{ a }`/`* as ns` from one module. */
  const bindModuleObject = (module: string, localName: string): void => {
    if (GRPC_MODULES.has(module)) {
      bindings.grpcImported = true;
      bindings.grpcModules.add(localName);
    }
    const spec = specForModule(module);
    if (spec) bindings.locals.set(localName, { spec, reach: "direct" });
  };

  const bindModuleMember = (module: string, exported: string, localName: string): void => {
    if (GRPC_MODULES.has(module)) bindings.grpcImported = true;
    const spec = specForModule(module);
    if (spec) bindings.locals.set(localName, { spec, reach: "direct", member: exported });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) bindModuleObject(module, clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindModuleObject(module, named.name.text);
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          bindModuleMember(module, (el.propertyName ?? el.name).text, el.name.text);
        }
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      collectFromDeclaration(node, node.initializer, bindings, bindModuleObject, bindModuleMember);
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return bindings;
}

/** One `const x = …` — a require, an alias, a factory result, or a plain value. */
function collectFromDeclaration(
  decl: ts.VariableDeclaration,
  init: ts.Expression,
  bindings: FileBindings,
  bindModuleObject: (module: string, localName: string) => void,
  bindModuleMember: (module: string, exported: string, localName: string) => void,
): void {
  const module = requiredModule(init);
  if (module) {
    if (ts.isIdentifier(decl.name)) bindModuleObject(module, decl.name.text);
    else if (ts.isObjectBindingPattern(decl.name)) {
      for (const el of decl.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const exported = el.propertyName && ts.isIdentifier(el.propertyName)
          ? el.propertyName.text
          : el.name.text;
        bindModuleMember(module, exported, el.name.text);
      }
    }
    return;
  }

  // `const http = axios` / `const { get } = axios` — one hop from the import.
  if (ts.isIdentifier(init)) {
    const source = bindings.locals.get(init.text);
    if (source && ts.isIdentifier(decl.name)) {
      bindings.locals.set(decl.name.text, { ...source, reach: "alias" });
      return;
    }
    if (bindings.grpcModules.has(init.text) && ts.isIdentifier(decl.name)) {
      bindings.grpcModules.add(decl.name.text);
      return;
    }
  }
  if (ts.isIdentifier(init) && ts.isObjectBindingPattern(decl.name)) {
    const source = bindings.locals.get(init.text);
    if (source) {
      for (const el of decl.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const member = el.propertyName && ts.isIdentifier(el.propertyName)
          ? el.propertyName.text
          : el.name.text;
        bindings.locals.set(el.name.text, { ...source, reach: "alias", member });
      }
      return;
    }
  }

  // `const api = axios.create({ baseURL })` — a configured instance.
  if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression)) {
    const objectName = ts.isIdentifier(init.expression.expression)
      ? init.expression.expression.text
      : null;
    const method = init.expression.name.text;
    if (objectName) {
      const source = bindings.locals.get(objectName);
      if (source?.spec.factories.has(method) && ts.isIdentifier(decl.name)) {
        bindings.locals.set(decl.name.text, {
          spec: source.spec,
          reach: "instance",
          base: extractTarget(init.arguments[0], bindings, source.spec.urlKeys),
        });
        return;
      }
      // `const proto = grpc.loadPackageDefinition(def)` — its members are stubs.
      if (
        bindings.grpcModules.has(objectName) &&
        method === "loadPackageDefinition" &&
        ts.isIdentifier(decl.name)
      ) {
        bindings.grpcPackages.add(decl.name.text);
        return;
      }
    }
  }

  // `const pool = new Pool(origin)` — a configured instance.
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
    const source = bindings.locals.get(init.expression.text);
    if (source?.spec.constructors.has(source.member ?? init.expression.text) &&
        ts.isIdentifier(decl.name)) {
      bindings.locals.set(decl.name.text, {
        spec: source.spec,
        reach: "instance",
        base: extractTarget(init.arguments?.[0], bindings, source.spec.urlKeys),
      });
      return;
    }
  }

  if (ts.isIdentifier(decl.name)) bindings.consts.set(decl.name.text, init);
}

/** `reach` and the access style, together, are the whole confidence rule. */
function confidenceFor(reach: LocalBinding["reach"], dynamic: boolean): Confidence {
  if (dynamic) return "inferred";
  return reach === "direct" ? "certain" : "likely";
}

/** An absolute target already names a host; a relative one needs the base. */
function isAbsoluteTarget(info: TargetInfo): boolean {
  return info.targetSource === "literal" && /^[a-z][\w+.-]*:\/\//i.test(info.target);
}

/**
 * Detect outbound HTTP and gRPC call sites in one JS/TS source file.
 *
 * Exported for the unit tests, which drive it with source text directly rather
 * than through a temporary tree — the AST reading is the part worth pinning,
 * and a test that has to lay out files to assert a line number is testing the
 * filesystem.
 */
export function detectJsOutboundCalls(
  sourceText: string,
  filePath: string,
): OutboundDependency[] {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );

  const bindings = collectBindings(sf);
  const found: OutboundDependency[] = [];
  const seen = new Set<string>();

  const record = (
    node: ts.Node,
    kind: OutboundDependency["kind"],
    client: string,
    info: TargetInfo,
    confidence: Confidence,
  ): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const key = `${line}|${kind}|${client}|${info.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({
      file: filePath,
      line,
      kind,
      target: info.target,
      targetSource: info.targetSource,
      client,
      confidence,
    });
  };

  /** A call through a bound local: resolve its target, then its confidence. */
  const recordClientCall = (
    node: ts.CallExpression | ts.NewExpression,
    binding: LocalBinding,
    dynamic: boolean,
  ): void => {
    const args = node.arguments ?? [];
    let info = extractTarget(args[0], bindings, binding.spec.urlKeys);
    // `api.get("/orders")` on an instance configured with a baseURL: the host
    // is the fact a cross-repo matcher needs, and the path is not it.
    if (binding.base && binding.base.targetSource !== "unknown" && !isAbsoluteTarget(info)) {
      info = binding.base;
    }
    if (info.targetSource === "unknown" && args.length > 1) {
      // `fetch(url, { … })` puts the target first, but `request({ url })`
      // and `axios({ url })` put it in an options object.
      for (const arg of args.slice(1)) {
        const alt = extractTarget(arg, bindings, binding.spec.urlKeys);
        if (alt.targetSource !== "unknown") {
          info = alt;
          break;
        }
      }
    }
    record(node, binding.spec.kind, binding.spec.client, info,
      confidenceFor(binding.reach, dynamic));
  };

  const visitCall = (node: ts.CallExpression): void => {
    const callee = node.expression;

    // `fetch(url)` — the global, only when nothing has bound the name.
    if (ts.isIdentifier(callee) && callee.text === "fetch" && !bindings.locals.has("fetch")) {
      record(node, "http", "fetch", extractTarget(node.arguments[0], bindings, ["url"]), "certain");
      return;
    }

    // `globalThis.fetch(url)` / `window.fetch(url)`.
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "fetch" &&
      ts.isIdentifier(callee.expression) &&
      (callee.expression.text === "globalThis" || callee.expression.text === "window")
    ) {
      record(node, "http", "fetch", extractTarget(node.arguments[0], bindings, ["url"]), "certain");
      return;
    }

    // `axios(url)`, `request(url)` — the bound name called directly.
    if (ts.isIdentifier(callee)) {
      const binding = bindings.locals.get(callee.text);
      if (!binding) return;
      const callable = binding.member
        ? binding.spec.callableNamed.has(binding.member)
        : binding.spec.callableDefault;
      if (callable) recordClientCall(node, binding, false);
      return;
    }

    // `axios.get(url)`, `api.get("/orders")`, `client.request({ path })`.
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const binding = bindings.locals.get(callee.expression.text);
      if (!binding) return;
      const method = callee.name.text;
      if (binding.spec.factories.has(method)) {
        // The factory is not a request, but it is a direct statement that this
        // repository is configured to call that host — a fact with its own line.
        const base = extractTarget(node.arguments[0], bindings, binding.spec.urlKeys);
        if (base.targetSource !== "unknown") {
          record(node, binding.spec.kind, binding.spec.client, base,
            confidenceFor(binding.reach, false));
        }
        return;
      }
      if (binding.spec.methods.has(method) || binding.spec.callableNamed.has(method)) {
        recordClientCall(node, binding, false);
      }
      return;
    }

    // `axios[verb](url)` — the member is not knowable from the source text.
    if (ts.isElementAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const binding = bindings.locals.get(callee.expression.text);
      if (!binding) return;
      const arg = callee.argumentExpression;
      if (arg && ts.isStringLiteralLike(arg)) {
        // `axios["get"]` is a static member written awkwardly, not a dynamic one.
        if (binding.spec.methods.has(arg.text) || binding.spec.callableNamed.has(arg.text)) {
          recordClientCall(node, binding, false);
        }
        return;
      }
      recordClientCall(node, binding, true);
    }
  };

  const visitNew = (node: ts.NewExpression): void => {
    const callee = node.expression;

    // `new grpc.Client(addr, creds)` and `new proto.pkg.Greeter(addr, creds)`.
    if (ts.isPropertyAccessExpression(callee)) {
      let root: ts.Expression = callee.expression;
      while (ts.isPropertyAccessExpression(root)) root = root.expression;
      if (ts.isIdentifier(root) &&
          (bindings.grpcModules.has(root.text) || bindings.grpcPackages.has(root.text))) {
        record(node, "grpc", GRPC_CLIENT,
          extractTarget(node.arguments?.[0], bindings, ["address", "url"]), "certain");
        return;
      }
      if (ts.isIdentifier(root)) {
        const binding = bindings.locals.get(root.text);
        if (binding?.spec.constructors.has(callee.name.text)) {
          recordClientCall(node, binding, false);
        }
      }
      return;
    }

    if (!ts.isIdentifier(callee)) return;

    // `new Pool(origin)` — an undici connection pool.
    const binding = bindings.locals.get(callee.text);
    if (binding?.spec.constructors.has(binding.member ?? callee.text)) {
      recordClientCall(node, binding, false);
      return;
    }

    // `new OrderServiceClient(addr, creds)` — a generated stub. The name is
    // why we believe it is gRPC, so it is graded as the inference it is.
    if (bindings.grpcImported && !binding && callee.text.endsWith("Client")) {
      record(node, "grpc", GRPC_CLIENT,
        extractTarget(node.arguments?.[0], bindings, ["address", "url"]), "likely");
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) visitCall(node);
    else if (ts.isNewExpression(node)) visitNew(node);
    ts.forEachChild(node, walk);
  };
  walk(sf);

  return found;
}

/** Extensions the TypeScript compiler API can parse for us. */
const JS_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]);

/**
 * Past this a "source file" is a bundle, a minified artifact or generated
 * data; parsing it costs more than the detections it would yield are worth.
 */
const MAX_SOURCE_BYTES = 1_000_000;

/** Roles whose call sites describe something other than what this repo calls. */
const SKIP_ROLES = new Set(["test", "docs", "asset"]);

/**
 * Detect everything this repository reaches out to.
 *
 * Takes the inventory rather than walking for source files itself, so the set
 * of files considered is the same set every other analyzer sees — ignore
 * rules, skip directories and incremental caching included.
 *
 * A file that cannot be read is skipped rather than failing the analysis: one
 * unreadable file should cost its own detections, not the whole artifact.
 */
export async function detectOutbound(
  targetDir: string,
  inventory: Inventory,
): Promise<OutboundData> {
  const dependencies: OutboundDependency[] = [];

  for (const file of inventory.files) {
    if (SKIP_ROLES.has(file.role)) continue;
    if (!JS_EXTENSIONS.has(extname(file.path).toLowerCase())) continue;
    if (file.size > MAX_SOURCE_BYTES) continue;

    let sourceText: string;
    try {
      sourceText = await readFile(join(targetDir, file.path), "utf-8");
    } catch {
      continue;
    }
    dependencies.push(...detectJsOutboundCalls(sourceText, file.path));
  }

  const contracts = findDeclaredContracts(
    targetDir,
    inventory.files.map((f) => f.path),
  );

  return sortOutbound({ dependencies, contracts });
}
