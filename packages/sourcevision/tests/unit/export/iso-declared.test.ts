/**
 * Declared architecture tests.
 *
 * Injection seams and runtime infrastructure are the two things the import
 * graph structurally cannot show. Both arrive as claims — from `.n-dx.json` or
 * from IaC — so the tests care as much about how a claim that cannot be drawn
 * is *reported* as about the happy path. Silently dropping a declaration
 * somebody wrote is the failure mode worth guarding.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readDeclaredConfig,
  discoverFromIaC,
  linkInfrastructure,
  loadDeclaredArchitecture,
} from "../../../src/export/iso-declared.js";
import {
  loadFromScan,
  buildSeamEvidence,
  resolveSeams,
  seamGaps,
} from "../../../src/export/iso-sources.js";
import { buildIsoModel } from "../../../src/export/iso-model.js";
import type { CallEdge, CallGraph } from "../../../src/schema/v1.js";

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "iso-decl-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return root;
}

/** A project with two zones, enough files each to survive speck-folding. */
const BASE_FILES: Record<string, string> = {
  "src/api/a.ts": `import { c } from "../core/c";\nexport const a = c;\n`,
  "src/api/b.ts": "export const b = 1;\n",
  "src/api/d.ts": "export const d = 1;\n",
  "src/core/c.ts": "export const c = 1;\n",
  "src/core/e.ts": "export const e = 1;\n",
  "src/core/f.ts": "export const f = 1;\n",
};

function withConfig(isoMap: unknown, extra: Record<string, string> = {}): string {
  return makeProject({
    ...BASE_FILES,
    ...extra,
    ".n-dx.json": JSON.stringify({ sourcevision: { isoMap } }, null, 2),
  });
}

// ── Config reading ──────────────────────────────────────────────────────────

