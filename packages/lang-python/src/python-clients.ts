/**
 * Outbound-call rules over the Python pack: HTTP, gRPC, queue and
 * environment clients.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/python-clients/python-clients.scm`) runs in the Python parse
 * only when outbound calls are wanted, and these rules read its captures
 * together with the Python queries' `calls`, `definitions` and `imports`,
 * through `python-web.ts`. Rules (keys of {@link PROVENANCE}):
 *
 * - `requests`: `requests.get/post/put/patch/delete/head/options(url)` and
 *   `requests.request(method, url)`, and the same methods on a
 *   `requests.Session()`.
 * - `httpx`: the same functions on the module, and the same methods on an
 *   `httpx.Client()` or `httpx.AsyncClient()`.
 * - `aiohttp`: the same methods on an `aiohttp.ClientSession()`.
 * - `urllib`: `urllib.request.urlopen(url)` and `urllib.request.Request(url)`;
 *   an `urlopen` of a `Request` is that `Request`'s call, not a second one.
 * - `grpc`: `grpc.insecure_channel(target)`, `grpc.secure_channel(target, …)`
 *   and their `grpc.aio` equivalents.
 * - `confluent-kafka`: `Producer(…).produce(topic, …)` and
 *   `Consumer(…).subscribe([topics])`, one call per topic.
 * - `kafka-python`: `KafkaProducer(…).send(topic, …)`, `KafkaConsumer(*topics, …)`
 *   and `KafkaConsumer(…).subscribe(topics)`.
 * - `pika`: `channel.basic_publish(exchange=…, routing_key=…)`, whose target
 *   is the routing key on the default exchange `""` and the exchange
 *   otherwise, and `channel.basic_consume(queue=…)`, on a channel from
 *   `pika.BlockingConnection(…)` or `pika.SelectConnection(…)`.
 * - `celery`: `Celery(…).send_task(name, …)`; the target is the task name.
 * - `env`: `os.environ["X"]`, `os.environ.get("X")` and `os.getenv("X")`,
 *   kind `env` with target `X` and target source `env`; an assignment to or
 *   `del` of `os.environ["X"]` is a write and not reported.
 * - `settings`: how a target is read, below.
 *
 * A target that is a string literal is `literal`; an environment lookup is
 * `env` with its key; `settings.X` (a Django or pydantic settings object) is
 * `config` with key `X`; an f-string or `+` concatenation takes the source
 * and value of its first part; anything else, an empty literal included, is
 * `unknown` with target `""`.
 *
 * Confidence is `certain` when the callee is reached through an import of
 * its module (`import requests`, `import httpx as hx`, `from requests import
 * Session`) or the receiver is a name bound to a client's constructor in the
 * same function, class body or module scope (an assignment, or the target of
 * `with … as`/`async with … as`). A call whose receiver is not known is
 * `likely` only for `basic_publish`, `basic_consume` and `send_task`, which
 * no other listed client shares; `produce` and `send` are also unshared but
 * too common in other libraries to grade. Nothing else is reported, and a
 * call with no argument names nothing and is not reported either. The query
 * matches callees and constructors by name, so one imported under another
 * name (`from requests import get as fetch`) is not read; a module alias
 * (`import httpx as hx`) is.
 *
 * Out of scope: database and cache clients, boto3 and other cloud SDKs.
 *
 * @module lang-python/python-clients
 */

import { join } from "node:path";
import type { FactKind, OutboundCallFact } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";
import { PYTHON_PACKAGE } from "./package-paths.js";
import { argument, dotted, readWebFile, stringParts, stringValue, type WebCall, type WebFile } from "./python-web.js";

export const PYTHON_CLIENTS_QUERY = "python-clients";
const PREFIX = "clients";

// ── Provenance ──────────────────────────────────────────────────────────────

