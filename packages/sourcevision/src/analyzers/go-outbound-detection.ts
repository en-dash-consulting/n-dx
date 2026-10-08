/**
 * Go outbound dependency detection — the consumer side, in Go.
 *
 * The sibling of the JS/TS half of `outbound-detection.ts`, producing the same
 * `OutboundDependency` records under the same two-field rule: `targetSource`
 * says where a call points, `confidence` says only how directly the call itself
 * was reached. `outbound-detection.ts` dispatches `.go` files here, exactly as
 * `server-route-detection.ts` dispatches them to `go-route-detection.ts`.
 *
 * ## Why this is text and the JS half is an AST
 *
 * There is no Go parser in this toolchain, and adding one would mean shipping a
 * Go toolchain or a WASM grammar to every install. The existing Go analyzers —
 * `go-imports.ts` and `go-route-detection.ts` — already read Go lexically, and
 * this file reuses both rather than introducing a third reading of the language:
 * `extractGoImports` resolves which local name each package is bound to, and
 * `stripGoComments` removes the text that must not be matched.
 *
 * What makes that safe here is the same thing that makes it safe there: nothing
 * is reported unless the file imports the package it would be reported for. A
 * bare `client.Do(req)` in a file with no `net/http` import is not an HTTP call
 * as far as this file is concerned, so the ambiguity a regex cannot resolve is
 * never reached.
 *
 * ## The three confidence tiers, and what earns each
 *
 * - `certain` — a call on the imported package itself: `http.Get`, `grpc.Dial`,
 *   `sql.Open`. An import alias does not lower this; renaming a package at the
 *   import is not indirection at the call site, and `extractGoImports` resolves
 *   the name either way.
 * - `likely` — a call on a local the file was seen to bind to a client
 *   (`svc.SendMessage` where `svc := sqs.New(sess)`), or a generated gRPC stub
 *   whose `New…Client` name is the only evidence it is one.
 * - `inferred` — a method from a client's vocabulary on a name this file never
 *   binds: a struct field or a function parameter. The package import and the
 *   method name are the whole case, which is an inference and is graded as one.
 *
 * @module sourcevision/analyzers/go-outbound-detection
 */

import type { OutboundDependency } from "../schema/index.js";
import { extractGoImports } from "./go-imports.js";
import { stripGoComments } from "./go-route-detection.js";

/** Where a target came from, before it is paired with a call site. */
type TargetInfo = Pick<OutboundDependency, "target" | "targetSource">;

/** No usable target. The empty string is what the schema specifies for it. */
const NO_TARGET: TargetInfo = { target: "", targetSource: "unknown" };

/** A scheme with nothing after it — a prefix, not an address. */
const SCHEME_ONLY = /^[a-z][\w+.-]*:\/\/$/i;

// ── Client families ─────────────────────────────────────────────────────────

/**
 * One Go client family's call vocabulary.
 *
 * Declarative for the same reason the JS table is: every family is the same
 * three questions — which import, which package functions issue or configure a
 * call, which methods on the resulting value issue one.
 */
interface GoClientSpec {
  readonly client: string;
  readonly kind: OutboundDependency["kind"];
  /** Does this import path belong to the family? */
  readonly matches: (importPath: string) => boolean;
  /**
   * Package functions that state a target, by the argument index holding it.
   * `-1` means the function is a client source that names no target of its own.
   */
  readonly packageCalls: ReadonlyMap<string, number>;
  /** Methods on a value this family produced that issue a request. */
  readonly methods: ReadonlySet<string>;
  /**
   * The subset of `methods` whose name alone is evidence enough to report a
   * call on a receiver this file never binds.
   *
   * Deliberately small, and empty for most families. `Get`, `Set`, `Do`,
   * `Query` and `Exec` are method names on everything — a probe over this
   * repository's Go fixtures reported `r.Header.Get("Authorization")`, a
   * *server-side* header read, as an outbound HTTP call on exactly that
   * reasoning. A name earns a place here only if an unrelated type plausibly
   * having it is far-fetched.
   */
  readonly inferableMethods: ReadonlySet<string>;
  /** Struct-literal and option keys under which a target is stated. */
  readonly targetKeys: readonly string[];
}

