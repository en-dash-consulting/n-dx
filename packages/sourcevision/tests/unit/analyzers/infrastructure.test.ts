/**
 * Infrastructure discovery, persisted.
 *
 * Discovery used to run inside the iso export, so what it found existed only
 * in a rendered HTML page. It runs at analyze time now and lands in
 * `infrastructure.json`. The move must not change what the map draws, and the
 * guarantee that makes that true is here: `fromInfrastructureData` exactly
 * inverts `toInfrastructureData`, so an architecture read back from the file
 * deep-equals the one discovery produced. Identical input to the renderer is
 * identical output from it — a stronger claim than comparing one rendered
 * pair, and it does not go stale when the renderer changes.
 *
 * (The move itself was also checked the blunt way: the same fixture rendered
 * to the same sha256 before and after.)
 *
 * @see src/analyzers/infrastructure.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "@n-dx/llm-client";

import {
  computeInfrastructure,
  fromInfrastructureData,
  readInfrastructure,
  toInfrastructureData,
} from "../../../src/analyzers/infrastructure.js";
import { loadDeclaredArchitecture } from "../../../src/export/iso-declared.js";
import { DATA_FILES } from "../../../src/schema/data-files.js";

/**
 * A project with infrastructure from all three sources: declared in config,
 * Terraform, and CloudFormation — and source files naming them, so linking
 * has something to find.
 */
const FILES: Record<string, string> = {
  "src/api/a.ts": `const q = "orders-intake-queue";\nexport { q };\n`,
  "src/api/b.ts": `export const b = "assets-primary-bucket";\n`,
  "src/core/c.ts": `export const c = "sessions-cache-cluster";\n`,
  "src/core/f.ts": `export const f = "customer-records-table";\n`,
  "infra/main.tf": `
resource "aws_sqs_queue" "orders" {
  name = "orders-intake-queue"
}
resource "aws_s3_bucket" "assets" {
  bucket = "assets-primary-bucket"
}
resource "aws_elasticache_cluster" "sessions" {
  name = "sessions-cache-cluster"
}
`,
  "infra/stack.yaml": `
Resources:
  CustomerRecords:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: customer-records-table
  NotifyTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: change-notifications-topic
`,
  ".n-dx.json": JSON.stringify({
    sourcevision: {
      isoMap: {
        injectionSeams: [
          { from: "src/api", to: "src/core", callbacks: ["onReady"], note: "declared seam" },
        ],
        infrastructure: [
          { id: "infra:external.payments", name: "Payments API", kind: "service", usedBy: ["src/api"] },
        ],
      },
    },
  }),
};

const SOURCE_FILES = Object.keys(FILES).filter((p) => p.startsWith("src/"));

let root: string;

