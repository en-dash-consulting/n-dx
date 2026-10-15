/**
 * The Spring Boot framework module over the fixture project
 * (`tests/fixtures/spring-boot`): the rules a hand check would look for, and
 * how the pack entry runs the module only when its kinds are wanted. The
 * whole output is pinned by the golden in `pack-golden.test.ts`.
 */

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FactKind, FileFacts, OutboundCallFact, RouteFact } from "@n-dx/lang-kit";
import { createPackEntry, factGaps, listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";

import { JAVA_SYMBOL_RULES, javaGrammarPath, javaPack } from "../../src/java-pack.js";
import { JAVA_PACKAGE } from "../../src/package-paths.js";
import { pack } from "../../src/pack.js";
import { joinRoutePath, springBoot, targetOf } from "../../src/spring-boot.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const dir = join(PACK_FIXTURE_ROOT, "..", "spring-boot");
const files = listFixtureFiles(dir, [".java"]);

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

async function analyze(ctx: Ctx, kinds: readonly FactKind[]) {
  skipUnlessGrammar(ctx, javaGrammarPath());
  return pack.analyzeProject({ projectDir: dir, files, kinds });
}

const of = (facts: readonly FileFacts[], file: string): FileFacts => facts.find((f) => f.path.endsWith(file))!;
const route = (r: RouteFact): string => `${r.method ?? "ANY"} ${r.path} ${r.handler}`;
const call = (c: OutboundCallFact): string => `${c.kind} ${c.client} ${c.targetSource}:${c.target} ${c.confidence}`;

describe("Spring Boot routes", () => {
  it("joins the class prefix, reads every mapping, arrays and methods, and skips what is not a literal", async (ctx) => {
    const { facts, notices } = await analyze(ctx, ["routes"]);
    expect(of(facts, "OwnerController.java").routes?.map(route)).toEqual([
      "GET /api/owners list",
      "POST /api create",
      "PUT /api/owners/{id} replace",
      "DELETE /api/owners/{id} remove",
      "PATCH /api/owners/{id} patch",
      "PATCH /api/people/{id} patch",
      "GET /api/legacy legacy",
      "PUT /api/bulk bulk",
      "POST /api/bulk bulk",
      "ANY /api/any any",
      "GET /api/kept partly",
    ]);
    expect(of(facts, "PetController.java").routes?.map(route)).toEqual(["GET /pets/{petId} show", "GET /animals/{petId} show"]);
    expect(of(facts, "ReportService.java").routes).toEqual([]);
    expect(of(facts, "InventoryClient.java").routes).toEqual([]);
    expect(notices).toEqual([
      "Spring Boot: 2 request mapping values are not literals and were skipped: " +
        "src/com/example/web/OwnerController.java:37 (path PATH), " +
        'src/com/example/web/OwnerController.java:40 (path PATH + "/dropped").',
    ]);
  });

  it("gives a route no method when its mapping names none, and places it at the annotation", async (ctx) => {
    const { facts } = await analyze(ctx, ["routes"]);
    const any = of(facts, "OwnerController.java").routes?.find((r) => r.handler === "any");
    expect(any).toEqual({ path: "/api/any", handler: "any", position: { line: 34, column: 2 } });
  });

  it("joins a prefix and a path with exactly one slash", () => {
    expect(joinRoutePath("/pets/", "/{id}")).toBe("/pets/{id}");
    expect(joinRoutePath("animals", "{id}")).toBe("/animals/{id}");
    expect(joinRoutePath("/api", "")).toBe("/api");
    expect(joinRoutePath("", "")).toBe("/");
    expect(joinRoutePath("", "owners/")).toBe("/owners/");
  });
});

describe("Spring Boot outbound calls", () => {
  it("reads HTTP clients, gRPC and environment reads with their targets and confidence", async (ctx) => {
    const { facts } = await analyze(ctx, ["outboundCalls"]);
    expect(of(facts, "HttpClients.java").outboundCalls?.map(call)).toEqual([
      "http RestTemplate config:orders.url certain",
      "http RestTemplate literal:http://billing/charge certain",
      "http RestTemplate unknown: certain",
      "http RestTemplate literal:http://billing/charge/1 certain",
      "http RestTemplate literal:http://catalog/items likely",
      "http WebClient literal:/inventory certain",
      "http RestClient config:payments.url certain",
      "http WebClient literal:http://inventory:8080 certain",
      "http RestClient literal:http://payments:8080 certain",
      "http RestClient literal:/status certain",
      "http HttpClient literal:https://api.example.com/v1 certain",
      "http HttpClient literal:https://chain.example.com certain",
      "grpc ManagedChannelBuilder literal:orders.internal:9090 certain",
      "grpc ManagedChannelBuilder literal:dns:///inventory:443 certain",
      "env System.getenv env:DATABASE_URL certain",
    ]);
  });

  it("counts queue producers and consumers", async (ctx) => {
    const { facts } = await analyze(ctx, ["outboundCalls"]);
    expect(of(facts, "Messaging.java").outboundCalls?.map(call)).toEqual([
      "queue KafkaTemplate literal:orders certain",
      "queue KafkaTemplate unknown: certain",
      "queue JmsTemplate literal:queue.audit certain",
      "queue RabbitTemplate literal:exchange.orders certain",
      "queue RabbitTemplate literal:orders.retry certain",
      "queue KafkaListener literal:orders certain",
      "queue KafkaListener config:topics.refunds certain",
      "queue JmsListener literal:queue.audit certain",
      "queue RabbitListener literal:orders.q certain",
    ]);
  });

  it("reads one fact per Feign client: its url, else its name as a config key", async (ctx) => {
    const { facts } = await analyze(ctx, ["outboundCalls"]);
    expect(of(facts, "InventoryClient.java").outboundCalls?.map(call)).toEqual([
      "http FeignClient config:inventory.url certain",
      "http FeignClient config:catalog certain",
    ]);
  });

  it("reads a leading placeholder's key, with or without a default, and nothing else as config", () => {
    const string = (text: string) => ({ name: "spring.argument", nodeType: "string_literal", text, start: { line: 1, column: 0 }, end: { line: 1, column: 0 } });
    expect(targetOf(string('"${orders.url:http://localhost}/x"'))).toEqual({ target: "orders.url", targetSource: "config" });
    expect(targetOf(string('"http://${host}/x"'))).toEqual({ target: "http://${host}/x", targetSource: "literal" });
    expect(targetOf({ ...string("url"), nodeType: "identifier" })).toEqual({ target: "", targetSource: "unknown" });
  });
});

describe("the Java pack entry with Spring Boot", () => {
  it("lists routes and outbound calls and is consistent with its framework", () => {
    expect(pack.produces).toEqual(["imports", "symbols", "calls", "routes", "outboundCalls"]);
    expect(factGaps(javaPack, JAVA_SYMBOL_RULES)).toEqual([]);
    expect(Object.keys(springBoot.provenance).sort()).toEqual(
      ["env", "feign", "grpc", "java-http-client", "jms", "kafka", "rabbit", "rest-client", "rest-template", "routes", "spring-boot", "web-client"],
    );
  });

  it("runs the framework only when one of its kinds is wanted, and returns only the kinds asked for", async (ctx) => {
    skipUnlessGrammar(ctx, javaGrammarPath());
    const read = vi.fn(springBoot.read);
    const entry = createPackEntry({
      package: JAVA_PACKAGE,
      pack: { ...javaPack, frameworks: [{ ...springBoot, queries: springBoot.queries, read }] },
      symbolRules: JAVA_SYMBOL_RULES,
    });

    const imports = await entry.analyzeProject({ projectDir: dir, files, kinds: ["imports"] });
    expect(read).not.toHaveBeenCalled();
    expect(imports.notices).toBeUndefined();
    expect(imports.facts.every((f) => f.routes === undefined && f.outboundCalls === undefined)).toBe(true);

    const routes = await entry.analyzeProject({ projectDir: dir, files, kinds: ["routes"] });
    expect(read).toHaveBeenCalledOnce();
    expect(routes.facts.every((f) => Array.isArray(f.routes) && f.outboundCalls === undefined && f.imports === undefined)).toBe(true);
  });
});