function defineGoClient(s: {
  client: string;
  kind: OutboundDependency["kind"];
  matches: (importPath: string) => boolean;
  packageCalls: Record<string, number>;
  methods?: string[];
  inferableMethods?: string[];
  targetKeys?: string[];
}): GoClientSpec {
  return {
    client: s.client,
    kind: s.kind,
    matches: s.matches,
    packageCalls: new Map(Object.entries(s.packageCalls)),
    methods: new Set(s.methods ?? []),
    inferableMethods: new Set(s.inferableMethods ?? []),
    targetKeys: s.targetKeys ?? [],
  };
}

/** `github.com/aws/aws-sdk-go/service/sqs` and the v2 path, SQS or SNS. */
const AWS_QUEUE_PATH = /^github\.com\/aws\/aws-sdk-go(?:-v2)?\/service\/(?:sqs|sns)$/;

/** Both the Shopify original and the IBM fork Kafka users are on today. */
const SARAMA_PATH = /^github\.com\/(?:Shopify|IBM)\/sarama$/;

/** `github.com/go-redis/redis/v8` and the moved `github.com/redis/go-redis/v9`. */
const GO_REDIS_PATH = /^github\.com\/(?:go-redis\/redis|redis\/go-redis)(?:\/v\d+)?$/;

const GO_CLIENT_SPECS: readonly GoClientSpec[] = [
  defineGoClient({
    client: "net/http",
    kind: "http",
    matches: (p) => p === "net/http",
    // `NewRequest` states the URL but issues nothing; the `Do` that carries it
    // is the call. It is recorded anyway — a request built against a host is
    // the same fact about this repository that issuing it is.
    packageCalls: {
      Get: 0, Post: 0, Head: 0, PostForm: 0,
      NewRequest: 1, NewRequestWithContext: 2,
    },
    // Nothing is inferable: every one of these is a method name on half the
    // types in a Go program, `Do` and `Get` most of all.
    methods: ["Do", "Get", "Post", "Head", "PostForm"],
    targetKeys: ["URL", "Host", "Addr"],
  }),
  defineGoClient({
    client: "grpc",
    kind: "grpc",
    matches: (p) => p === "google.golang.org/grpc",
    packageCalls: { Dial: 0, DialContext: 1, NewClient: 0 },
    methods: ["Invoke", "NewStream"],
    inferableMethods: ["Invoke", "NewStream"],
    targetKeys: ["Target", "Addr"],
  }),
  defineGoClient({
    client: "aws-sdk",
    kind: "queue",
    matches: (p) => AWS_QUEUE_PATH.test(p),
    // `New` (v1) and `NewFromConfig` (v2) hand back the service client; the
    // destination rides on the request struct, never on the constructor.
    packageCalls: { New: -1, NewFromConfig: -1 },
    methods: [
      "SendMessage", "SendMessageBatch", "ReceiveMessage", "DeleteMessage",
      "SendMessageWithContext", "ReceiveMessageWithContext",
      "Publish", "PublishBatch", "PublishWithContext",
    ],
    // All of them: these are SQS and SNS vocabulary, in a file that imports the
    // SQS or SNS package. A receiver with a `SendMessageBatch` that is not one
    // is not a case worth losing the detection over.
    inferableMethods: [
      "SendMessage", "SendMessageBatch", "ReceiveMessage", "DeleteMessage",
      "SendMessageWithContext", "ReceiveMessageWithContext",
      "Publish", "PublishBatch", "PublishWithContext",
    ],
    targetKeys: ["QueueUrl", "QueueURL", "TopicArn", "TargetArn", "EndpointUrl"],
  }),
  defineGoClient({
    client: "sarama",
    kind: "queue",
    matches: (p) => SARAMA_PATH.test(p),
    packageCalls: {
      NewClient: 0, NewSyncProducer: 0, NewAsyncProducer: 0,
      NewConsumer: 0, NewConsumerGroup: 0,
    },
    methods: ["SendMessage", "SendMessages", "ConsumePartition", "Consume"],
    inferableMethods: ["ConsumePartition"],
    targetKeys: ["Brokers", "Addrs"],
  }),
  defineGoClient({
    client: "go-redis",
    kind: "cache",
    matches: (p) => GO_REDIS_PATH.test(p),
    packageCalls: {
      NewClient: 0, NewFailoverClient: 0, NewClusterClient: 0,
      NewUniversalClient: 0, ParseURL: 0,
    },
    // Nothing is inferable: `Get`, `Set` and `Del` name cache operations and
    // also everything else.
    methods: ["Get", "Set", "Del", "Ping", "HGet", "HSet", "Subscribe"],
    targetKeys: ["Addr", "Addrs", "MasterName", "SentinelAddrs"],
  }),
  defineGoClient({
    client: "database/sql",
    kind: "database",
    matches: (p) => p === "database/sql",
    // The DSN is the second argument; the first names the driver.
    packageCalls: { Open: 1 },
    // Nothing is inferable: every ORM and query builder has a `Query`.
    methods: ["Query", "QueryRow", "Exec", "QueryContext", "ExecContext"],
    targetKeys: ["DSN", "Host"],
  }),
];

