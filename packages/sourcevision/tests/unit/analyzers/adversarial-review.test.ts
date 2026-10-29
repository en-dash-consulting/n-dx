import { describe, it, expect } from "vitest";
import { detectJsOutboundCalls as js } from "../../../src/analyzers/outbound-detection.js";
import { detectGoOutboundCalls as go } from "../../../src/analyzers/go-outbound-detection.js";
import { computeHttpCrossings, computeInfraCrossings } from "../../../src/analyzers/workspace-crossings.js";
import { promoteZones, type SubAnalysis } from "../../../src/analyzers/workspace.js";

function member(id: string, baseUrl?: string): SubAnalysis {
  return {
    id, prefix: id, svDir: `/${id}/analysis`, baseUrl,
    manifest: { schemaVersion: "1.0.0", toolVersion: "0.1.0", analyzedAt: "2026-10-27", targetPath: id, modules: {} },
    zones: {
      zones: [{ id: "core", name: "Core", description: "", files: ["src/app.ts"], entryPoints: ["src/app.ts"], cohesion: 1, coupling: 0 }],
      crossings: [], unzoned: [],
    },
  };
}
function caller(target: string): SubAnalysis {
  return {
    ...member("caller"),
    outbound: { dependencies: [{ file: "src/app.ts", line: 1, kind: "http", client: "fetch", target, targetSource: "literal", confidence: "certain" }], contracts: [] },
  };
}
function http(members: SubAnalysis[]) {
  return computeHttpCrossings(members, members.flatMap(promoteZones));
}

describe("adversarial outbound review", () => {
  it("does not identify unrelated imports or parameters as global fetch", () => {
    expect(js('import { fetch } from "./cache"; fetch("orders");', "app.ts")).toEqual([]);
    expect(js('function local(fetch: any) { fetch("key"); }', "app.ts")).toEqual([]);
    expect(js('function local(window: any) { window.fetch("key"); }', "app.ts")).toEqual([]);
    expect(js('import type { fetch } from "./cache"; fetch("https://orders.internal");', "app.ts")).toHaveLength(1);
  });
  it("respects shadowing while keeping outer client calls", () => {
    const source = 'import axios from "axios";\nfunction local(axios: any) { axios.get("local"); }\naxios.get("https://orders.internal");';
    expect(js(source, "app.ts").map((d) => d.target)).toEqual(["https://orders.internal"]);
    expect(js('import axios from "axios"; function local(axios: any) { const api = axios.create({baseURL: "local"}); api.get("/value"); }', "app.ts")).toEqual([]);
  });
  it("resolves constants in their declaring scope", () => {
    const source = 'const url = "https://outer.internal"; function local(url: string) { fetch(url); } fetch(url);';
    expect(js(source, "app.ts").map((d) => d.target)).toEqual(["", "https://outer.internal"]);
  });
  it("preserves configured HTTP route paths", () => {
    const source = 'import axios from "axios";\nconst api = axios.create({baseURL: "https://orders.internal/api"});\napi.get("/orders");';
    expect(js(source, "app.ts").find((d) => d.line === 3)?.target).toBe("https://orders.internal/api/orders");
  });
  it("uses Go connection targets instead of SQL or cache payloads", () => {
    const database = 'package main\nimport "database/sql"\nfunc main() {\n db, _ := sql.Open("postgres", "postgres://db.internal/app")\n db.Query("SELECT * FROM orders")\n}';
    expect(go(database, "main.go").find((d) => d.line === 5)?.target).toBe("postgres://db.internal/app");
    const cache = 'package main\nimport "github.com/redis/go-redis/v9"\nfunc main() {\n client := redis.NewClient(&redis.Options{Addr: "cache.internal:6379"})\n client.Get(ctx, "orders")\n}';
    expect(go(cache, "main.go").find((d) => d.line === 5)?.target).toBe("cache.internal:6379");
  });
  it("ignores Go calls inside documentation strings", () => {
    expect(go('package main\nimport "net/http"\nconst example = `http.Get("https://example.internal")`\n', "main.go")).toEqual([]);
  });
});

describe("adversarial workspace review", () => {
  it("matches ports and base paths independently of member order", () => {
    const from = caller("https://gateway.internal:8081/billing/charge");
    const orders = member("orders", "https://gateway.internal:8080/orders");
    const billing = member("billing", "https://gateway.internal:8081/billing");
    for (const members of [[from, orders, billing], [from, billing, orders]]) {
      expect(http(members).crossings.map((c) => c.toZone)).toEqual(["billing:core"]);
    }
    orders.baseUrl = "https://gateway.internal:8081/orders";
    expect(http([from, orders, billing]).crossings.map((c) => c.toZone)).toEqual(["billing:core"]);
  });
  it("withholds equally plausible endpoint matches", () => {
    const members = [caller("https://gateway.internal/api"), member("orders", "https://gateway.internal"), member("billing", "https://gateway.internal")];
    expect(http(members).crossings).toEqual([]);
    expect(http(members).withheld).toHaveLength(1);
  });
  it("does not equate Terraform declaration labels with deployed resources", () => {
    const members = [member("payments"), member("email")];
    for (const m of members) {
      m.infrastructure = {
        resources: [{ id: "infra:aws_sqs_queue.main", name: "main", kind: "queue", origin: "main.tf", literals: ["main", `${m.id}-work`] }],
        seams: [], links: [{ resourceId: "infra:aws_sqs_queue.main", target: "src/app.ts", evidence: "name-literal" }], sawIaC: true,
      };
    }
    expect(computeInfraCrossings(members, members.flatMap(promoteZones)).crossings).toEqual([]);
  });
  it("prefers the member with the longest matching base path over an equally confident one", () => {
    const members = [caller("https://gw.internal/billing/charge"), member("gw", "https://gw.internal"), member("billing", "https://gw.internal/billing")];
    expect(http(members).crossings.map((c) => c.toZone)).toEqual(["billing:core"]);
    expect(http(members).withheld).toEqual([]);
  });
  it("withholds a name match that the member's declared base URL contradicts", () => {
    const members = [caller("https://orders.prod.internal/api/orders"), member("orders", "https://orders.staging.internal")];
    const result = http(members);
    expect(result.crossings).toEqual([]);
    expect(result.withheld).toHaveLength(1);
    expect(result.withheld[0]).toMatchObject({ toMember: "orders", confidence: "inferred" });
  });
  it("joins a Terraform resource whose deployed name repeats its label", () => {
    const members = [member("payments"), member("email")];
    for (const m of members) {
      m.infrastructure = {
        resources: [{ id: "infra:aws_sqs_queue.orders", name: "orders", kind: "queue", origin: "main.tf", literals: ["orders"], deployedNames: ["orders"] }],
        seams: [], links: [{ resourceId: "infra:aws_sqs_queue.orders", target: "src/app.ts", evidence: "name-literal" }], sawIaC: true,
      };
    }
    expect(computeInfraCrossings(members, members.flatMap(promoteZones)).crossings).toHaveLength(1);
  });
  it.each(["orders-events", "infra:external.orders-events"])("still joins config-declared resources by id: %s", (id) => {
    const members = [member("payments"), member("email")];
    for (const m of members) {
      m.infrastructure = {
        resources: [{ id, name: "orders-events", kind: "topic", origin: "config" }],
        seams: [], links: [{ resourceId: id, target: "src/app.ts", evidence: "config" }], sawIaC: false,
      };
    }
    expect(computeInfraCrossings(members, members.flatMap(promoteZones)).crossings.map((c) => c.evidence)).toEqual([expect.stringContaining("same resource id")]);
  });
});
