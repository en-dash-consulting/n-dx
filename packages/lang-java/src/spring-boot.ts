/**
 * Spring Boot rules over the Java pack: request routes and outbound calls.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/spring-boot/spring-boot.scm`) runs in the Java parse only when
 * routes or outbound calls are wanted, and these rules read its captures
 * together with the Java queries' `annotations`, `declarations`, `methods` and
 * `calls`.
 *
 * Nothing is guessed. A mapping path that is not a string literal is skipped
 * and counted in the pack's notices. A target that is not a string literal is
 * `unknown`; a Spring placeholder (`"${orders.url}"`, alone or leading a
 * literal) is `config` with its key. A call on a field, local or parameter
 * declared as the client type, or on the client class itself, is `certain`;
 * a call whose receiver type is not known is `likely` only for a method name
 * no other client shares (`getForObject`), and is not reported otherwise.
 *
 * @module lang-java/spring-boot
 */

import { join } from "node:path";
import type { FactKind, OutboundCallFact, RouteFact, SourcePosition } from "@n-dx/lang-kit";
import {
  callSites,
  contains,
  innermost,
  type CallSite,
  type Capture,
  type FrameworkFacts,
  type FrameworkPack,
  type PackSourceFile,
  type RuleProvenance,
} from "@n-dx/lang-runtime";
import { javaStringValue } from "./java-sql.js";
import { JAVA_PACKAGE } from "./package-paths.js";

export const SPRING_BOOT_QUERY = "spring-boot";

// ── Provenance ──────────────────────────────────────────────────────────────

const VERIFIED_ON = "2026-10-15";
const SPRING = ["Spring Framework 6.2", "Spring Boot 3.5"];
const javadoc = (path: string): string => `https://docs.spring.io/spring-framework/docs/6.2.x/javadoc-api/${path}`;

const rule = (verifiedAgainst: readonly string[], source: string): RuleProvenance => ({
  verifiedAgainst,
  verifiedOn: VERIFIED_ON,
  source,
});

/** One record per rule; rule names are the keys used in this module's comments. */
const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [SPRING_BOOT_QUERY]: rule(
    ["tree-sitter-java@0.23.5", "Java 21"],
    "https://github.com/tree-sitter/tree-sitter-java/blob/v0.23.5/src/node-types.json",
  ),
  routes: rule(SPRING, javadoc("org/springframework/web/bind/annotation/RequestMapping.html")),
  "rest-template": rule(SPRING, javadoc("org/springframework/web/client/RestTemplate.html")),
  "web-client": rule(SPRING, javadoc("org/springframework/web/reactive/function/client/WebClient.html")),
  "rest-client": rule(SPRING, javadoc("org/springframework/web/client/RestClient.html")),
  feign: rule(
    ["Spring Cloud OpenFeign 5.0"],
    "https://docs.spring.io/spring-cloud-openfeign/reference/spring-cloud-openfeign.html",
  ),
  "java-http-client": rule(["Java 21"], "https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpRequest.html"),
  kafka: rule(["Spring for Apache Kafka 4.1"], "https://docs.spring.io/spring-kafka/reference/kafka/sending-messages.html"),
  jms: rule(SPRING, javadoc("org/springframework/jms/core/JmsTemplate.html")),
  rabbit: rule(["Spring AMQP 4.1"], "https://docs.spring.io/spring-amqp/reference/amqp/template.html"),
  grpc: rule(["grpc-java 1.68"], "https://grpc.github.io/grpc-java/javadoc/io/grpc/ManagedChannelBuilder.html"),
  env: rule(["Java 21"], "https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/System.html#getenv(java.lang.String)"),
};

// ── Captures ────────────────────────────────────────────────────────────────

const COMMENTS: ReadonlySet<string> = new Set(["line_comment", "block_comment"]);

/** Last segment of a possibly qualified, possibly generic type or annotation name. */
const simpleName = (text: string): string => {
  const bare = text.replace(/<[\s\S]*>/, "").replace(/\[\s*\]/g, "").replace(/\s+/g, "");
  return bare.slice(bare.lastIndexOf(".") + 1);
};

const before = (a: SourcePosition, b: SourcePosition): boolean => a.line < b.line || (a.line === b.line && a.column < b.column);

const sameSpan = (a: Capture, b: Capture): boolean =>
  a.start.line === b.start.line && a.start.column === b.start.column && a.end.line === b.end.line && a.end.column === b.end.column;

