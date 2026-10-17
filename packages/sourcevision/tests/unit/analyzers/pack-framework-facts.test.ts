/**
 * Pack routes and outbound-call facts merged into serverRoutes and
 * outbound.json: shapes, role filters, defaults, order and the no-facts
 * identity.
 */

import { describe, expect, it } from "vitest";

import type { OutboundCallFact, RouteFact } from "@n-dx/lang-kit";
import {
  packOutboundDependencies,
  packRouteGroups,
  withPackOutbound,
  withPackRouteGroups,
  type PackFrameworkFacts,
} from "../../../src/analyzers/pack-framework-facts.js";
import type { Inventory, OutboundData, ServerRouteGroup } from "../../../src/schema/v1.js";

const inventory = (files: Record<string, string>): Inventory =>
  ({
    files: Object.entries(files).map(([path, role]) => ({ path, size: 1, language: "Java", lineCount: 1, hash: "x", role, category: "code" })),
  }) as unknown as Inventory;

const at = (line: number) => ({ line, column: 0 });
const route = (path: string, method?: string, handler = "h", line = 1): RouteFact => ({
  ...(method === undefined ? {} : { method }),
  path,
  handler,
  position: at(line),
});
const call = (line: number, extra: Partial<OutboundCallFact> = {}): OutboundCallFact => ({
  kind: "http",
  target: "http://orders",
  targetSource: "literal",
  client: "RestTemplate",
  position: at(line),
  ...extra,
});

describe("packRouteGroups", () => {
  it("makes one group per file, recording a method-less route as GET and sorting by method then path", () => {
    const facts: PackFrameworkFacts = [
      { path: "src/main/java/OwnerController.java", routes: [route("/owners/{id}", "POST", "update"), route("/owners/", undefined, "list"), route("/owners/new", "GET", "form")] },
    ];
    expect(packRouteGroups(facts, inventory({ "src/main/java/OwnerController.java": "source" }))).toEqual([
      {
        file: "src/main/java/OwnerController.java",
        prefix: "/owners/",
        routes: [
          { file: "src/main/java/OwnerController.java", method: "GET", path: "/owners/", handler: "list" },
          { file: "src/main/java/OwnerController.java", method: "GET", path: "/owners/new", handler: "form" },
          { file: "src/main/java/OwnerController.java", method: "POST", path: "/owners/{id}", handler: "update" },
        ],
      },
    ]);
  });

  it("drops TRACE and repeated method and path, keeping the first handler", () => {
    const facts: PackFrameworkFacts = [{ path: "A.java", routes: [route("/a", "TRACE"), route("/a", "GET", "first"), route("/a", undefined, "second")] }];
    expect(packRouteGroups(facts, inventory({ "A.java": "source" }))[0].routes).toEqual([{ file: "A.java", method: "GET", path: "/a", handler: "first" }]);
  });

  it("drops files whose role is test, config or docs, files outside the inventory and files without routes", () => {
    const facts: PackFrameworkFacts = [
      { path: "T.java", routes: [route("/t", "GET")] },
      { path: "C.java", routes: [route("/c", "GET")] },
      { path: "D.java", routes: [route("/d", "GET")] },
      { path: "Gone.java", routes: [route("/g", "GET")] },
      { path: "Empty.java", routes: [] },
      { path: "None.java" },
      { path: "S.java", routes: [route("/s", "GET")] },
    ];
    const inv = inventory({ "T.java": "test", "C.java": "config", "D.java": "docs", "Empty.java": "source", "None.java": "source", "S.java": "source" });
    expect(packRouteGroups(facts, inv).map((g) => g.file)).toEqual(["S.java"]);
  });
});

describe("withPackRouteGroups", () => {
  const existing: ServerRouteGroup[] = [
    { file: "a/server.ts", prefix: "/", routes: [{ file: "a/server.ts", method: "GET", path: "/x" }] },
    { file: "z/main.go", prefix: "/", routes: [{ file: "z/main.go", method: "GET", path: "/y" }] },
  ];

  it("returns the detectors' groups themselves without pack routes", () => {
    expect(withPackRouteGroups(existing, inventory({}), undefined)).toBe(existing);
    expect(withPackRouteGroups(existing, inventory({ "m/A.java": "test" }), [{ path: "m/A.java", routes: [route("/a", "GET")] }])).toBe(existing);
  });

  it("adds pack groups in file order without reordering the detectors' groups", () => {
    const merged = withPackRouteGroups(existing, inventory({ "m/A.java": "source" }), [{ path: "m/A.java", routes: [route("/a", "GET")] }]);
    expect(merged.map((g) => g.file)).toEqual(["a/server.ts", "m/A.java", "z/main.go"]);
  });
});

describe("packOutboundDependencies", () => {
  it("maps each fact, defaulting confidence to inferred and deduplicating on line, kind, client and target", () => {
    const facts: PackFrameworkFacts = [
      {
        path: "Client.java",
        outboundCalls: [
          call(3, { confidence: "certain" }),
          call(3, { confidence: "likely" }),
          call(7, { kind: "queue", client: "KafkaTemplate", target: "orders", targetSource: "config" }),
        ],
      },
    ];
    expect(packOutboundDependencies(facts, inventory({ "Client.java": "source" }))).toEqual([
      { file: "Client.java", line: 3, kind: "http", target: "http://orders", targetSource: "literal", client: "RestTemplate", confidence: "certain" },
      { file: "Client.java", line: 7, kind: "queue", target: "orders", targetSource: "config", client: "KafkaTemplate", confidence: "inferred" },
    ]);
  });

  it("drops calls from test, docs and asset files and from files outside the inventory", () => {
    const facts: PackFrameworkFacts = ["T.java", "D.java", "A.java", "Gone.java", "S.java"].map((path) => ({ path, outboundCalls: [call(1)] }));
    const inv = inventory({ "T.java": "test", "D.java": "docs", "A.java": "asset", "S.java": "config" });
    expect(packOutboundDependencies(facts, inv).map((d) => d.file)).toEqual(["S.java"]);
  });
});

describe("withPackOutbound", () => {
  const data: OutboundData = {
    dependencies: [
      { file: "a.ts", line: 2, kind: "http", target: "", targetSource: "unknown", client: "fetch", confidence: "certain" },
      { file: "z.ts", line: 1, kind: "env", target: "PORT", targetSource: "env", client: "process.env", confidence: "certain" },
    ],
    contracts: [{ file: "api.proto", kind: "protobuf" }],
  } as OutboundData;

  it("returns the data itself without pack calls", () => {
    expect(withPackOutbound(data, inventory({}), undefined)).toBe(data);
    expect(withPackOutbound(data, inventory({ "T.java": "test" }), [{ path: "T.java", outboundCalls: [call(1)] }])).toBe(data);
  });

  it("adds pack calls in canonical order and keeps the contracts", () => {
    const merged = withPackOutbound(data, inventory({ "m/C.java": "source" }), [{ path: "m/C.java", outboundCalls: [call(4)] }]);
    expect(merged.dependencies.map((d) => d.file)).toEqual(["a.ts", "m/C.java", "z.ts"]);
    expect(merged.contracts).toEqual(data.contracts);
  });
});