const rule = (verifiedAgainst: readonly string[], source: string): RuleProvenance => ({ verifiedAgainst, verifiedOn: "2026-10-16", source });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [PYTHON_CLIENTS_QUERY]: rule(
    ["tree-sitter-python@0.25.0", "Python 3.13"],
    "https://github.com/tree-sitter/tree-sitter-python/blob/v0.25.0/src/node-types.json",
  ),
  // The module functions and Session methods: `request(method, url)`, the verbs take `url` first.
  requests: rule(["requests 2.32"], "https://requests.readthedocs.io/en/latest/api/"),
  // Module functions mirror Client's methods; AsyncClient has the same signatures.
  httpx: rule(["httpx 0.28"], "https://www.python-httpx.org/api/"),
  aiohttp: rule(["aiohttp 3.11"], "https://docs.aiohttp.org/en/stable/client_reference.html"),
  urllib: rule(["Python 3.13"], "https://docs.python.org/3.13/library/urllib.request.html"),
  // grpc.aio's channel functions take the same `target` first.
  grpc: rule(["grpcio 1.68"], "https://grpc.github.io/grpc/python/grpc.html#create-client"),
  "confluent-kafka": rule(["confluent-kafka 2.6"], "https://docs.confluent.io/platform/current/clients/confluent-kafka-python/html/index.html"),
  "kafka-python": rule(["kafka-python 2.0"], "https://kafka-python.readthedocs.io/en/master/apidoc/modules.html"),
  // basic_publish(exchange, routing_key, body, …); basic_consume(queue, on_message_callback, …).
  pika: rule(["pika 1.3"], "https://pika.readthedocs.io/en/stable/modules/channel.html"),
  celery: rule(["Celery 5.4"], "https://docs.celeryq.dev/en/stable/reference/celery.html#celery.Celery.send_task"),
  env: rule(["Python 3.13"], "https://docs.python.org/3.13/library/os.html#os.environ"),
  // `from django.conf import settings`; pydantic-settings' BaseSettings reads fields the same way (`settings.X`).
  settings: rule(["Django 5.1", "pydantic-settings 2.6"], "https://docs.djangoproject.com/en/5.1/topics/settings/#using-settings-in-python-code"),
};

// ── Targets ─────────────────────────────────────────────────────────────────

type Target = Pick<OutboundCallFact, "target" | "targetSource">;

const UNKNOWN: Target = { target: "", targetSource: "unknown" };

const IDENTIFIER = /^[A-Za-z_]\w*$/;
/** `settings.X`, `django.conf.settings.X`, `self.settings.X`. */
const SETTING = /^(?:[A-Za-z_]\w*\.)*settings\.([A-Za-z_]\w*)$/;
/** How deep a target is unwrapped (parentheses, first parts, f-string fields). */
const MAX_DEPTH = 8;

/**
 * Where `char` first appears in `text` outside brackets and string literals;
 * -1 when it does not, and also when the brackets do not balance.
 */
export function topLevelIndex(text: string, char: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      const quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < text.length && !text.startsWith(quote, j)) j += text[j] === "\\" ? 2 : 1;
      i = j + quote.length - 1;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth < 0) return -1;
    else if (c === char && depth === 0) return i;
  }
  return -1;
}

/** True when `text` closes every bracket it opens and never closes one it did not. */
const balanced = (text: string): boolean => topLevelIndex(`${text}\u0000`, "\u0000") === text.length;

/** The text inside parentheses that wrap the whole of `text`; undefined otherwise. */
function unwrapped(text: string): string | undefined {
  if (!text.startsWith("(") || !text.endsWith(")")) return undefined;
  const inner = text.slice(1, -1);
  return balanced(inner) ? inner : undefined;
}

/** A plain string literal's value (no f-string), when it is one and not empty. */
function literalValue(text: string): string | undefined {
  const value = stringValue(text.trim());
  return value?.literal && value.text !== "" ? value.text : undefined;
}