beforeAll(() => {
  root = join(tmpdir(), "sv-infrastructure-test");
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(FILES)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("discovery", () => {
  it("finds resources from config, Terraform and CloudFormation", () => {
    const arch = computeInfrastructure(root, SOURCE_FILES);
    const byId = Object.fromEntries(arch.infrastructure.map((i) => [i.id, i]));

    expect(byId["infra:external.payments"].origin).toBe("config");
    expect(byId["infra:aws_sqs_queue.orders"].kind).toBe("queue");
    expect(byId["infra:aws_s3_bucket.assets"].kind).toBe("bucket");
    expect(byId["infra:aws_elasticache_cluster.sessions"].kind).toBe("cache");
    expect(byId["infra:AWS::DynamoDB::Table.CustomerRecords"].kind).toBe("database");
    expect(byId["infra:AWS::SNS::Topic.NotifyTopic"].kind).toBe("topic");
    expect(arch.sawIaC).toBe(true);
  });

  it("links a resource to the files that name it", () => {
    const arch = computeInfrastructure(root, SOURCE_FILES);
    const queue = arch.infrastructure.find((i) => i.id === "infra:aws_sqs_queue.orders");
    expect(queue?.usedBy).toContain("src/api/a.ts");
  });

  it("keeps a resource nothing names, with no uses", () => {
    // change-notifications-topic appears in no source file. It is still real
    // infrastructure; dropping it would hide a resource from the map.
    const arch = computeInfrastructure(root, SOURCE_FILES);
    const topic = arch.infrastructure.find((i) => i.id === "infra:AWS::SNS::Topic.NotifyTopic");
    expect(topic).toBeDefined();
    expect(topic?.usedBy).toEqual([]);
  });

  it("carries the declared seam through", () => {
    const arch = computeInfrastructure(root, SOURCE_FILES);
    expect(arch.seams).toEqual([
      { from: "src/api", to: "src/core", callbacks: ["onReady"], note: "declared seam" },
    ]);
  });
});

describe("the persisted shape round-trips exactly", () => {
  it("reading the file back gives the architecture discovery produced", () => {
    const computed = computeInfrastructure(root, SOURCE_FILES);
    const roundTripped = fromInfrastructureData(toInfrastructureData(computed));
    // Deep equality, not "equivalent": identical input to the renderer is the
    // only way the rendered map is guaranteed unchanged by the move.
    expect(roundTripped).toEqual(computed);
  });

  it("records how each link was established", () => {
    const data = toInfrastructureData(computeInfrastructure(root, SOURCE_FILES));
    const config = data.links.filter((l) => l.resourceId === "infra:external.payments");
    const matched = data.links.filter((l) => l.resourceId === "infra:aws_sqs_queue.orders");

    expect(config.every((l) => l.evidence === "config")).toBe(true);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((l) => l.evidence === "name-literal")).toBe(true);
  });

  it("keeps links out of the resources themselves", () => {
    const data = toInfrastructureData(computeInfrastructure(root, SOURCE_FILES));
    for (const resource of data.resources) {
      expect(resource).not.toHaveProperty("usedBy");
    }
  });
});

describe("serialization is byte-stable", () => {
  it("two runs over an unchanged tree produce identical bytes", () => {
    const first = toCanonicalJSON(toInfrastructureData(computeInfrastructure(root, SOURCE_FILES)));
    const second = toCanonicalJSON(toInfrastructureData(computeInfrastructure(root, SOURCE_FILES)));
    expect(second).toBe(first);
  });

  it("preserves discovery order instead of re-sorting", () => {
    // Sorting the persisted arrays is the obvious move and it is wrong:
    // discovery emits config-declared resources before IaC ones, so sorting
    // by id would reorder the map's nodes relative to a fresh discovery.
    const computed = computeInfrastructure(root, SOURCE_FILES);
    const data = toInfrastructureData(computed);

    expect(data.resources.map((r) => r.id)).toEqual(computed.infrastructure.map((i) => i.id));
    // The config-declared resource stays first, ahead of the IaC ones, even
    // though its id does not sort first.
    expect(data.resources[0].id).toBe("infra:external.payments");
    expect(data.resources.map((r) => r.id)).not.toEqual(
      [...data.resources.map((r) => r.id)].sort(),
    );
  });
});

describe("the export reads the file rather than recomputing", () => {
  it("uses the persisted data when it is given", () => {
    const computed = computeInfrastructure(root, SOURCE_FILES);
    const persisted = toInfrastructureData(computed);
    // A reader that recomputed would ignore this and find the real resources.
    const doctored = {
      ...persisted,
      resources: [{ id: "infra:only.in.file", name: "only-in-file", kind: "queue", origin: "config" }],
      links: [],
    };

    const loaded = loadDeclaredArchitecture(root, SOURCE_FILES, undefined, doctored);
    expect(loaded.infrastructure.map((i) => i.id)).toEqual(["infra:only.in.file"]);
  });

  it("falls back to discovery when there is no persisted file", () => {
    const loaded = loadDeclaredArchitecture(root, SOURCE_FILES, undefined, null);
    expect(loaded).toEqual(computeInfrastructure(root, SOURCE_FILES));
  });
});

describe("readInfrastructure", () => {
  function writeAnalysis(contents: string): string {
    const svDir = join(root, ".sourcevision-test");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, DATA_FILES.infrastructure), contents, "utf-8");
    return svDir;
  }

  it("reads a file discovery wrote", () => {
    const data = toInfrastructureData(computeInfrastructure(root, SOURCE_FILES));
    const svDir = writeAnalysis(toCanonicalJSON(data));
    expect(readInfrastructure(svDir)).toEqual(data);
  });

  it("reports an absent file as null so the caller can fall back", () => {
    expect(readInfrastructure(join(root, "no-such-analysis"))).toBeNull();
  });

  it("reports a malformed file as null rather than throwing", () => {
    // Falling back costs a tree walk; failing would take the whole map down
    // over a file nothing had to have.
    expect(readInfrastructure(writeAnalysis("{ not json"))).toBeNull();
    expect(readInfrastructure(writeAnalysis('{"resources":[]}'))).toBeNull();
    expect(readInfrastructure(writeAnalysis('{"resources":{},"links":[],"seams":[]}'))).toBeNull();
  });
});

describe("a project with no infrastructure at all", () => {
  it("reports nothing found, and no IaC", () => {
    const bare = join(tmpdir(), "sv-infrastructure-bare");
    rmSync(bare, { recursive: true, force: true });
    mkdirSync(join(bare, "src"), { recursive: true });
    writeFileSync(join(bare, "src/a.ts"), "export const a = 1;\n", "utf-8");

    const arch = computeInfrastructure(bare, ["src/a.ts"]);
    expect(arch).toEqual({ seams: [], infrastructure: [], sawIaC: false });
    expect(toInfrastructureData(arch)).toEqual({
      resources: [], seams: [], links: [], sawIaC: false,
    });

    rmSync(bare, { recursive: true, force: true });
  });
});
