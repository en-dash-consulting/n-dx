/**
 * Outbound detection — the shape, the contracts and the ordering.
 *
 * This is the first of four slices, so there is deliberately nothing here
 * asserting a detected call site: `dependencies` is empty by design until the
 * JS/TS and Go slices land. What is pinned now is everything those slices will
 * build on — the contract discovery, the canonical ordering, and the fact that
 * nothing on this path reads a network or an LLM.
 *
 * @see src/analyzers/outbound-detection.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "@n-dx/llm-client";

import {
  contractKindFor,
  detectOutbound,
  findDeclaredContracts,
} from "../../../src/analyzers/outbound-detection.js";
import { sortOutbound } from "../../../src/util/sort.js";
import { OutboundSchema, validate } from "../../../src/schema/validate.js";
import type { Inventory } from "../../../src/schema/index.js";

/**
 * A project declaring contracts three ways, with decoys.
 *
 * `vendor/` and `node_modules/` hold real contract files that must not be
 * reported: a dependency's `.proto` describes the dependency's interface, not
 * this repository's.
 */
const FILES: Record<string, string> = {
  "src/index.ts": `export const name = "svc";\n`,
  "api/openapi.yaml": `openapi: 3.0.0\n`,
  "api/swagger.json": `{"swagger":"2.0"}\n`,
  "docs/openapi.v2.yml": `openapi: 3.1.0\n`,
  "proto/orders.proto": `syntax = "proto3";\n`,
  "proto/nested/billing.proto": `syntax = "proto3";\n`,
  // Decoys — right directory, wrong thing.
  "api/schema.yaml": `kind: Deployment\n`,
  "api/openapi-notes.md": `not a contract\n`,
  "vendor/upstream/openapi.yaml": `openapi: 3.0.0\n`,
  "node_modules/dep/service.proto": `syntax = "proto3";\n`,
};

let root: string;

/** An inventory that, like a default `codeOnly` run, carries no contract files. */
const codeOnlyInventory: Inventory = {
  files: [
    {
      path: "src/index.ts",
      size: 30,
      language: "TypeScript",
      lineCount: 1,
      hash: "h",
      role: "source",
      category: "core",
    },
  ],
  summary: {
    totalFiles: 1,
    totalLines: 1,
    byLanguage: { TypeScript: 1 },
    byRole: { source: 1 },
    byCategory: { core: 1 },
  },
};

beforeAll(() => {
  root = join(tmpdir(), `sv-outbound-${process.pid}-${Date.now()}`);
  for (const [rel, body] of Object.entries(FILES)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("contractKindFor", () => {
  it("recognizes OpenAPI and Swagger documents by filename convention", () => {
    expect(contractKindFor("api/openapi.yaml")).toBe("openapi");
    expect(contractKindFor("api/openapi.yml")).toBe("openapi");
    expect(contractKindFor("api/swagger.json")).toBe("openapi");
    expect(contractKindFor("docs/openapi.v2.yml")).toBe("openapi");
    expect(contractKindFor("OpenAPI.JSON")).toBe("openapi");
  });

  it("recognizes protobuf definitions by extension", () => {
    expect(contractKindFor("proto/orders.proto")).toBe("proto");
  });

  it("rejects files that merely sit beside a contract", () => {
    expect(contractKindFor("api/schema.yaml")).toBeNull();
    expect(contractKindFor("api/openapi-notes.md")).toBeNull();
    expect(contractKindFor("src/index.ts")).toBeNull();
    // A directory named for the convention is not a document.
    expect(contractKindFor("openapi/readme.md")).toBeNull();
  });
});

describe("findDeclaredContracts", () => {
  it("finds contracts the code-only inventory does not carry", () => {
    // The guarantee that matters: .proto and .yaml are not programming
    // languages, so a default inventory omits them entirely. Were discovery
    // driven by the inventory alone, every one of these would be missed.
    const contracts = findDeclaredContracts(root, ["src/index.ts"]);
    expect(contracts.map((c) => c.file).sort()).toEqual([
      "api/openapi.yaml",
      "api/swagger.json",
      "docs/openapi.v2.yml",
      "proto/nested/billing.proto",
      "proto/orders.proto",
    ]);
  });

  it("skips dependency and vendor trees", () => {
    const files = findDeclaredContracts(root, []).map((c) => c.file);
    expect(files).not.toContain("vendor/upstream/openapi.yaml");
    expect(files).not.toContain("node_modules/dep/service.proto");
  });

  it("does not double-report a contract the inventory already carries", () => {
    const files = findDeclaredContracts(root, ["proto/orders.proto"]).map((c) => c.file);
    expect(files.filter((f) => f === "proto/orders.proto")).toHaveLength(1);
  });
});

describe("detectOutbound", () => {
  it("records declared contracts with their paths and kinds", async () => {
    const data = await detectOutbound(root, codeOnlyInventory);

    expect(data.contracts).toEqual([
      { file: "api/openapi.yaml", kind: "openapi" },
      { file: "api/swagger.json", kind: "openapi" },
      { file: "docs/openapi.v2.yml", kind: "openapi" },
      { file: "proto/nested/billing.proto", kind: "proto" },
      { file: "proto/orders.proto", kind: "proto" },
    ]);
  });

  it("reports no call sites yet — the detection slices are separate tasks", async () => {
    const data = await detectOutbound(root, codeOnlyInventory);
    expect(data.dependencies).toEqual([]);
  });

  it("produces output the outbound schema accepts", async () => {
    const data = await detectOutbound(root, codeOnlyInventory);
    expect(validate(OutboundSchema, data).ok).toBe(true);
  });

  it("is byte-identical across runs over an unchanged tree", async () => {
    const first = toCanonicalJSON(await detectOutbound(root, codeOnlyInventory));
    const second = toCanonicalJSON(await detectOutbound(root, codeOnlyInventory));
    expect(second).toBe(first);
  });
});

describe("sortOutbound", () => {
  it("orders call sites by file then line, not by insertion", () => {
    const sorted = sortOutbound({
      contracts: [],
      dependencies: [
        { file: "src/b.ts", line: 2, kind: "http", target: "", targetSource: "unknown", client: "fetch", confidence: "inferred" },
        { file: "src/a.ts", line: 9, kind: "queue", target: "QUEUE_URL", targetSource: "env", client: "sqs", confidence: "certain" },
        { file: "src/a.ts", line: 3, kind: "http", target: "https://x/", targetSource: "literal", client: "axios", confidence: "certain" },
      ],
    });

    expect(sorted.dependencies.map((d) => `${d.file}:${d.line}`)).toEqual([
      "src/a.ts:3",
      "src/a.ts:9",
      "src/b.ts:2",
    ]);
  });

  it("breaks a same-line tie totally, so the order is never input-dependent", () => {
    const pair = [
      { file: "a.ts", line: 1, kind: "cache", target: "r", targetSource: "literal", client: "redis", confidence: "certain" },
      { file: "a.ts", line: 1, kind: "cache", target: "p", targetSource: "literal", client: "redis", confidence: "certain" },
    ] as const;

    const forward = sortOutbound({ contracts: [], dependencies: [...pair] });
    const reversed = sortOutbound({ contracts: [], dependencies: [...pair].reverse() });
    expect(toCanonicalJSON(reversed)).toBe(toCanonicalJSON(forward));
  });
});