/** Recorded for every gRPC detection: the library, not the generated stub. */
const GRPC_CLIENT = "grpc";

/** A generated gRPC stub constructor: `pb.NewOrderServiceClient(conn)`. */
const GRPC_STUB_NAME = /^New\w*Client$/;

// ── Lexical helpers ─────────────────────────────────────────────────────────

/**
 * Index of the `)` closing the `(` at `openIdx`, or `-1`.
 *
 * String and raw-string literals are skipped so a parenthesis inside a DSN or a
 * URL cannot close the call early.
 */
function matchingClose(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split an argument list on its top-level commas. */
function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') {
      i++;
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "`") {
      const end = inner.indexOf("`", i + 1);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args.map((a) => a.trim()).filter((a) => a.length > 0);
}

/** 1-indexed line numbers for offsets into `text`, looked up by binary search. */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** The text of a Go string literal, quoted or raw, or `null`. */
function stringLiteral(expr: string): string | null {
  const trimmed = expr.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2) return null;
  // Only the escapes a URL, DSN or ARN actually carries; anything else is left
  // as written rather than guessed at.
  return trimmed.slice(1, -1).replace(/\\(["\\/])/g, "$1");
}

/** `pkg.Fn(` at the head of `expr` → `{ pkg, fn, inner }`, or `null`. */
function qualifiedCall(expr: string): { pkg: string; fn: string; inner: string } | null {
  const head = /^&?\s*([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(/.exec(expr.trim());
  if (!head) return null;
  const trimmed = expr.trim();
  const open = trimmed.indexOf("(", head[0].length - 1);
  const close = matchingClose(trimmed, open);
  if (close === -1) return null;
  return { pkg: head[1], fn: head[2], inner: trimmed.slice(open + 1, close) };
}

/** A composite literal's body: `&redis.Options{…}` / `sqs.SendMessageInput{…}`. */
function compositeBody(expr: string): string | null {
  const trimmed = expr.trim();
  const open = trimmed.indexOf("{");
  if (open === -1) return null;
  if (!/^&?\s*(?:\[\]\w+|\[\]\w+\.\w+|[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?|map\[[^\]]*\]\w+)\s*$/
    .test(trimmed.slice(0, open))) {
    return null;
  }
  const close = trimmed.lastIndexOf("}");
  return close > open ? trimmed.slice(open + 1, close) : null;
}

/** The value assigned to `key` inside a composite literal body, or `null`. */
function fieldValue(body: string, key: string): string | null {
  for (const field of splitTopLevelArgs(body)) {
    const sep = field.indexOf(":");
    if (sep === -1) continue;
    if (field.slice(0, sep).trim() === key) return field.slice(sep + 1).trim();
  }
  return null;
}

// ── Target extraction ───────────────────────────────────────────────────────

/** How far a target expression is chased through file-local declarations. */
const MAX_TARGET_HOPS = 4;

/** Wrappers that hand back their argument unchanged, as far as a target goes. */
const PASSTHROUGH = new Set(["String", "ToString", "StringValue", "Sprint"]);

/** Config libraries whose read states the key, not the value. */
const CONFIG_READERS = new Set([
  "Get", "GetString", "GetStringSlice", "GetInt", "Lookup", "String",
]);

const CONFIG_PACKAGES = new Set(["viper", "config", "cfg", "conf", "settings", "flag"]);

/**
 * Read where a call points out of the expression supplying it.
 *
 * Never reports a guess: an expression it cannot account for yields `unknown`
 * with an empty target rather than something approximate. A matcher that must
 * tell an environment variable's name from an address cannot recover from a
 * field that quietly conflates them.
 */
function extractGoTarget(
  expr: string | undefined,
  consts: ReadonlyMap<string, string>,
  targetKeys: readonly string[],
  hops = 0,
): TargetInfo {
  if (!expr || hops > MAX_TARGET_HOPS) return NO_TARGET;
  const trimmed = expr.trim();
  if (!trimmed) return NO_TARGET;

  const literal = stringLiteral(trimmed);
  if (literal !== null) {
    return literal ? { target: literal, targetSource: "literal" } : NO_TARGET;
  }

  const call = qualifiedCall(trimmed);
  if (call) {
    const args = splitTopLevelArgs(call.inner);

    // `os.Getenv("ORDERS_URL")` — the variable's name is the target, because
    // that is the thing a cross-repo matcher can look up.
    if (call.pkg === "os" && (call.fn === "Getenv" || call.fn === "LookupEnv")) {
      const name = stringLiteral(args[0] ?? "");
      return name ? { target: name, targetSource: "env" } : NO_TARGET;
    }

    // `aws.String(x)` and friends — a pointer wrapper, not a hop in meaning.
    if (PASSTHROUGH.has(call.fn)) {
      return extractGoTarget(args[0], consts, targetKeys, hops + 1);
    }

    // `strings.Split(os.Getenv("KAFKA_BROKERS"), ",")` — the variable survives
    // being cut up. Only the first argument is the source.
    if (call.pkg === "strings" && (call.fn === "Split" || call.fn === "TrimSuffix")) {
      return extractGoTarget(args[0], consts, targetKeys, hops + 1);
    }

    // `fmt.Sprintf("%s/orders", base)` — an interpolated argument beats the
    // format string, which on its own usually names only a scheme.
    if (call.pkg === "fmt" && call.fn.startsWith("Sprint")) {
      for (const arg of args.slice(1)) {
        const inner = extractGoTarget(arg, consts, targetKeys, hops + 1);
        if (inner.targetSource !== "unknown") return inner;
      }
      const format = stringLiteral(args[0] ?? "");
      return format && !SCHEME_ONLY.test(format)
        ? { target: format, targetSource: "literal" }
        : NO_TARGET;
    }

    // `viper.GetString("redis.addr")` — the key is what is known here; the
    // value is in a config file this analyzer does not read.
    if (CONFIG_PACKAGES.has(call.pkg) && CONFIG_READERS.has(call.fn)) {
      const key = stringLiteral(args[0] ?? "");
      return key ? { target: key, targetSource: "config" } : NO_TARGET;
    }
  }

  // `&redis.Options{Addr: …}`, `[]string{"kafka:9092"}`, `sqs.SendMessageInput{…}`.
  const body = compositeBody(trimmed);
  if (body !== null) {
    for (const key of targetKeys) {
      const value = fieldValue(body, key);
      if (value) {
        const inner = extractGoTarget(value, consts, targetKeys, hops + 1);
        if (inner.targetSource !== "unknown") return inner;
      }
    }
    // A slice with no keys at all — one broker names the cluster.
    for (const element of splitTopLevelArgs(body)) {
      if (element.includes(":") && !stringLiteral(element)) continue;
      const inner = extractGoTarget(element, consts, targetKeys, hops + 1);
      if (inner.targetSource !== "unknown") return inner;
    }
    return NO_TARGET;
  }

  if (/^[A-Za-z_]\w*$/.test(trimmed)) {
    const declared = consts.get(trimmed);
    return declared ? extractGoTarget(declared, consts, targetKeys, hops + 1) : NO_TARGET;
  }

  // Anything else reached by name through a value is a config read: the field
  // path is what we know, and the value is somewhere this analyzer stops.
  if (/^\*?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(trimmed)) {
    return { target: trimmed.replace(/^\*/, ""), targetSource: "config" };
  }

  return NO_TARGET;
}

// ── Bindings ────────────────────────────────────────────────────────────────

/** A local name holding something a client family produced. */
interface GoBinding {
  spec: GoClientSpec;
  /** The target the value was created with, carried to calls that name none. */
  base: TargetInfo;
}

/** One `pkg.Fn(…)` or `Name(…)` occurrence, located and with its arguments. */
interface CallSite {
  /** The package or receiver name, or `null` for a bare call. */
  receiver: string | null;
  fn: string;
  args: string[];
  /** Offset of the receiver (or function name) — what the line is read from. */
  offset: number;
  /** Names on the left of the `:=`/`=` this call initialises, if any. */
  assigned: string[];
}

/** Qualified calls `recv.Fn(` and bare ones `Fn(`, in source order. */
const CALL_RE = /\b(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\(/g;

/** The `a, b :=` / `var a =` immediately to the left of a call. */
const ASSIGN_RE = /(?:^|[;{}])\s*(?:var\s+)?([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::=|=)\s*$/;

/** Declarations that bind a name to a literal: `const x = "…"`, `x := "…"`. */
const DECL_RE =
  /(?:^|[;{}])\s*(?:const|var)?\s*([A-Za-z_]\w*)\s*(?::?=)\s*([^\n]+)/gm;

/** Every call occurrence in `text`, with its arguments and assignment targets. */
function collectCallSites(text: string): CallSite[] {
  const sites: CallSite[] = [];
  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(text)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchingClose(text, open);
    if (close === -1) continue;
    const prefix = text.slice(Math.max(0, match.index - 160), match.index);
    const assign = ASSIGN_RE.exec(prefix);
    sites.push({
      receiver: match[1] ?? null,
      fn: match[2],
      args: splitTopLevelArgs(text.slice(open + 1, close)),
      offset: match.index,
      assigned: assign ? assign[1].split(",").map((n) => n.trim()) : [],
    });
  }
  return sites;
}

/** File-local names bound to a literal, so a target named once still resolves. */
function collectConsts(text: string): Map<string, string> {
  const consts = new Map<string, string>();
  DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECL_RE.exec(text)) !== null) {
    if (!consts.has(match[1])) consts.set(match[1], match[2].trim());
  }
  return consts;
}

/**
 * Which local names reach a client, collected before detection.
 *
 * A separate pass for the same reason the JS half has one: a client assigned
 * below its use — a package-level `var` under the functions that call it, which
 * is idiomatic Go — must still resolve.
 */
function collectGoBindings(
  sites: readonly CallSite[],
  packages: ReadonlyMap<string, GoClientSpec>,
  consts: ReadonlyMap<string, string>,
  text: string,
): Map<string, GoBinding> {
  const bindings = new Map<string, GoBinding>();

  for (const site of sites) {
    if (site.assigned.length === 0 || !site.receiver) continue;
    const spec = packages.get(site.receiver);
    if (!spec) continue;
    const argIndex = spec.packageCalls.get(site.fn);
    if (argIndex === undefined) continue;
    const base = argIndex >= 0
      ? extractGoTarget(site.args[argIndex], consts, spec.targetKeys)
      : NO_TARGET;
    // Go's multi-value returns put the value first and the error second.
    bindings.set(site.assigned[0], { spec, base });
  }

  // `client := &http.Client{Timeout: d}` and `client := http.DefaultClient` —
  // a composite literal or a package variable rather than a call.
  const httpSpec = [...packages.values()].find((s) => s.client === "net/http");
  if (httpSpec) {
    for (const [name, httpPkg] of packages) {
      if (httpPkg !== httpSpec) continue;
      const re = new RegExp(
        `\\b([A-Za-z_]\\w*)\\s*:?=\\s*&?\\s*${name}\\s*\\.\\s*(?:Client\\s*\\{|DefaultClient\\b)`,
        "g",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (!bindings.has(m[1])) bindings.set(m[1], { spec: httpSpec, base: NO_TARGET });
      }
    }
  }

  return bindings;
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Local package name for an import path: the alias when one is written, and
 * otherwise Go's own rule of the last path element — minus a `/vN` suffix,
 * which names a major version rather than a package, and minus the `go-`
 * prefix the `go-redis` module carries but its package does not.
 */
function localPackageName(path: string, alias: string | null): string | null {
  if (alias === "_" || alias === ".") return null;
  if (alias) return alias;
  const segments = path.split("/").filter(Boolean);
  let last = segments[segments.length - 1] ?? "";
  if (/^v\d+$/.test(last) && segments.length > 1) last = segments[segments.length - 2];
  return last.replace(/^go-/, "") || null;
}

/**
 * Detect outbound call sites in one Go source file.
 *
 * Exported for the unit tests, which drive it with source text directly — the
 * reading is the part worth pinning, and a test that has to lay out files to
 * assert a line number is testing the filesystem.
 */
export function detectGoOutboundCalls(
  sourceText: string,
  filePath: string,
): OutboundDependency[] {
  const text = stripGoComments(sourceText);

  // `extractGoImports` is given the original text: it reads line by line and
  // strips its own comments, and the import block is above anything this file
  // detects, so the two readings cannot disagree about it.
  const { raw } = extractGoImports(sourceText, filePath, null);

  const packages = new Map<string, GoClientSpec>();
  let grpcImported = false;
  for (const imp of raw) {
    const name = localPackageName(imp.path, imp.alias);
    if (!name) continue;
    const spec = GO_CLIENT_SPECS.find((s) => s.matches(imp.path));
    if (spec) {
      packages.set(name, spec);
      if (spec.kind === "grpc") grpcImported = true;
    }
  }
  if (packages.size === 0) return [];

  const consts = collectConsts(text);
  const sites = collectCallSites(text);
  const bindings = collectGoBindings(sites, packages, consts, text);
  const lineAt = lineIndex(text);

  const found: OutboundDependency[] = [];
  const seen = new Set<string>();

  const record = (
    offset: number,
    kind: OutboundDependency["kind"],
    client: string,
    info: TargetInfo,
    confidence: OutboundDependency["confidence"],
  ): void => {
    const line = lineAt(offset);
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

  /** The first argument that states a target, or nothing. */
  const targetFromArgs = (args: readonly string[], spec: GoClientSpec): TargetInfo => {
    for (const arg of args) {
      const info = extractGoTarget(arg, consts, spec.targetKeys);
      if (info.targetSource !== "unknown") return info;
    }
    return NO_TARGET;
  };

  /**
   * An argument that is itself a tracked value carries the target it was built
   * with: `client.Do(req)` states nothing, and the `http.NewRequest` that made
   * `req` states everything. Restricted to the same family so a context or a
   * config passed alongside cannot supply an unrelated address.
   */
  const targetFromArgBindings = (
    args: readonly string[],
    spec: GoClientSpec,
  ): TargetInfo => {
    for (const arg of args) {
      const bound = bindings.get(arg.trim());
      if (bound?.spec === spec && bound.base.targetSource !== "unknown") return bound.base;
    }
    return NO_TARGET;
  };

  for (const site of sites) {
    // `pb.NewOrderServiceClient(conn)` — a generated stub. The name is why we
    // believe it is gRPC, so it is graded as the inference it is. The address
    // comes from the connection it was handed.
    if (grpcImported && site.receiver && !packages.has(site.receiver) &&
        GRPC_STUB_NAME.test(site.fn)) {
      const conn = site.args[0] ? bindings.get(site.args[0].trim()) : undefined;
      record(site.offset, "grpc", GRPC_CLIENT,
        conn?.spec.kind === "grpc" ? conn.base : NO_TARGET, "likely");
      continue;
    }

    if (!site.receiver) continue;

    // A call on the imported package: `http.Get`, `grpc.Dial`, `sql.Open`.
    const pkgSpec = packages.get(site.receiver);
    if (pkgSpec) {
      const argIndex = pkgSpec.packageCalls.get(site.fn);
      if (argIndex === undefined || argIndex < 0) continue;
      // Only the declared position. Scanning the other arguments when this one
      // resolves to nothing reports whatever literal is nearby — for
      // `sql.Open("postgres", dsn)` with `dsn` a parameter, that is the driver
      // name. An unresolved target is `unknown`; it is never the next literal.
      record(site.offset, pkgSpec.kind, pkgSpec.client,
        extractGoTarget(site.args[argIndex], consts, pkgSpec.targetKeys), "certain");
      continue;
    }

    // A method on a local this file bound to a client.
    const binding = bindings.get(site.receiver);
    if (binding) {
      if (!binding.spec.methods.has(site.fn)) continue;
      // What the call states, else what a value it was handed states, else what
      // the receiver was configured with.
      let info = targetFromArgs(site.args, binding.spec);
      if (info.targetSource === "unknown") info = targetFromArgBindings(site.args, binding.spec);
      if (info.targetSource === "unknown") info = binding.base;
      record(site.offset, binding.spec.kind, binding.spec.client, info, "likely");
      continue;
    }

    // A distinctive method from a client's vocabulary on a name this file never
    // binds — a struct field or a parameter. The import plus the method name is
    // the whole case, so it is graded as the inference it is. Two gates: the
    // name must be one the family declared inferable, and it must belong to
    // exactly one imported family.
    const candidates = [...new Set(packages.values())]
      .filter((s) => s.inferableMethods.has(site.fn));
    if (candidates.length === 1) {
      const spec = candidates[0];
      record(site.offset, spec.kind, spec.client, targetFromArgs(site.args, spec), "inferred");
    }
  }

  return found;
}
