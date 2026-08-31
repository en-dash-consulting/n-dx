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
import { loadFromScan } from "../../../src/export/iso-sources.js";
import { buildIsoModel } from "../../../src/export/iso-model.js";

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
