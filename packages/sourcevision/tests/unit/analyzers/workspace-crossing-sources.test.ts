/**
 * The http and infra edge sources in `workspace-crossings.ts`.
 *
 * The first block runs the real detectors over a two-member fixture, so the
 * artifacts these edges are derived from are the ones `sv analyze` actually
 * writes rather than hand-built shapes that can drift from them. The later
 * blocks use hand-built members to reach the confidence boundaries the fixture
 * does not exercise.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import {
  buildPackageMap,
  computeCrossRepoEdges,
  computeHttpCrossings,
  computeInfraCrossings,
  countCrossingsBySource,
  findServedRoute,
  hostOf,
  identityTokens,
  pathOf,
} from "../../../src/analyzers/workspace-crossings.js";
import { promoteZones } from "../../../src/analyzers/workspace.js";
import type { SubAnalysis } from "../../../src/analyzers/workspace.js";
import { analyzeInventory } from "../../../src/analyzers/inventory.js";
import { analyzeImports } from "../../../src/analyzers/imports.js";
import { detectOutbound } from "../../../src/analyzers/outbound-detection.js";
import { detectServerRoutes } from "../../../src/analyzers/server-route-detection.js";
import {
  computeInfrastructure,
  toInfrastructureData,
} from "../../../src/analyzers/infrastructure.js";
import type { Components, InfrastructureData, Manifest, Zone } from "../../../src/schema/index.js";

const FIXTURE_ROOT = join(import.meta.dirname, "../../fixtures/workspace-crossings");

function makeManifest(): Manifest {
  return {
    schemaVersion: "1.0.0",
    toolVersion: "0.1.0",
    analyzedAt: "2024-01-01T00:00:00Z",
    targetPath: "/test",
    modules: {},
  };
}

/**
 * Build a member by running the real analyzers over one fixture directory.
 *
 * Zones are assembled rather than detected: Louvain over three files is not
 * what these edges are about, and a single zone per member keeps the assertions
 * about which *member* an edge joins, which is the question.
 */