/** Each of `captured` under its innermost owner among `owners`. */
function byOwner(owners: readonly Capture[], captured: readonly Capture[]): Map<Capture, Capture[]> {
  const owned = new Map<Capture, Capture[]>();
  for (const c of captured) {
    const owner = innermost(owners, c);
    if (owner) owned.set(owner, [...(owned.get(owner) ?? []), c]);
  }
  return owned;
}

interface Element {
  /** `value` for the unnamed element. */
  readonly key: string;
  /** The value's nodes: the array's entries for an array, else the value itself. */
  readonly values: readonly Capture[];
}

interface Annotation {
  readonly name: string;
  readonly use: Capture;
  readonly elements: readonly Element[];
}

const element = (annotation: Annotation, ...keys: string[]): Element | undefined =>
  annotation.elements.find((e) => keys.includes(e.key));

function readAnnotations(file: PackSourceFile): Annotation[] {
  const java = file.captures.annotations ?? [];
  const spring = file.captures[SPRING_BOOT_QUERY] ?? [];
  const named = (from: readonly Capture[], name: string): Capture[] => from.filter((c) => c.name === name);
  const uses = named(java, "annotation.use");
  const names = byOwner(uses, named(java, "annotation.name"));
  const elements = named(spring, "spring.element").filter((e) => !COMMENTS.has(e.nodeType));
  const elementsByUse = byOwner(uses, elements);
  const keys = byOwner(elements, named(spring, "spring.key"));
  const values = byOwner(elements, named(spring, "spring.value"));
  const items = byOwner(elements, named(spring, "spring.item").filter((i) => !COMMENTS.has(i.nodeType)));

  const valuesOf = (owner: Capture, value: Capture): Capture[] =>
    value.nodeType === "element_value_array_initializer" ? (items.get(owner) ?? []).filter((i) => contains(value, i)) : [value];

  return uses.map((use) => ({
    name: simpleName(names.get(use)?.[0]?.text ?? ""),
    use,
    elements: (elementsByUse.get(use) ?? []).flatMap((e): Element[] => {
      if (e.nodeType !== "element_value_pair") return [{ key: "value", values: valuesOf(e, e) }];
      const key = keys.get(e)?.[0];
      const value = values.get(e)?.[0];
      return key && value ? [{ key: key.text, values: valuesOf(e, value) }] : [];
    }),
  }));
}

interface Declaration {
  readonly node: Capture;
  readonly name: Capture;
  readonly annotations: readonly Annotation[];
}

interface TypeDeclaration extends Declaration {
  /** `class`, `interface`, `enum`, `record` or `annotation`. */
  readonly kind: string;
}

interface Declarations {
  readonly types: readonly TypeDeclaration[];
  readonly methods: readonly Declaration[];
  /** The type whose own member `method` is; absent inside an anonymous class or with no type around it. */
  ownerOf(method: Declaration): TypeDeclaration | undefined;
}

/** Types and methods with the annotations written before their names. */
function readDeclarations(file: PackSourceFile, annotations: readonly Annotation[]): Declarations {
  const decl = file.captures.declarations ?? [];
  const meth = file.captures.methods ?? [];
  const typeNodes = decl.filter((c) => c.name.startsWith("type.") && c.name !== "type.name");
  const methodNodes = meth.filter((c) => c.name === "method.declaration");
  const typeNames = byOwner(typeNodes, decl.filter((c) => c.name === "type.name"));
  const methodNames = byOwner(methodNodes, meth.filter((c) => c.name === "method.name"));
  const all = [...typeNodes, ...methodNodes];
  const annotationsByDecl = byOwner(all, annotations.map((a) => a.use));
  const annotationOf = new Map(annotations.map((a) => [a.use, a]));

  const declaration = (node: Capture, name: Capture): Declaration => ({
    node,
    name,
    annotations: (annotationsByDecl.get(node) ?? []).filter((use) => before(use.start, name.start)).map((use) => annotationOf.get(use)!),
  });
  const types = typeNodes.flatMap((node): TypeDeclaration[] => {
    const name = typeNames.get(node)?.[0];
    return name ? [{ ...declaration(node, name), kind: node.name.slice("type.".length) }] : [];
  });
  const methods = methodNodes.flatMap((node) => {
    const name = methodNames.get(node)?.[0];
    return name ? [declaration(node, name)] : [];
  });
  // An anonymous class body between a method and its type makes it no member of that type.
  const bodies = decl.filter((c) => c.name === "anonymous.body");
  return {
    types,
    methods,
    ownerOf(method) {
      const owner = innermost([...types.map((t) => t.node), ...bodies], method.node);
      return types.find((t) => t.node === owner);
    },
  };
}

