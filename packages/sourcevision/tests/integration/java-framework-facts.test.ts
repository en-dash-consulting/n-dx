/**
 * Spring Boot routes and outbound calls through the analyze pipeline: the
 * imports phase's single pack call collects them, the components phase adds
 * them to serverRoutes and the outbound step to outbound.json. Without the
 * Java pack, both artifacts are what the detectors alone produce.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { javaConfig, type FileFacts, type PackProjectRequest } from "@n-dx/lang-kit";
import { analyzeComponents } from "../../src/analyzers/components.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { detectOutbound } from "../../src/analyzers/outbound-detection.js";
import { withPackOutbound } from "../../src/analyzers/pack-framework-facts.js";
import { KNOWN_PACKS, loadPack, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/java-spring-project");
const MAIN = "src/main/java/com/example/clinic";
const JAVA = KNOWN_PACKS.find((p) => p.id === "java")!;

const CLIENT = `package com.example.clinic.client;

import org.springframework.web.client.RestTemplate;

public class BillingClient {
    private final RestTemplate rest = new RestTemplate();

    public String invoice(Long id) {
        return rest.getForObject("http://billing/invoices/" + id, String.class);
    }
}
`;

const TEST_CLIENT = `package com.example.clinic;

import org.springframework.web.client.RestTemplate;

public class BillingIT {
    private final RestTemplate rest = new RestTemplate();

    void call() {
        rest.getForObject("http://localhost/x", String.class);
    }
}
`;

/** The workspace Java pack, recording each request it is sent. */
function countingJava(requests: PackProjectRequest[]): KnownPack {
  return {
    ...JAVA,
    importByResolution: async () => {
      const load = await loadPack(JAVA, { packDir: join(tmpdir(), "sv-no-packs-here") });
      if (load.status !== "loaded") throw new Error(load.notice.reason);
      const entry = load.entry;
      return { pack: { ...entry, analyzeProject: (request: PackProjectRequest) => (requests.push(request), entry.analyzeProject(request)) } };
    },
  };
}

const NOT_INSTALLED_JAVA: KnownPack = {
  ...JAVA,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-java' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

describe("Java routes and outbound calls in serverRoutes and outbound.json", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-java-framework-"));
    cpSync(FIXTURE, dir, { recursive: true });
    for (const [path, text] of [
      [`${MAIN}/client/BillingClient.java`, CLIENT],
      ["src/test/java/com/example/clinic/BillingIT.java", TEST_CLIENT],
    ] as const) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    inventory = await analyzeInventory(dir, { languageConfig: javaConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** imports → components → outbound, as the analyze command chains them. */
  async function pipeline(java: KnownPack) {
    const facts: FileFacts[] = [];
    const messages: string[] = [];
    const imports = await analyzeImports(dir, inventory, {
      language: "java",
      packs: { packs: [java], warn: (m) => messages.push(m), framework: (f) => facts.push(...f) },
    });
    const components = await analyzeComponents(dir, inventory, imports, { packFacts: facts });
    const outbound = withPackOutbound(await detectOutbound(dir, inventory), inventory, facts);
    return { components, outbound, messages };
  }

  it("parses each Java file once and records controller routes and non-test outbound calls", async (ctx) => {
    await skipUnlessPackRuns(ctx, "java");
    const requests: PackProjectRequest[] = [];
    const { components, outbound } = await pipeline(countingJava(requests));

    expect(requests).toHaveLength(1);
    expect(requests[0].kinds).toEqual(["imports", "routes", "outboundCalls"]);

    expect(components.serverRoutes).toEqual([
      {
        file: `${MAIN}/controller/OwnerController.java`,
        // The detectors' prefix rule: "/owners" and "/owners/{id}" share only "/".
        prefix: "/",
        routes: [
          { file: `${MAIN}/controller/OwnerController.java`, method: "GET", path: "/owners", handler: "search" },
          { file: `${MAIN}/controller/OwnerController.java`, method: "GET", path: "/owners/{id}", handler: "show" },
        ],
      },
      {
        file: `${MAIN}/controller/VisitController.java`,
        prefix: "/pets/{petId}/",
        routes: [
          { file: `${MAIN}/controller/VisitController.java`, method: "GET", path: "/pets/{petId}/visits", handler: "history" },
          { file: `${MAIN}/controller/VisitController.java`, method: "POST", path: "/pets/{petId}/visits", handler: "book" },
        ],
      },
    ]);
    expect(components.summary.totalServerRoutes).toBe(4);

    expect(outbound.dependencies.map((d) => [d.file, d.kind, d.client, d.confidence])).toEqual([
      [`${MAIN}/client/BillingClient.java`, "http", "RestTemplate", "certain"],
    ]);
  });

  it("without the Java pack, records exactly what the detectors alone do", async () => {
    const { components, outbound, messages } = await pipeline(NOT_INSTALLED_JAVA);
    const imports = await analyzeImports(dir, inventory, { language: "java", packs: { packs: [NOT_INSTALLED_JAVA], warn: () => {} } });
    expect(components).toEqual(await analyzeComponents(dir, inventory, imports));
    expect(outbound).toEqual(await detectOutbound(dir, inventory));
    expect(messages).toHaveLength(1);
  });
});