describe("readDeclaredConfig", () => {
  it("returns nothing when the project has no config", () => {
    const dir = makeProject(BASE_FILES);
    expect(readDeclaredConfig(dir)).toEqual({ seams: [], infrastructure: [] });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads seams and infrastructure", () => {
    const dir = withConfig({
      injectionSeams: [{ from: "src/api", to: "src/core", callbacks: ["onDone"], note: "why" }],
      infrastructure: [{ id: "q", name: "jobs", kind: "queue", usedBy: ["src/core"] }],
    });
    const config = readDeclaredConfig(dir);
    expect(config.seams).toHaveLength(1);
    expect(config.seams[0].callbacks).toEqual(["onDone"]);
    expect(config.infrastructure[0]).toMatchObject({ id: "q", kind: "queue", origin: "config" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores malformed entries rather than throwing", () => {
    const dir = withConfig({
      injectionSeams: [{ from: "src/api" }, null, { from: "a", to: "b" }],
      infrastructure: [{ name: "no id" }],
    });
    const config = readDeclaredConfig(dir);
    expect(config.seams).toHaveLength(1);
    expect(config.infrastructure).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("survives unparseable JSON", () => {
    const dir = makeProject({ ...BASE_FILES, ".n-dx.json": "{ not json" });
    expect(readDeclaredConfig(dir)).toEqual({ seams: [], infrastructure: [] });
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── IaC discovery ───────────────────────────────────────────────────────────

describe("discoverFromIaC", () => {
  it("reports no IaC when there are no .tf files", () => {
    const dir = makeProject(BASE_FILES);
    expect(discoverFromIaC(dir)).toEqual({ infrastructure: [], sawIaC: false });
    rmSync(dir, { recursive: true, force: true });
  });

  it("classifies the resource types the map has something to say about", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/main.tf": `
resource "aws_s3_bucket" "documents" {
  bucket = "acme-documents-prod"
}
resource "aws_sqs_queue" "ingest" {
  name = "acme-ingest-queue"
}
resource "aws_dynamodb_table" "ledger" {
  name = "acme-ledger"
}
resource "aws_elasticache_cluster" "sessions" {}
resource "aws_iam_role" "irrelevant" {}
`,
    });
    const { infrastructure, sawIaC } = discoverFromIaC(dir);
    expect(sawIaC).toBe(true);
    const byKind = Object.fromEntries(infrastructure.map((i) => [i.name, i.kind]));
    expect(byKind).toEqual({
      documents: "bucket",
      ingest: "queue",
      ledger: "database",
      sessions: "cache",
    });
    // An IAM role is real infrastructure but says nothing about architecture.
    expect(infrastructure.some((i) => i.name === "irrelevant")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("records which file declared each resource", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/storage.tf": `resource "aws_s3_bucket" "documents" {}\n`,
    });
    const { infrastructure } = discoverFromIaC(dir);
    expect(infrastructure[0].origin).toBe("infra/storage.tf");
    expect(infrastructure[0].note).toContain("aws_s3_bucket");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports no IaC when the only YAML has nothing to do with infrastructure", () => {
    // A repository full of CI config and k8s manifests must not read as IaC.
    const dir = makeProject({
      ...BASE_FILES,
      ".github/workflows/ci.yml": `on: push
jobs:
  test:
    runs-on: ubuntu-latest
`,
      "deploy/pod.yaml": `apiVersion: v1
kind: Pod
metadata:
  name: web
`,
    });
    expect(discoverFromIaC(dir)).toEqual({ infrastructure: [], sawIaC: false });
    rmSync(dir, { recursive: true, force: true });
  });

  it("discovers CloudFormation resources with no hand declaration", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/template.yaml": `
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  DocumentsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: acme-documents-prod
  IngestQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: acme-ingest-queue
  Ledger:
    Type: AWS::DynamoDB::Table
  Worker:
    Type: AWS::Lambda::Function
  Nightly:
    Type: AWS::Events::Rule
  AppRole:
    Type: AWS::IAM::Role
`,
    });
    const { infrastructure, sawIaC } = discoverFromIaC(dir);
    expect(sawIaC).toBe(true);
    expect(Object.fromEntries(infrastructure.map((i) => [i.name, i.kind]))).toEqual({
      DocumentsBucket: "bucket",
      IngestQueue: "queue",
      Ledger: "database",
      Worker: "compute",
      Nightly: "scheduler",
    });
    // An IAM role is real infrastructure but says nothing about architecture.
    expect(infrastructure.some((i) => i.name === "AppRole")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("classifies both IaC conventions to the same kind from one table", () => {
    // The point of sharing the table: AWS::S3::Bucket and aws_s3_bucket are
    // the same architectural fact spelled two ways.
    const pairs: Array<[string, string]> = [
      ["aws_s3_bucket", "AWS::S3::Bucket"],
      ["aws_sqs_queue", "AWS::SQS::Queue"],
      ["aws_sns_topic", "AWS::SNS::Topic"],
      ["aws_dynamodb_table", "AWS::DynamoDB::Table"],
      ["aws_elasticache_cluster", "AWS::ElastiCache::CacheCluster"],
      ["aws_kinesis_stream", "AWS::Kinesis::Stream"],
      ["aws_lambda_function", "AWS::Lambda::Function"],
      ["aws_secretsmanager_secret", "AWS::SecretsManager::Secret"],
    ];
    for (const [tf, cfn] of pairs) {
      const dir = makeProject({
        ...BASE_FILES,
        "infra/main.tf": `resource "${tf}" "thing" {}
`,
        "infra/template.yaml": `Resources:
  Thing:
    Type: ${cfn}
`,
      });
      const kinds = discoverFromIaC(dir).infrastructure.map((i) => i.kind);
      expect(kinds).toHaveLength(2);
      expect(kinds[0], `${tf} vs ${cfn}`).toBe(kinds[1]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads Terraform and CloudFormation in the same project", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/main.tf": `resource "aws_s3_bucket" "documents" {}
`,
      "infra/template.yaml": `Resources:
  IngestQueue:
    Type: AWS::SQS::Queue
`,
    });
    const { infrastructure } = discoverFromIaC(dir);
    expect(infrastructure.map((i) => i.name).sort()).toEqual(["IngestQueue", "documents"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("records which CloudFormation file declared each resource", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/template.yml": `Resources:
  Docs:
    Type: AWS::S3::Bucket
`,
    });
    const { infrastructure } = discoverFromIaC(dir);
    expect(infrastructure[0].origin).toBe("infra/template.yml");
    expect(infrastructure[0].note).toContain("AWS::S3::Bucket");
    rmSync(dir, { recursive: true, force: true });
  });

  it("picks up a CloudFormation name property as a matchable literal", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/template.yaml": `Resources:
  Docs:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: acme-documents-prod
`,
    });
    const { infrastructure } = discoverFromIaC(dir);
    expect(infrastructure[0].literals).toContain("acme-documents-prod");
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a resource whose Properties precede its Type", () => {
    // YAML mapping order is free, and SAM templates commonly put Properties
    // first. The literal has to be found either way, and the block must not
    // be mistaken for a resource called "Properties".
    const dir = makeProject({
      ...BASE_FILES,
      "infra/template.yaml": `Resources:
  ApiFn:
    Properties:
      FunctionName: order-api
      Runtime: nodejs20.x
    Type: AWS::Lambda::Function
`,
    });
    const { infrastructure } = discoverFromIaC(dir);
    expect(infrastructure).toHaveLength(1);
    expect(infrastructure[0].name).toBe("ApiFn");
    expect(infrastructure[0].kind).toBe("compute");
    expect(infrastructure[0].literals).toContain("order-api");
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores intrinsic functions where a literal name would go", () => {
    // `!Sub "orders-${Stage}"` is not a name that appears in code, so matching
    // on it would attribute the resource to whatever mentions the template.
    const dir = makeProject({
      ...BASE_FILES,
      "infra/template.yaml": `Resources:
  OrderQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub "orders-\${Stage}"
`,
    });
    const { infrastructure } = discoverFromIaC(dir);
    expect(infrastructure[0].literals).toEqual(["OrderQueue"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("links a CloudFormation resource to the zones naming it", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "src/core/f.ts": `export const bucket = "acme-documents-prod";
`,
      "infra/template.yaml": `Resources:
  Docs:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: acme-documents-prod
`,
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    const node = model.nodes.find((n) => n.kind === "infra");
    expect(node).toBeDefined();
    expect(node!.name).toBe("Docs");
    expect(node!.inbound.map((l) => l.id)).toContain("src/core");
    rmSync(dir, { recursive: true, force: true });
  });

  it("is deterministic across runs", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "infra/a.tf": `resource "aws_sqs_queue" "beta" {}\nresource "aws_s3_bucket" "alpha" {}\n`,
    });
    expect(JSON.stringify(discoverFromIaC(dir))).toBe(JSON.stringify(discoverFromIaC(dir)));
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── Linking ─────────────────────────────────────────────────────────────────

describe("linkInfrastructure", () => {
  const infra = (over = {}) => ({
    id: "infra:aws_sqs_queue.ingest",
    name: "ingest",
    kind: "queue",
    usedBy: [],
    origin: "infra/main.tf",
    literals: ["acme-ingest-queue"],
    ...over,
  });

  it("attributes a resource to the files naming it", () => {
    const files = { "src/a.ts": `const q = "acme-ingest-queue";`, "src/b.ts": "const x = 1;" };
    const [linked] = linkInfrastructure(
      [infra() as never],
      Object.keys(files),
      (p) => files[p as keyof typeof files] ?? null,
    );
    expect(linked.usedBy).toEqual(["src/a.ts"]);
  });

  it("leaves a config-declared resource's own usedBy alone", () => {
    const [linked] = linkInfrastructure(
      [{ id: "q", name: "jobs", kind: "queue", usedBy: ["src/core"], origin: "config" }],
      ["src/a.ts"],
      () => `jobs`,
    );
    expect(linked.usedBy).toEqual(["src/core"]);
  });

  it("refuses to match on names too generic to mean anything", () => {
    // "main" would otherwise link half the repository.
    const [linked] = linkInfrastructure(
      [infra({ name: "main", literals: ["main"] }) as never],
      ["src/a.ts"],
      () => `export function main(){}`,
    );
    expect(linked.usedBy).toEqual([]);
  });
});

// ── End to end, through the model ───────────────────────────────────────────

describe("declared architecture in the model", () => {
  it("draws a cross-zone seam in the runtime direction", () => {
    const dir = withConfig({
      injectionSeams: [
        { from: "src/core", to: "src/api", callbacks: ["broadcast"], note: "core calls back" },
      ],
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    const seam = model.edges.find((e) => e.seam);
    expect(seam).toBeDefined();
    // The import runs api → core; the declared seam runs the other way.
    expect(seam!.from).toBe("src/core");
    expect(seam!.to).toBe("src/api");
    expect(seam!.seam!.callbacks).toEqual(["broadcast"]);
    expect(seam!.weight).toBe(0);
    expect(model.meta.seamCount).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a seam whose ends share a zone instead of dropping it", () => {
    const dir = withConfig({
      injectionSeams: [{ from: "src/core/c.ts", to: "src/core/e.ts" }],
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    expect(model.meta.seamCount).toBe(0);
    expect(model.meta.gaps.some((g) => g.includes("both ends inside one zone"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a seam naming something no zone owns", () => {
    const dir = withConfig({
      injectionSeams: [{ from: "src/api", to: "nowhere/at/all.ts" }],
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    expect(model.meta.seamCount).toBe(0);
    expect(model.meta.gaps.some((g) => g.includes("could not be placed"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("draws declared infrastructure as its own node downstream of its users", () => {
    const dir = withConfig({
      infrastructure: [
        { id: "infra:jobs", name: "jobs-queue", kind: "queue", usedBy: ["src/core"], note: "async work" },
      ],
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    const node = model.nodes.find((n) => n.kind === "infra");
    expect(node).toBeDefined();
    expect(node!.name).toBe("jobs-queue");
    expect(model.meta.infraCount).toBe(1);

    const core = model.nodes.find((n) => n.id === "src/core")!;
    expect(node!.col).toBeGreaterThan(core.col);

    const edge = model.edges.find((e) => e.infra);
    expect(edge).toMatchObject({ from: "src/core", to: "infra:jobs" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("omits infrastructure nothing on the map uses", () => {
    const dir = withConfig({
      infrastructure: [{ id: "infra:orphan", name: "orphan", kind: "queue", usedBy: [] }],
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    expect(model.nodes.some((n) => n.kind === "infra")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("picks up Terraform resources and links them by name", () => {
    const dir = makeProject({
      ...BASE_FILES,
      "src/core/f.ts": `export const bucket = "acme-documents-prod";\n`,
      "infra/main.tf": `resource "aws_s3_bucket" "documents" {\n  bucket = "acme-documents-prod"\n}\n`,
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    const node = model.nodes.find((n) => n.kind === "infra");
    expect(node).toBeDefined();
    expect(node!.name).toBe("documents");
    expect(node!.body).toContain("infra/main.tf");
    expect(node!.inbound.map((l) => l.id)).toContain("src/core");
    rmSync(dir, { recursive: true, force: true });
  });

  it("states that infrastructure is declared, not detected", () => {
    const dir = withConfig({
      infrastructure: [{ id: "infra:jobs", name: "jobs", kind: "queue", usedBy: ["src/core"] }],
    });
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    expect(model.meta.gaps.some((g) => g.includes("declarations, not detection"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("tells a project with no declarations how to add them", () => {
    const dir = makeProject(BASE_FILES);
    const model = buildIsoModel(loadFromScan(dir, { useGit: false, analyzedAt: "t" }));
    expect(model.meta.gaps.some((g) => g.includes("sourcevision.isoMap.infrastructure"))).toBe(true);
    expect(model.meta.gaps.some((g) => g.includes("sourcevision.isoMap.injectionSeams"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── Seam verification ───────────────────────────────────────────────────────

/**
 * A declared seam is a claim, and the call graph is the only evidence available
 * to test it against. These tests pin the two ways that check can go wrong:
 * believing a stale declaration, and crying wolf over a real one.
 */
describe("seam verification", () => {
  const ZONE_OF_FILE = new Map<string, string>([
    ["src/api/a.ts", "src/api"],
    ["src/api/b.ts", "src/api"],
    ["src/core/c.ts", "src/core"],
  ]);
  const ZONE_IDS = new Set(["src/api", "src/core"]);

  function callGraph(edges: Array<Partial<CallEdge>>): CallGraph {
    return {
      functions: [],
      edges: edges.map((e) => ({
        callerFile: "src/api/a.ts",
        caller: "handler",
        calleeFile: null,
        callee: "noop",
        type: "direct",
        line: 1,
        column: 0,
        ...e,
      })) as CallEdge[],
      summary: {} as CallGraph["summary"],
    };
  }

  it("corroborates a callback called from inside the target zone", () => {
    const evidence = buildSeamEvidence(
      callGraph([{ callerFile: "src/api/a.ts", callee: "broadcast" }]),
      ZONE_OF_FILE,
    );
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api", callbacks: ["broadcast"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    expect(seams).toHaveLength(1);
    expect(seams[0].verified).toBe(true);
    expect(seams[0].unsupported).toEqual([]);
  });

  it("still corroborates a callback the target forwards rather than calls itself", () => {
    // register-scheduler.ts receives four callbacks and passes them onward
    // instead of invoking them. Evidence is scoped to the zone, not the file,
    // so forwarding still counts — a file-scoped check called this real seam
    // stale.
    const evidence = buildSeamEvidence(
      callGraph([{ callerFile: "src/api/b.ts", callee: "broadcast" }]),
      ZONE_OF_FILE,
    );
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api/a.ts", callbacks: ["broadcast"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    expect(seams[0].verified).toBe(true);
  });

  it("matches a callback invoked through the object it arrived on", () => {
    const evidence = buildSeamEvidence(
      callGraph([{ callerFile: "src/api/a.ts", callee: "opts.loadPRD", type: "method" }]),
      ZONE_OF_FILE,
    );
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api", callbacks: ["loadPRD"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    expect(seams[0].verified).toBe(true);
  });

  it("marks a seam unverified when no call in the target names its callback", () => {
    const evidence = buildSeamEvidence(
      callGraph([{ callerFile: "src/api/a.ts", callee: "somethingElse" }]),
      ZONE_OF_FILE,
    );
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api", callbacks: ["onDone", "broadcast"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    expect(seams[0].verified).toBe(false);
    expect(seams[0].unsupported).toEqual(["broadcast", "onDone"]);
  });

  it("does not count a call made from the injecting side as evidence", () => {
    // The injector naming its own callback proves nothing about the target;
    // counting it would corroborate every seam that compiles.
    const evidence = buildSeamEvidence(
      callGraph([{ callerFile: "src/core/c.ts", callee: "broadcast" }]),
      ZONE_OF_FILE,
    );
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api", callbacks: ["broadcast"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    expect(seams[0].verified).toBe(false);
  });

  it("leaves verification unknown when there is no call graph", () => {
    // Absence of evidence must not render as evidence of absence: a project
    // analysed without --deep has nothing to check against.
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api", callbacks: ["broadcast"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
    );
    expect(seams[0].verified).toBeUndefined();
    expect(seams[0].unsupported).toBeUndefined();
  });

  it("treats a seam declaring no callbacks as nothing to verify", () => {
    const evidence = buildSeamEvidence(callGraph([]), ZONE_OF_FILE);
    const { seams } = resolveSeams(
      [{ from: "src/core", to: "src/api" }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    expect(seams[0].verified).toBeUndefined();
  });

  it("reports unsupported callbacks to the reader, naming them", () => {
    const evidence = buildSeamEvidence(callGraph([]), ZONE_OF_FILE);
    const resolution = resolveSeams(
      [{ from: "src/core", to: "src/api", callbacks: ["onDone"] }],
      ZONE_IDS,
      ZONE_OF_FILE,
      evidence,
    );
    const gaps = seamGaps(resolution);
    expect(gaps.some((g) => g.includes("onDone"))).toBe(true);
    expect(gaps.some((g) => g.includes("no supporting call"))).toBe(true);
  });

  it("names the endpoint that could not be placed", () => {
    // A refactor that moves a file leaves the declaration behind; "one seam
    // could not be placed" does not tell the reader which end rotted.
    const resolution = resolveSeams(
      [{ from: "src/api", to: "src/server/register-scheduler.ts" }],
      ZONE_IDS,
      ZONE_OF_FILE,
    );
    expect(resolution.seams).toHaveLength(0);
    const gaps = seamGaps(resolution);
    expect(gaps.some((g) => g.includes("src/server/register-scheduler.ts"))).toBe(true);
  });

  it("carries the unverified mark through to the drawn edge", () => {
    const model = buildIsoModel({
      ...loadFromScan(makeProject(BASE_FILES), { useGit: false, analyzedAt: "t" }),
      seams: [
        {
          fromZone: "src/core",
          toZone: "src/api",
          callbacks: ["onDone"],
          verified: false,
          unsupported: ["onDone"],
        },
      ],
    });
    const seam = model.edges.find((e) => e.seam);
    expect(seam).toBeDefined();
    expect(seam!.seam!.verified).toBe(false);
    expect(seam!.seam!.unsupported).toEqual(["onDone"]);
  });
});

describe("loadDeclaredArchitecture", () => {
  it("combines config and IaC without reading files when there is nothing to link", () => {
    const dir = withConfig({
      infrastructure: [{ id: "c", name: "cfg", kind: "queue", usedBy: ["src/core"] }],
    });
    let reads = 0;
    const declared = loadDeclaredArchitecture(dir, ["src/api/a.ts"], () => {
      reads += 1;
      return "";
    });
    expect(declared.infrastructure).toHaveLength(1);
    expect(reads).toBe(0); // config entries carry their own usedBy
    rmSync(dir, { recursive: true, force: true });
  });
});