// ── Routes (rule: routes) ───────────────────────────────────────────────────

const CONTROLLERS: ReadonlySet<string> = new Set(["RestController", "Controller"]);
const MAPPING_METHODS: Readonly<Record<string, string | undefined>> = {
  GetMapping: "GET",
  PostMapping: "POST",
  PutMapping: "PUT",
  DeleteMapping: "DELETE",
  PatchMapping: "PATCH",
  RequestMapping: undefined,
};
const HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]);

/** A mapping value skipped because it is not a literal. */
export interface SpringSkip {
  readonly path: string;
  readonly position: SourcePosition;
  /** What the value would have given: a route path or an HTTP method. */
  readonly what: "path" | "method";
  /** The value as written. */
  readonly text: string;
}

const literal = (node: Capture): string | undefined =>
  node.nodeType === "string_literal" ? javaStringValue(node.text).text : undefined;

/** Join a prefix and a path with exactly one slash; the result starts with one. */
export function joinRoutePath(prefix: string, path: string): string {
  const head = prefix.replace(/\/+$/, "");
  const tail = path.replace(/^\/+/, "");
  const joined = tail === "" ? head : `${head}/${tail}`;
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function readRoutes(file: PackSourceFile, declarations: Declarations, skipped: SpringSkip[]): RouteFact[] {
  const skip = (node: Capture, what: SpringSkip["what"]): void =>
    void skipped.push({ path: file.path, position: node.start, what, text: node.text });

  /** Literal paths of a mapping: `value`, `path` or the unnamed value; `[""]` when it names none. */
  const paths = (mapping: Annotation): string[] => {
    const given = element(mapping, "value", "path");
    if (!given) return [""];
    return given.values.flatMap((node) => {
      const text = literal(node);
      if (text === undefined) skip(node, "path");
      return text === undefined ? [] : [text];
    });
  };

  // Controller classes and their literal prefixes; a class `@RequestMapping` is a prefix, `[""]` without one.
  const prefixes = new Map<TypeDeclaration, string[]>();
  for (const type of declarations.types) {
    if (type.kind !== "class" || !type.annotations.some((a) => CONTROLLERS.has(a.name))) continue;
    const mapping = type.annotations.find((a) => a.name === "RequestMapping");
    prefixes.set(type, mapping ? paths(mapping) : [""]);
  }

  const routes: RouteFact[] = [];
  for (const method of declarations.methods) {
    const owner = declarations.ownerOf(method);
    const prefixList = owner && prefixes.get(owner);
    if (!prefixList) continue;
    for (const mapping of method.annotations.filter((a) => a.name in MAPPING_METHODS)) {
      const fixed = MAPPING_METHODS[mapping.name];
      let verbs: (string | undefined)[] = [fixed];
      if (mapping.name === "RequestMapping") {
        const given = element(mapping, "method");
        verbs = given
          ? given.values.flatMap((node) => {
              const verb = simpleName(node.text);
              if (!HTTP_METHODS.has(verb)) skip(node, "method");
              return HTTP_METHODS.has(verb) ? [verb] : [];
            })
          : [undefined];
      }
      const pathList = paths(mapping);
      for (const prefix of prefixList) {
        for (const path of pathList) {
          for (const verb of verbs) {
            routes.push({
              ...(verb === undefined ? {} : { method: verb }),
              path: joinRoutePath(prefix, path),
              handler: method.name.text,
              position: mapping.use.start,
            });
          }
        }
      }
    }
  }
  return routes;
}

// ── Outbound calls ──────────────────────────────────────────────────────────

type Target = Pick<OutboundCallFact, "target" | "targetSource">;
type Confidence = NonNullable<OutboundCallFact["confidence"]>;

const UNKNOWN: Target = { target: "", targetSource: "unknown" };

/** A leading Spring placeholder: `${orders.url}`, `${orders.url:default}`. */
const PLACEHOLDER = /^\$\{([^}:]+)(?::[^}]*)?\}/;

/** Where a string argument points: a literal, a leading placeholder's key, else unknown. An empty literal names nothing. */
export function targetOf(node: Capture | undefined): Target {
  const text = node === undefined ? undefined : literal(node);
  if (text === undefined || text === "") return UNKNOWN;
  const placeholder = PLACEHOLDER.exec(text);
  return placeholder ? { target: placeholder[1]!.trim(), targetSource: "config" } : { target: text, targetSource: "literal" };
}