/** Reads targets in one file: how a written name reaches an imported module. */
class TargetReader {
  constructor(private readonly qualify: (text: string) => string | undefined) {}

  /** Where an argument points; see the module comment. */
  of(node: Capture | undefined): Target {
    return node === undefined ? UNKNOWN : this.evaluate(node.text, 0);
  }

  /** The key of `os.environ["X"]`, `os.environ.get("X")` or `os.getenv("X")`: `X`, `""` when not a literal; undefined for anything else. */
  envKey(text: string): string | undefined {
    const subscript = /^([A-Za-z_][\w.\s]*?)\s*\[([\s\S]*)\]$/.exec(text);
    if (subscript && balanced(subscript[2]!) && this.qualify(subscript[1]!) === "os.environ") return literalValue(subscript[2]!) ?? "";
    const call = /^([A-Za-z_][\w.\s]*?)\s*\(([\s\S]*)\)$/.exec(text);
    if (!call || !balanced(call[2]!)) return undefined;
    const name = this.qualify(call[1]!);
    if (name !== "os.getenv" && name !== "os.environ.get") return undefined;
    const comma = topLevelIndex(call[2]!, ",");
    return literalValue(comma === -1 ? call[2]! : call[2]!.slice(0, comma)) ?? "";
  }

  private evaluate(written: string, depth: number): Target {
    const text = written.trim();
    if (depth > MAX_DEPTH) return UNKNOWN;
    const inner = unwrapped(text);
    if (inner !== undefined) return this.evaluate(inner, depth + 1);
    const parts = stringParts(text);
    if (parts !== undefined) {
      const first = parts[0];
      if (first === undefined) return UNKNOWN;
      return "literal" in first ? { target: first.literal, targetSource: "literal" } : this.evaluate(first.field, depth + 1);
    }
    const plus = topLevelIndex(text, "+");
    if (plus > 0) return this.evaluate(text.slice(0, plus), depth + 1);
    const key = this.envKey(text);
    if (key !== undefined) return key === "" ? UNKNOWN : { target: key, targetSource: "env" };
    const setting = SETTING.exec(dotted(text));
    return setting ? { target: setting[1]!, targetSource: "config" } : UNKNOWN;
  }
}

// ── Clients ─────────────────────────────────────────────────────────────────

/** What a reader can ask about the call's file. */
interface Reading {
  readonly file: WebFile;
  readonly targets: TargetReader;
  /** The client a node is, in the call's scope: a bound name or a constructor call. */
  typeOf(node: Capture): string | undefined;
}

/** A call's targets, one per fact; empty for none. */
type Reader = (call: WebCall, reading: Reading) => Target[];

/** The argument at `position`, else the one named `keyword`. */
const at =
  (position: number, keyword: string): Reader =>
  (call, { targets }) => [targets.of(argument(call, position, keyword))];

/** One target per entry of a topic list or tuple; a single other value is one target. */
const topics =
  (position: number, keyword: string): Reader =>
  (call, { file, targets }) => {
    const given = argument(call, position, keyword);
    if (given?.nodeType === "list" || given?.nodeType === "tuple") return file.itemsOf(given).map((item) => targets.of(item));
    return [targets.of(given)];
  };

const env: Reader = (call) => {
  const key = argument(call, 0, "key");
  const name = key === undefined ? undefined : literalValue(key.text);
  return [name === undefined ? UNKNOWN : { target: name, targetSource: "env" }];
};

const HTTP_VERBS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
/** `get(url, …)` and friends, and `request(method, url, …)`. */
const HTTP_METHODS: Readonly<Record<string, Reader>> = {
  ...Object.fromEntries(HTTP_VERBS.map((verb) => [verb, at(0, "url")])),
  request: at(1, "url"),
};
const onModule = (module: string, methods: Readonly<Record<string, Reader>>): Record<string, Reader> =>
  Object.fromEntries(Object.entries(methods).map(([name, read]) => [`${module}.${name}`, read]));