async function loadFixtureMember(name: string, baseUrl?: string): Promise<SubAnalysis> {
  const dir = join(FIXTURE_ROOT, name);
  const inventory = await analyzeInventory(dir);
  const imports = await analyzeImports(dir, inventory);
  const outbound = await detectOutbound(dir, inventory);
  const serverRoutes = await detectServerRoutes(dir, inventory);
  const infrastructure = toInfrastructureData(
    computeInfrastructure(dir, inventory.files.map((f) => f.path)),
  );

  const files = inventory.files.map((f) => f.path);
  const zone: Zone = {
    id: "core",
    name: "Core",
    description: `${files.length} files`,
    files,
    entryPoints: ["src/index.ts"],
    cohesion: 0.8,
    coupling: 0.2,
  };

  return {
    id: name,
    prefix: name,
    svDir: join(dir, ".sourcevision"),
    manifest: makeManifest(),
    zones: { zones: [zone], crossings: [], unzoned: [] },
    inventory,
    imports,
    outbound,
    infrastructure,
    components: { serverRoutes } as Components,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

// ── Fixture: two members joined by all three signals ────────────────────────

describe("workspace crossings over the two-member fixture", () => {
  let members: SubAnalysis[];
  let promoted: Zone[];

  beforeAll(async () => {
    members = [
      await loadFixtureMember("checkout-web"),
      await loadFixtureMember("orders-api", "https://orders.internal:8443"),
    ];
    promoted = members.flatMap(promoteZones);
  });

  it("derives an edge from each of the three sources", () => {
    const { crossings } = computeCrossRepoEdges(members, promoted, buildPackageMap(members, (m) =>
      m.id === "orders-api" ? { name: "@acme/orders-api", entryFile: "src/index.ts" } : null,
    ));

    const counts = countCrossingsBySource(crossings);
    expect(counts.npm).toBeGreaterThan(0);
    expect(counts.http).toBeGreaterThan(0);
    expect(counts.infra).toBeGreaterThan(0);
    expect(counts.none).toBe(0);

    for (const crossing of crossings) {
      expect(crossing.evidence, `${crossing.source} crossing carries evidence`).toBeTruthy();
    }
  });

  it("tags the npm crossing and names both packages in its evidence", () => {
    const { crossings } = computeCrossRepoEdges(members, promoted, buildPackageMap(members, (m) =>
      m.id === "orders-api" ? { name: "@acme/orders-api", entryFile: "src/index.ts" } : null,
    ));

    const npm = crossings.filter((c) => c.source === "npm");
    expect(npm).toHaveLength(1);
    expect(npm[0].from).toBe("checkout-web/src/client.ts");
    expect(npm[0].to).toBe("orders-api/src/index.ts");
    expect(npm[0].evidence).toContain("@acme/orders-api");
    expect(npm[0].evidence).toContain("orders-api");
  });

  it("resolves a literal http target to the member that serves the route", () => {
    const { crossings } = computeHttpCrossings(members, promoted);

    const literal = crossings.find((c) => c.evidence?.includes("declared base URL"));
    expect(literal).toBeDefined();
    expect(literal!.source).toBe("http");
    expect(literal!.from).toBe("checkout-web/src/client.ts");
    // The route file, not the package entry point — the call reaches a handler.
    expect(literal!.to).toBe("orders-api/src/routes.ts");
    expect(literal!.evidence).toContain("orders.internal");
    expect(literal!.evidence).toContain("/api/orders");
    expect(literal!.evidence).toContain("checkout-web");
    expect(literal!.evidence).toContain("orders-api");
  });

  it("resolves an env-sourced http target against the declared base URL", () => {
    const { crossings, withheld } = computeHttpCrossings(members, promoted);

    const env = crossings.find((c) => c.evidence?.includes("ORDERS_URL"));
    expect(env).toBeDefined();
    expect(env!.source).toBe("http");
    expect(env!.evidence).toContain("https://orders.internal:8443");
    expect(withheld).toHaveLength(0);
  });

  it("joins the two members on the shared Terraform queue", () => {
    const { crossings } = computeInfraCrossings(members, promoted);

    expect(crossings).toHaveLength(1);
    const [infra] = crossings;
    expect(infra.source).toBe("infra");
    // Oriented by member id so repeated runs produce the same graph.
    expect(infra.from).toBe("checkout-web/src/worker.ts");
    expect(infra.to).toBe("orders-api/src/queue.ts");
    expect(infra.evidence).toContain("infra:aws_sqs_queue.order_events");
    expect(infra.evidence).toContain("checkout-web");
    expect(infra.evidence).toContain("orders-api");
    expect(infra.evidence).toContain("infrastructure.json");
  });

  it("withholds the env match when the producer declares no base URL", async () => {
    const undeclared = [members[0], await loadFixtureMember("orders-api")];
    const zones = undeclared.flatMap(promoteZones);

    const { crossings, withheld } = computeHttpCrossings(undeclared, zones);

    // The literal call still resolves — the host names the member and the
    // member serves the route. Only the env call loses its anchor.
    expect(crossings.some((c) => c.evidence?.includes("ORDERS_URL"))).toBe(false);

    const reason = withheld.find((w) => w.reason.includes("ORDERS_URL"));
    expect(reason).toBeDefined();
    expect(reason!.source).toBe("http");
    expect(reason!.confidence).toBe("inferred");
    expect(reason!.toMember).toBe("orders-api");
    expect(reason!.reason).toContain("declares no baseUrl");
  });
});

// ── Name normalization ──────────────────────────────────────────────────────

describe("identityTokens", () => {
  it("drops the words that say what a thing is, not which thing", () => {
    expect(identityTokens("ORDERS_API_URL")).toEqual(["orders"]);
    expect(identityTokens("orders-api")).toEqual(["orders"]);
    expect(identityTokens("billing_service_endpoint")).toEqual(["billing"]);
  });

  it("keeps multi-word identities distinct", () => {
    expect(identityTokens("ORDER_HISTORY_URL")).toEqual(["order", "history"]);
    expect(identityTokens("ORDERS_URL")).toEqual(["orders"]);
  });

  it("is empty for a name made only of noise", () => {
    expect(identityTokens("BASE_URL")).toEqual([]);
    expect(identityTokens("API_HOST")).toEqual([]);
  });
});

// ── URL parsing ─────────────────────────────────────────────────────────────

describe("hostOf", () => {
  it("reads the host from a full URL", () => {
    expect(hostOf("https://orders.internal:8443/api/orders?x=1")).toBe("orders.internal");
  });

  it("reads a scheme-less dial address", () => {
    expect(hostOf("orders-api:50051")).toBe("orders-api");
  });

  it("drops credentials", () => {
    expect(hostOf("https://user:pw@orders.internal/api")).toBe("orders.internal");
  });

  it("is null for a bare path or an empty target", () => {
    expect(hostOf("/api/orders")).toBeNull();
    expect(hostOf("")).toBeNull();
  });
});

describe("pathOf", () => {
  it("reads the path without query or fragment", () => {
    expect(pathOf("https://orders.internal/api/orders?page=2#top")).toBe("/api/orders");
  });

  it("treats a bare host and a root path alike", () => {
    expect(pathOf("https://orders.internal")).toBe("");
    expect(pathOf("https://orders.internal/")).toBe("");
  });
});

// ── Route matching ──────────────────────────────────────────────────────────

describe("findServedRoute", () => {
  function memberServing(paths: string[]): SubAnalysis {
    return {
      id: "api",
      prefix: "api",
      svDir: "/api/.sourcevision",
      manifest: makeManifest(),
      components: {
        serverRoutes: [
          {
            file: "src/routes.ts",
            prefix: "/api/",
            routes: paths.map((path) => ({ file: "src/routes.ts", method: "GET" as const, path })),
          },
        ],
      } as Components,
    };
  }

  it("matches a parameterised route", () => {
    expect(findServedRoute(memberServing(["/api/orders/:id"]), "/api/orders/42")?.path).toBe(
      "/api/orders/:id",
    );
  });

  it("prefers the longest matching route", () => {
    const member = memberServing(["/api", "/api/orders/:id"]);
    expect(findServedRoute(member, "/api/orders/42")?.path).toBe("/api/orders/:id");
  });

  it("matches a route that is a prefix of the request path", () => {
    expect(findServedRoute(memberServing(["/api/orders"]), "/api/orders/42/items")).not.toBeNull();
  });

  it("does not match a different route", () => {
    expect(findServedRoute(memberServing(["/api/orders"]), "/api/invoices")).toBeNull();
  });

  it("is null when the request names no path", () => {
    expect(findServedRoute(memberServing(["/api/orders"]), "")).toBeNull();
  });
});

// ── Confidence boundaries ───────────────────────────────────────────────────

describe("http crossing confidence", () => {
  function caller(target: string, targetSource: "literal" | "env"): SubAnalysis {
    return {
      id: "web",
      prefix: "web",
      svDir: "/web/.sourcevision",
      manifest: makeManifest(),
      zones: {
        zones: [
          {
            id: "ui",
            name: "UI",
            description: "",
            files: ["src/client.ts"],
            entryPoints: ["src/client.ts"],
            cohesion: 0.8,
            coupling: 0.2,
          },
        ],
        crossings: [],
        unzoned: [],
      },
      outbound: {
        dependencies: [
          {
            file: "src/client.ts",
            line: 1,
            kind: "http",
            target,
            targetSource,
            client: "fetch",
            confidence: "certain",
          },
        ],
        contracts: [],
      },
    };
  }

  function producer(options: { baseUrl?: string; routes?: string[] } = {}): SubAnalysis {
    return {
      id: "orders-api",
      prefix: "orders-api",
      svDir: "/orders-api/.sourcevision",
      manifest: makeManifest(),
      zones: {
        zones: [
          {
            id: "routes",
            name: "Routes",
            description: "",
            files: ["src/routes.ts"],
            entryPoints: ["src/routes.ts"],
            cohesion: 0.8,
            coupling: 0.2,
          },
        ],
        crossings: [],
        unzoned: [],
      },
      ...(options.routes
        ? {
            components: {
              serverRoutes: [
                {
                  file: "src/routes.ts",
                  prefix: "/api/",
                  routes: options.routes.map((path) => ({
                    file: "src/routes.ts",
                    method: "GET" as const,
                    path,
                  })),
                },
              ],
            } as Components,
          }
        : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    };
  }

  function run(from: SubAnalysis, to: SubAnalysis) {
    const members = [from, to];
    return computeHttpCrossings(members, members.flatMap(promoteZones));
  }

  it("draws an edge when the host is declared but no route matches", () => {
    const { crossings } = run(
      caller("https://orders.internal/api/orders", "literal"),
      producer({ baseUrl: "https://orders.internal", routes: ["/api/invoices"] }),
    );
    expect(crossings).toHaveLength(1);
    expect(crossings[0].evidence).toContain("serves no route matching");
  });

  it("draws an edge when the host only names the member but it serves the route", () => {
    const { crossings } = run(
      caller("https://orders-api.svc/api/orders", "literal"),
      producer({ routes: ["/api/orders"] }),
    );
    expect(crossings).toHaveLength(1);
    expect(crossings[0].evidence).toContain("which serves /api/orders");
  });

  it("withholds a host that only resembles the member's name", () => {
    const { crossings, withheld } = run(
      caller("https://orders-api.svc/api/orders", "literal"),
      producer(),
    );
    expect(crossings).toHaveLength(0);
    expect(withheld).toHaveLength(1);
    expect(withheld[0].confidence).toBe("inferred");
    expect(withheld[0].reason).toContain("nothing else corroborates");
  });

  it("withholds an env name that matches more than one member", () => {
    const first = producer({ baseUrl: "https://orders.internal" });
    const second: SubAnalysis = {
      ...producer({ baseUrl: "https://orders.svc" }),
      id: "orders-service",
      prefix: "orders-service",
    };

    const members = [caller("ORDERS_URL", "env"), first, second];
    const { crossings, withheld } = computeHttpCrossings(
      members,
      members.flatMap(promoteZones),
    );

    expect(crossings).toHaveLength(0);
    expect(withheld).toHaveLength(1);
    expect(withheld[0].toMember).toBe("");
    expect(withheld[0].reason).toContain("more than one member");
    expect(withheld[0].reason).toContain("declare distinct baseUrl");
  });

  it("ignores non-network outbound kinds", () => {
    const from = caller("https://orders.internal/api/orders", "literal");
    from.outbound!.dependencies[0] = {
      ...from.outbound!.dependencies[0],
      kind: "database",
    };

    const { crossings } = run(from, producer({ baseUrl: "https://orders.internal" }));
    expect(crossings).toHaveLength(0);
  });

  it("never resolves a call to the member that made it", () => {
    const self = caller("https://web.internal/api/orders", "literal");
    self.baseUrl = "https://web.internal";

    const { crossings, withheld } = computeHttpCrossings([self], promoteZones(self));
    expect(crossings).toHaveLength(0);
    expect(withheld).toHaveLength(0);
  });
});

// ── Infra boundaries ────────────────────────────────────────────────────────

describe("infra crossing rules", () => {
  function memberWith(
    id: string,
    infrastructure: InfrastructureData,
    file = "src/app.ts",
  ): SubAnalysis {
    return {
      id,
      prefix: id,
      svDir: `/${id}/.sourcevision`,
      manifest: makeManifest(),
      zones: {
        zones: [
          {
            id: "core",
            name: "Core",
            description: "",
            files: [file],
            entryPoints: [file],
            cohesion: 0.8,
            coupling: 0.2,
          },
        ],
        crossings: [],
        unzoned: [],
      },
      infrastructure,
    };
  }

  function queue(id: string, name: string, target: string): InfrastructureData {
    return {
      resources: [{ id, name, kind: "queue", origin: "infra/main.tf", literals: [name] }],
      seams: [],
      links: [{ resourceId: id, target, evidence: "name-literal" }],
      sawIaC: true,
    };
  }

  it("joins two members naming the same queue under different resource ids", () => {
    const a = memberWith("alpha", queue("infra:aws_sqs_queue.orders", "acme-orders", "src/app.ts"));
    const b = memberWith("bravo", queue("infra:sqs.orders_q", "acme-orders", "src/app.ts"));

    const { crossings } = computeInfraCrossings([a, b], [a, b].flatMap(promoteZones));
    expect(crossings).toHaveLength(1);
    expect(crossings[0].evidence).toContain("same name");
  });

  it("does not join two members over a same-named database", () => {
    const withDb = (id: string): InfrastructureData => ({
      resources: [
        { id: `infra:${id}.primary`, name: "primary", kind: "database", origin: "infra/main.tf" },
      ],
      seams: [],
      links: [{ resourceId: `infra:${id}.primary`, target: "src/app.ts", evidence: "name-literal" }],
      sawIaC: true,
    });

    const a = memberWith("alpha", withDb("alpha"));
    const b = memberWith("bravo", withDb("bravo"));

    const { crossings } = computeInfraCrossings([a, b], [a, b].flatMap(promoteZones));
    expect(crossings).toHaveLength(0);
  });

  it("withholds a shared resource one member links to no code", () => {
    const shared = "infra:aws_sqs_queue.orders";
    const a = memberWith("alpha", queue(shared, "acme-orders", "src/app.ts"));
    const b = memberWith("bravo", {
      ...queue(shared, "acme-orders", "src/app.ts"),
      links: [],
    });

    const { crossings, withheld } = computeInfraCrossings([a, b], [a, b].flatMap(promoteZones));
    expect(crossings).toHaveLength(0);
    expect(withheld).toHaveLength(1);
    expect(withheld[0].source).toBe("infra");
    expect(withheld[0].reason).toContain("links it to no code");
  });

  it("resolves a link that names a zone rather than a file", () => {
    const shared = "infra:aws_sqs_queue.orders";
    const a = memberWith("alpha", queue(shared, "acme-orders", "core"));
    const b = memberWith("bravo", queue(shared, "acme-orders", "src/app.ts"));

    const { crossings } = computeInfraCrossings([a, b], [a, b].flatMap(promoteZones));
    expect(crossings).toHaveLength(1);
    expect(crossings[0].fromZone).toBe("alpha:core");
  });
});

// ── Counting ────────────────────────────────────────────────────────────────

describe("countCrossingsBySource", () => {
  it("counts an untagged crossing as intra-repo", () => {
    const counts = countCrossingsBySource([
      { from: "a", to: "b", fromZone: "x", toZone: "y" },
      { from: "a", to: "b", fromZone: "x", toZone: "y", source: "npm" },
      { from: "a", to: "b", fromZone: "x", toZone: "y", source: "http" },
      { from: "a", to: "b", fromZone: "x", toZone: "y", source: "infra" },
      { from: "a", to: "b", fromZone: "x", toZone: "y", source: "infra" },
    ]);

    expect(counts).toEqual({ none: 1, npm: 1, http: 1, infra: 2 });
  });
});