interface Call {
  readonly site: CallSite;
  readonly callee: string;
  readonly args: readonly Capture[];
  readonly position: SourcePosition;
}

/** A client whose calls are read by method name, with where each method's target is. */
interface ClientRule {
  readonly rule: string;
  readonly client: string;
  readonly kind: OutboundCallFact["kind"];
  /** Declared types (simple names) that make a receiver this client. */
  readonly types: ReadonlySet<string>;
  /** Method → the call's target; absent when the method is not an outbound call. */
  readonly methods: Readonly<Record<string, (args: readonly Capture[]) => Target>>;
  /** Methods no other client shares, reported as `likely` when the receiver type is not known. */
  readonly distinctive?: ReadonlySet<string>;
}

const first = (args: readonly Capture[]): Target => targetOf(args[0]);
/** The first argument when there are at least two; one argument is the payload alone, sent to a configured default. */
const firstOfTwo = (args: readonly Capture[]): Target => (args.length >= 2 ? targetOf(args[0]) : UNKNOWN);
const each = <T>(names: readonly string[], value: T): Record<string, T> => Object.fromEntries(names.map((n) => [n, value]));

const CLIENT_RULES: readonly ClientRule[] = [
  {
    rule: "rest-template",
    client: "RestTemplate",
    kind: "http",
    types: new Set(["RestTemplate", "RestOperations"]),
    methods: each(["getForObject", "getForEntity", "postForObject", "postForEntity", "put", "delete", "exchange", "execute"], first),
    distinctive: new Set(["getForObject", "getForEntity", "postForObject", "postForEntity"]),
  },
  {
    rule: "kafka",
    client: "KafkaTemplate",
    kind: "queue",
    types: new Set(["KafkaTemplate", "KafkaOperations"]),
    methods: { send: firstOfTwo },
  },
  {
    rule: "jms",
    client: "JmsTemplate",
    kind: "queue",
    types: new Set(["JmsTemplate", "JmsOperations"]),
    methods: each(["send", "convertAndSend"], firstOfTwo),
  },
  {
    rule: "rabbit",
    client: "RabbitTemplate",
    kind: "queue",
    types: new Set(["RabbitTemplate", "RabbitOperations", "AmqpTemplate"]),
    // (exchange, routingKey, message…): the exchange, or the routing key on the default exchange "";
    // (routingKey, message): the routing key.
    methods: {
      convertAndSend: (args) => {
        if (args.length < 2) return UNKNOWN;
        const defaultExchange = args[0] !== undefined && literal(args[0]) === "";
        return args.length >= 3 && defaultExchange ? targetOf(args[1]) : targetOf(args[0]);
      },
    },
  },
];

/** Builder chains whose `.uri(…)` after an HTTP verb is the call (rules: web-client, rest-client). */
const CHAIN_CLIENTS: ReadonlySet<string> = new Set(["WebClient", "RestClient"]);
const CHAIN_VERBS: ReadonlySet<string> = new Set(["get", "post", "put", "delete", "patch", "head", "options", "method"]);