const REQUEST = "urllib.request.Request";
const PIKA_CONNECTION = "pika.connection";
const PIKA_CHANNEL = "pika.channel";

/** Constructors by qualified name → the client the result is. */
const CONSTRUCTORS: Readonly<Record<string, string>> = {
  "requests.Session": "requests.Session",
  "httpx.Client": "httpx.Client",
  "httpx.AsyncClient": "httpx.Client",
  "aiohttp.ClientSession": "aiohttp.ClientSession",
  [REQUEST]: REQUEST,
  "confluent_kafka.Producer": "confluent_kafka.Producer",
  "confluent_kafka.Consumer": "confluent_kafka.Consumer",
  "kafka.KafkaProducer": "kafka.KafkaProducer",
  "kafka.KafkaConsumer": "kafka.KafkaConsumer",
  "celery.Celery": "celery.Celery",
  "pika.BlockingConnection": PIKA_CONNECTION,
  "pika.SelectConnection": PIKA_CONNECTION,
};

/** Methods that make a new client from one: a pika connection's `channel()`. */
const METHOD_CONSTRUCTORS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [PIKA_CONNECTION]: { channel: PIKA_CHANNEL },
};

/** The constructor-pattern names in the query, so a test can hold the two in step. */
export const PYTHON_CLIENT_CONSTRUCTORS: readonly string[] = [
  ...new Set([...Object.keys(CONSTRUCTORS), ...Object.values(METHOD_CONSTRUCTORS).flatMap(Object.keys)].map((name) => name.split(".").at(-1)!)),
];

interface ClientRule {
  /** Provenance key. */
  readonly rule: string;
  readonly client: string;
  readonly kind: OutboundCallFact["kind"];
  /** Functions by qualified name: `requests.get`, `os.getenv`. */
  readonly functions?: Readonly<Record<string, Reader>>;
  /** Methods by the client the receiver is. */
  readonly instances?: Readonly<Record<string, Readonly<Record<string, Reader>>>>;
  /** Methods reported as `likely` when the receiver is not known. */
  readonly distinctive?: ReadonlySet<string>;
}

const RULES: readonly ClientRule[] = [
  { rule: "requests", client: "requests", kind: "http", functions: onModule("requests", HTTP_METHODS), instances: { "requests.Session": HTTP_METHODS } },
  { rule: "httpx", client: "httpx", kind: "http", functions: onModule("httpx", HTTP_METHODS), instances: { "httpx.Client": HTTP_METHODS } },
  { rule: "aiohttp", client: "aiohttp", kind: "http", instances: { "aiohttp.ClientSession": HTTP_METHODS } },
  {
    rule: "urllib",
    client: "urllib",
    kind: "http",
    functions: {
      // An urlopen of a Request (inline or a bound name) is reported at the Request.
      "urllib.request.urlopen": (call, reading) => {
        const url = argument(call, 0, "url");
        return url !== undefined && reading.typeOf(url) === REQUEST ? [] : [reading.targets.of(url)];
      },
      [REQUEST]: at(0, "url"),
    },
  },
  {
    rule: "grpc",
    client: "grpc",
    kind: "grpc",
    functions: Object.fromEntries(
      ["grpc", "grpc.aio"].flatMap((module) => ["insecure_channel", "secure_channel"].map((name) => [`${module}.${name}`, at(0, "target")])),
    ),
  },
  {
    rule: "confluent-kafka",
    client: "confluent_kafka",
    kind: "queue",
    instances: { "confluent_kafka.Producer": { produce: at(0, "topic") }, "confluent_kafka.Consumer": { subscribe: topics(0, "topics") } },
  },
  {
    rule: "kafka-python",
    client: "kafka-python",
    kind: "queue",
    // Topics are KafkaConsumer's positional arguments; with none, subscribe(…) names them.
    functions: { "kafka.KafkaConsumer": (call, { targets }) => call.positional.map((topic) => targets.of(topic)) },
    instances: { "kafka.KafkaProducer": { send: at(0, "topic") }, "kafka.KafkaConsumer": { subscribe: topics(0, "topics") } },
  },
  {
    rule: "pika",
    client: "pika",
    kind: "queue",
    instances: {
      [PIKA_CHANNEL]: {
        basic_publish: (call, { targets }) => {
          const exchange = argument(call, 0, "exchange");
          const value = exchange === undefined ? undefined : stringValue(exchange.text.trim());
          const defaultExchange = value?.literal === true && value.text === "";
          return [defaultExchange ? targets.of(argument(call, 1, "routing_key")) : targets.of(exchange)];
        },
        basic_consume: at(0, "queue"),
      },
    },
    distinctive: new Set(["basic_publish", "basic_consume"]),
  },
  { rule: "celery", client: "celery", kind: "queue", instances: { "celery.Celery": { send_task: at(0, "name") } }, distinctive: new Set(["send_task"]) },
  { rule: "env", client: "os.getenv", kind: "env", functions: { "os.getenv": env } },
  { rule: "env", client: "os.environ", kind: "env", functions: { "os.environ.get": env } },
];