/** Listener annotations and the element naming what they consume (rules: kafka, jms, rabbit). */
const LISTENERS: Readonly<Record<string, { readonly keys: readonly string[]; readonly rule: string }>> = {
  KafkaListener: { keys: ["topics"], rule: "kafka" },
  JmsListener: { keys: ["destination"], rule: "jms" },
  RabbitListener: { keys: ["queues"], rule: "rabbit" },
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const QUALIFIED = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function readOutbound(file: PackSourceFile, annotations: readonly Annotation[], declarations: Declarations): OutboundCallFact[] {
  const spring = file.captures[SPRING_BOOT_QUERY] ?? [];
  const sites = callSites(file.captures.calls ?? []);
  const argsByList = byOwner(
    sites.map((s) => s.arguments),
    spring.filter((c) => c.name === "spring.argument" && !COMMENTS.has(c.nodeType)),
  );
  const calls: Call[] = sites.flatMap((site) =>
    site.name ? [{ site, callee: site.name.text, args: argsByList.get(site.arguments) ?? [], position: (site.invocation ?? site.name).start }] : [],
  );
  /** The call whose whole invocation is `node`, e.g. a receiver or an argument. */
  const callAt = (node: Capture | undefined): Call | undefined =>
    node === undefined ? undefined : calls.find((c) => c.site.invocation !== undefined && sameSpan(c.site.invocation, node));

  // Declared types by name. A name declared with two types in one file is not resolved; `var` declares none.
  const variables = spring.filter((c) => c.name === "spring.variable");
  const typesOf = byOwner(variables, spring.filter((c) => c.name === "spring.variable.type"));
  const declared = new Map<string, Set<string>>();
  for (const name of spring.filter((c) => c.name === "spring.variable.name")) {
    const declaration = innermost(variables, name);
    const type = declaration && typesOf.get(declaration)?.[0];
    if (!type) continue;
    declared.set(name.text, (declared.get(name.text) ?? new Set()).add(simpleName(type.text)));
  }

  /** The receiver's type: declared, or the class itself for a static call; undefined when not known. */
  const typeOf = (receiver: Capture | undefined): string | undefined => {
    if (receiver === undefined) return undefined;
    const text = receiver.text.replace(/\s+/g, "").replace(/^this\./, "");
    if (IDENTIFIER.test(text)) {
      const types = declared.get(text);
      if (types) return types.size === 1 && !types.has("var") ? [...types][0] : undefined;
      return /^[A-Z]/.test(text) ? text : undefined;
    }
    // `java.net.http.HttpRequest`: a qualified class name.
    const last = simpleName(text);
    return QUALIFIED.test(text) && /^[A-Z]/.test(last) ? last : undefined;
  };
  /** The type at the root of a call chain: `webClient` in `webClient.get().uri(…)`. */
  const rootType = (call: Call): string | undefined => {
    let current = call;
    for (let next = callAt(current.site.receiver); next; next = callAt(current.site.receiver)) current = next;
    return typeOf(current.site.receiver);
  };
  /** The calls chained on `call`: `.uri(…)` in `HttpRequest.newBuilder().uri(…)`. */
  const chainedOn = (call: Call): Call[] => {
    const out: Call[] = [];
    for (let next = calls.find((c) => c.site.receiver && call.site.invocation && sameSpan(c.site.receiver, call.site.invocation)); next; ) {
      out.push(next);
      const at = next.site.invocation;
      next = at && calls.find((c) => c.site.receiver !== undefined && sameSpan(c.site.receiver, at));
    }
    return out;
  };
  /** `URI.create("…")` unwrapped to its argument; anything else as is. */
  const uriArgument = (node: Capture | undefined): Capture | undefined => {
    const inner = callAt(node);
    return inner && inner.callee === "create" && typeOf(inner.site.receiver) === "URI" ? inner.args[0] : node;
  };

  const facts: OutboundCallFact[] = [];
  const add = (call: { position: SourcePosition }, kind: OutboundCallFact["kind"], client: string, target: Target, confidence: Confidence): void =>
    void facts.push({ kind, ...target, client, confidence, position: call.position });

  for (const call of calls) {
    const receiverType = typeOf(call.site.receiver);
    const receiverCall = callAt(call.site.receiver);

    for (const client of CLIENT_RULES) {
      const read = client.methods[call.callee];
      if (!read || call.site.receiver === undefined) continue;
      if (receiverType !== undefined && client.types.has(receiverType)) add(call, client.kind, client.client, read(call.args), "certain");
      else if (receiverType === undefined && client.distinctive?.has(call.callee) && call.args.length > 0) {
        add(call, client.kind, client.client, read(call.args), "likely");
      }
    }

    // web-client, rest-client: `<client>.get().uri(…)`, and `<Client>.create(url)`.
    if (call.callee === "uri" && receiverCall && CHAIN_VERBS.has(receiverCall.callee)) {
      const root = rootType(receiverCall);
      if (root !== undefined && CHAIN_CLIENTS.has(root)) add(call, "http", root, first(call.args), "certain");
    }
    if (call.callee === "create" && receiverType !== undefined && CHAIN_CLIENTS.has(receiverType) && call.args.length > 0) {
      add(call, "http", receiverType, first(call.args), "certain");
    }

    // java-http-client: `HttpRequest.newBuilder(URI.create(…))` or `HttpRequest.newBuilder().uri(URI.create(…))`.
    if (call.callee === "newBuilder" && receiverType === "HttpRequest") {
      const uri = call.args.length > 0 ? call.args[0] : chainedOn(call).find((c) => c.callee === "uri")?.args[0];
      add(call, "http", "HttpClient", targetOf(uriArgument(uri)), "certain");
    }

    // grpc: `ManagedChannelBuilder.forAddress(host, port)` and `.forTarget(target)`.
    if (receiverType === "ManagedChannelBuilder" && (call.callee === "forAddress" || call.callee === "forTarget")) {
      let target = first(call.args);
      const port = call.args[1];
      if (call.callee === "forAddress" && target.targetSource === "literal" && port?.nodeType === "decimal_integer_literal") {
        target = { ...target, target: `${target.target}:${port.text}` };
      }
      add(call, "grpc", "ManagedChannelBuilder", target, "certain");
    }

    // env: `System.getenv("NAME")`.
    if (call.callee === "getenv" && receiverType === "System" && call.args.length === 1) {
      const name = targetOf(call.args[0]);
      add(call, "env", "System.getenv", name.targetSource === "literal" ? { target: name.target, targetSource: "env" } : UNKNOWN, "certain");
    }
  }

  // Consumers: one fact per topic, destination or queue a listener names.
  for (const annotation of annotations) {
    const listener = LISTENERS[annotation.name];
    if (!listener) continue;
    const named = element(annotation, ...listener.keys);
    const at = { position: annotation.use.start };
    if (!named || named.values.length === 0) add(at, "queue", annotation.name, UNKNOWN, "certain");
    else for (const value of named.values) add(at, "queue", annotation.name, targetOf(value), "certain");
  }

  // feign: one fact per `@FeignClient` interface: its `url`, else its name as a config key.
  for (const type of declarations.types) {
    const feign = type.annotations.find((a) => a.name === "FeignClient");
    if (!feign) continue;
    // `url = ""` is Feign's default: no url, so the name is the target.
    const written = element(feign, "url")?.values[0];
    const url = written !== undefined && literal(written) === "" ? undefined : written;
    const name = element(feign, "name", "value")?.values[0];
    const byName = targetOf(name);
    const target = url ? targetOf(url) : byName.targetSource === "unknown" ? UNKNOWN : { target: byName.target, targetSource: "config" as const };
    add({ position: feign.use.start }, "http", "FeignClient", target, "certain");
  }

  return facts.sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column);
}