/** The method and function names the query's argument pattern must match. */
export const PYTHON_CLIENT_CALLEES: readonly string[] = [
  ...new Set(
    RULES.flatMap((r) => [
      ...Object.keys(r.functions ?? {}).map((name) => name.split(".").at(-1)!),
      ...Object.values(r.instances ?? {}).flatMap(Object.keys),
    ]),
  ),
];

// ── One file ────────────────────────────────────────────────────────────────

const spanKey = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;

/** Each node once, in document order. */
function distinct(captures: readonly Capture[], name: string): Capture[] {
  const seen = new Set<string>();
  return captures.filter((c) => {
    if (c.name !== name || seen.has(spanKey(c))) return false;
    seen.add(spanKey(c));
    return true;
  });
}

/** One parsed file's outbound calls; its captures must include the `python-clients` query's. */
export function readPythonClientFile(file: PackSourceFile): OutboundCallFact[] {
  const own = file.captures[PYTHON_CLIENTS_QUERY] ?? [];
  // Every call the rules report has an argument, and every env subscript is captured.
  if (!own.some((c) => c.name === `${PREFIX}.argument` || c.name === `${PREFIX}.env`)) return [];
  const web = readWebFile({ path: file.path, captures: { ...file.captures, [PREFIX]: own } }, PREFIX);

  const qualify = (text: string): string | undefined => {
    const segments = dotted(text).split(".");
    if (!segments.every((s) => IDENTIFIER.test(s))) return undefined;
    const binding = web.bindings.get(segments[0]!);
    if (!binding) return undefined;
    const base = binding.name === undefined ? binding.module : `${binding.module}.${binding.name}`;
    return [base, ...segments.slice(1)].join(".");
  };
  const targets = new TargetReader(qualify);

  // Scopes: a function or class body; "" is the module.
  const definitions = file.captures.definitions ?? [];
  const scopes = definitions.filter((c) => c.name === "function.declaration" || c.name === "class.declaration");
  const scopeKeys = (nodes: readonly Capture[]): string[] => innermostEach(scopes, nodes).map((s) => (s ? spanKey(s) : ""));

  // Names bound to clients per scope; null when a scope binds a name to two different things.
  const bound = new Map<string, Map<string, string | null>>();
  const lookup = (scope: string, name: string): string | undefined => {
    for (const key of scope === "" ? [""] : [scope, ""]) {
      const names = bound.get(key);
      if (names?.has(name)) return names.get(name) ?? undefined;
    }
    return undefined;
  };
  const typeOfCall = (call: WebCall, scope: string, depth: number): string | undefined => {
    if (call.receiverNode !== undefined) {
      const receiver = typeOf(call.receiverNode, scope, depth + 1);
      if (receiver !== undefined) return METHOD_CONSTRUCTORS[receiver]?.[call.callee];
    }
    const name = qualify(call.receiver === undefined ? call.callee : `${call.receiver}.${call.callee}`);
    return name === undefined ? undefined : CONSTRUCTORS[name];
  };
  const typeOf = (node: Capture, scope: string, depth = 0): string | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    if (node.nodeType === "identifier") return lookup(scope, node.text);
    const call = node.nodeType === "call" ? web.callAt(node) : undefined;
    return call && typeOfCall(call, scope, depth);
  };
  // In document order, so `channel = connection.channel()` sees `connection`.
  const assignmentScopes = scopeKeys(web.assignments.map((a) => a.value));
  web.assignments.forEach((assignment, i) => {
    const scope = assignmentScopes[i]!;
    const call = web.callAt(assignment.value);
    const type = call && typeOfCall(call, scope, 0);
    const names = bound.get(scope) ?? new Map<string, string | null>();
    bound.set(scope, names);
    const before = names.get(assignment.target);
    names.set(assignment.target, names.has(assignment.target) && before !== type ? null : (type ?? null));
  });

  const facts: OutboundCallFact[] = [];
  const add = (node: Capture, rule: ClientRule, found: readonly Target[], confidence: "certain" | "likely"): void => {
    for (const target of found) facts.push({ kind: rule.kind, ...target, client: rule.client, confidence, position: node.start });
  };

  const callScopes = scopeKeys(web.calls.map((c) => c.invocation));
  web.calls.forEach((call, i) => {
    if (call.arity === 0) return;
    const scope = callScopes[i]!;
    const reading: Reading = { file: web, targets, typeOf: (node) => typeOf(node, scope) };
    const receiver = call.receiverNode === undefined ? undefined : typeOf(call.receiverNode, scope);
    if (receiver !== undefined) {
      for (const r of RULES) {
        const read = r.instances?.[receiver]?.[call.callee];
        if (read) add(call.invocation, r, read(call, reading), "certain");
      }
      return;
    }
    const name = qualify(call.receiver === undefined ? call.callee : `${call.receiver}.${call.callee}`);
    const matched = name === undefined ? [] : RULES.filter((r) => r.functions?.[name] !== undefined);
    for (const r of matched) add(call.invocation, r, r.functions![name!]!(call, reading), "certain");
    if (matched.length > 0 || call.receiver === undefined) return;
    for (const r of RULES) {
      if (!r.distinctive?.has(call.callee)) continue;
      const read = Object.values(r.instances ?? {}).find((methods) => methods[call.callee])?.[call.callee];
      if (read) add(call.invocation, r, read(call, reading), "likely");
    }
  });

  // env: `os.environ["X"]` lookups, writes left out.
  const writes = new Set(distinct(own, `${PREFIX}.env.write`).map(spanKey));
  const environ = RULES.find((r) => r.client === "os.environ")!;
  for (const lookup of distinct(own, `${PREFIX}.env`)) {
    if (writes.has(spanKey(lookup))) continue;
    const key = targets.envKey(lookup.text);
    if (key !== undefined) add(lookup, environ, [key === "" ? UNKNOWN : { target: key, targetSource: "env" }], "certain");
  }

  return facts.sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column);
}

// ── The framework ───────────────────────────────────────────────────────────

export const pythonClients: FrameworkPack = {
  id: "python-clients",
  produces: ["outboundCalls"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: PYTHON_CLIENTS_QUERY, path: join(PYTHON_PACKAGE.queryDir("python-clients"), `${PYTHON_CLIENTS_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts {
    if (!kinds.includes("outboundCalls")) return { facts: new Map(), notices: [] };
    return { facts: new Map(files.map((file) => [file.path, { outboundCalls: readPythonClientFile(file) }])), notices: [] };
  },
};