// ── The framework ───────────────────────────────────────────────────────────

/** One file's Spring facts, with the mapping values skipped there. */
export interface SpringFileFacts {
  readonly path: string;
  readonly routes: readonly RouteFact[];
  readonly outboundCalls: readonly OutboundCallFact[];
  readonly skipped: readonly SpringSkip[];
}

/** Read one parsed file's routes and outbound calls; its captures must include the `spring-boot` query's. */
export function readSpringFile(file: PackSourceFile): SpringFileFacts {
  const annotations = readAnnotations(file);
  const declarations = readDeclarations(file, annotations);
  const skipped: SpringSkip[] = [];
  const routes = readRoutes(file, declarations, skipped);
  return { path: file.path, routes, outboundCalls: readOutbound(file, annotations, declarations), skipped };
}

/** How many notices name a location before the rest are counted. */
const NOTICE_LOCATIONS = 5;

/** The notice for mapping values skipped across a project; undefined when none were. */
export function skippedNotice(skipped: readonly SpringSkip[]): string | undefined {
  if (skipped.length === 0) return undefined;
  const where = skipped.slice(0, NOTICE_LOCATIONS).map((s) => `${s.path}:${s.position.line} (${s.what} ${s.text})`);
  const more = skipped.length > NOTICE_LOCATIONS ? `, and ${skipped.length - NOTICE_LOCATIONS} more` : "";
  const subject =
    skipped.length === 1
      ? "1 request mapping value is not a literal and was skipped"
      : `${skipped.length} request mapping values are not literals and were skipped`;
  return `Spring Boot: ${subject}: ${where.join(", ")}${more}.`;
}

export const springBoot: FrameworkPack = {
  id: "spring-boot",
  produces: ["routes", "outboundCalls"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: SPRING_BOOT_QUERY, path: join(JAVA_PACKAGE.queryDir("spring-boot"), `${SPRING_BOOT_QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts {
    const wantsRoutes = kinds.includes("routes");
    const wantsOutbound = kinds.includes("outboundCalls");
    const skipped: SpringSkip[] = [];
    const facts = new Map(
      files.map((file) => {
        const read = readSpringFile(file);
        if (wantsRoutes) skipped.push(...read.skipped);
        return [
          file.path,
          { ...(wantsRoutes ? { routes: read.routes } : {}), ...(wantsOutbound ? { outboundCalls: read.outboundCalls } : {}) },
        ] as const;
      }),
    );
    const notice = skippedNotice(skipped);
    return { facts, notices: notice === undefined ? [] : [notice] };
  },
};
