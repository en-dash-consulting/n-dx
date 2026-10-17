/**
 * `analyze` over a Terraform project with and without the Terraform pack.
 *
 * Without it, infrastructure.json carries none of the model's fields. With
 * it, the Terraform resources already listed gain them, and every other
 * artifact, and every other part of infrastructure.json, is byte-identical.
 * The missing pack is simulated at the loader: its import fails as an
 * uninstalled package's does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { DATA_FILES } from "../../src/schema/data-files.js";
import type { InfrastructureData } from "../../src/schema/v1.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const terraform = vi.hoisted(() => ({ missing: false }));

vi.mock("../../src/language/pack-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/language/pack-loader.js")>();
  const notInstalled = () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-terraform' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" }));
  return {
    ...original,
    KNOWN_PACKS: original.KNOWN_PACKS.map((pack) =>
      pack.id === "terraform"
        ? { ...pack, importByResolution: () => (terraform.missing ? notInstalled() : pack.importByResolution()) }
        : pack,
    ),
  };
});

const FIXED_MTIME = new Date("2026-01-01T00:00:00Z");

const PROJECT: Record<string, string> = {
  "package.json": "{}",
  "src/app.ts": 'export const bucket = "orders-archive-bucket";\nexport const queue = "orders-intake-queue";\n',
  "main.tf": [
    'module "db" {',
    '  source = "./modules/db"',
    "}",
    "",
    'resource "aws_sqs_queue" "orders" {',
    '  name = "orders-intake-queue"',
    "}",
    "",
  ].join("\n"),
  "modules/db/versions.tf": [
    "terraform {",
    "  required_providers {",
    '    aws = { source = "hashicorp/aws", version = ">= 5.0" }',
    "  }",
    "}",
    "",
  ].join("\n"),
  "modules/db/main.tf": [
    'resource "aws_s3_bucket" "archive" {',
    '  bucket = "orders-archive-bucket"',
    "}",
    "",
    'resource "aws_rds_cluster" "orders" {',
    '  engine         = "postgres"',
    "  engine_version = var.engine_version",
    "  s3_import {",
    "    bucket_name = aws_s3_bucket.archive.id",
    "  }",
    "}",
    "",
    'variable "engine_version" {}',
    "",
  ].join("\n"),
};

/** Every file under `dir`, path → content. */
function readTree(dir: string, base = dir): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) for (const [k, v] of readTree(full, base)) out.set(k, v);
    else out.set(full.slice(base.length + 1), readFileSync(full, "utf-8"));
  }
  return out;
}

describe("analyze with the Terraform model", () => {
  const dirs: string[] = [];
  afterEach(() => {
    terraform.missing = false;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function analyze(missing: boolean): Promise<{ artifacts: Map<string, string>; warnings: string[]; logs: string[] }> {
    // The same project name each run: it is written into llms.txt and CONTEXT.md.
    const parent = mkdtempSync(join(tmpdir(), "sv-tf-model-"));
    dirs.push(parent);
    const dir = join(parent, "project");
    for (const [rel, body] of Object.entries(PROJECT)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
      // inventory.json records each file's mtime.
      utimesSync(join(dir, rel), FIXED_MTIME, FIXED_MTIME);
    }
    terraform.missing = missing;
    const warnings: string[] = [];
    const logs: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args.join(" ")));
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")));
    try {
      await cmdAnalyze(dir, ["--fast"]);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
    // Each run's own directory and clock appear in these; masked so only content is compared.
    const artifacts = readTree(join(dir, ".sourcevision"));
    for (const [path, text] of artifacts) {
      artifacts.set(path, text.split(dir).join("<project>").replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, "<time>"));
    }
    return { artifacts, warnings, logs };
  }

  const infrastructureOf = (artifacts: Map<string, string>): InfrastructureData =>
    JSON.parse(artifacts.get(DATA_FILES.infrastructure)!) as InfrastructureData;

  it("adds the model's fields to listed Terraform resources and changes nothing else", async (ctx) => {
    await skipUnlessPackRuns(ctx, "terraform");
    const without = await analyze(true);
    const withPack = await analyze(false);

    // Not listed in sourcevision.packs: no warning, one end-of-run suggestion.
    const optional = (logs: string[]) => logs.filter((l) => l.includes("Optional packs"));
    expect(without.warnings.filter((w) => w.startsWith("Terraform:"))).toEqual([]);
    expect(optional(without.logs)).toEqual(["Optional packs for this repo: terraform — ndx sv pack add <id>"]);
    expect(withPack.warnings.filter((w) => w.startsWith("Terraform:"))).toEqual([]);
    expect(optional(withPack.logs)).toEqual([]);

    const plain = infrastructureOf(without.artifacts);
    const enriched = infrastructureOf(withPack.artifacts);
    expect(plain.resources.map((r) => r.id)).toEqual([
      "infra:aws_rds_cluster.orders",
      "infra:aws_s3_bucket.archive",
      "infra:aws_sqs_queue.orders",
    ]);
    for (const r of plain.resources) {
      expect(Object.keys(r).filter((k) => ["module", "provider", "references", "attributes"].includes(k))).toEqual([]);
    }

    const byId = new Map(enriched.resources.map((r) => [r.id, r]));
    expect(byId.get("infra:aws_rds_cluster.orders")).toEqual({
      ...plain.resources[0],
      module: "module.db",
      provider: { name: "aws", version: ">= 5.0" },
      references: ["infra:aws_s3_bucket.archive"],
      attributes: { engine: "postgres", engineVersion: "var.engine_version" },
    });
    expect(byId.get("infra:aws_s3_bucket.archive")).toEqual({
      ...plain.resources[1],
      module: "module.db",
      provider: { name: "aws", version: ">= 5.0" },
    });
    expect(byId.get("infra:aws_sqs_queue.orders")).toEqual({ ...plain.resources[2], provider: { name: "aws" } });

    // Strip the added fields and the file is the one written without the pack.
    const stripped = {
      ...enriched,
      resources: enriched.resources.map(({ module: _m, provider: _p, references: _r, attributes: _a, ...rest }) => rest),
    };
    expect(stripped).toEqual(plain);

    // Every other analysis artifact; the manifest, run history and timing caches record the run, not the analysis.
    const others = (artifacts: Map<string, string>) =>
      [...artifacts].filter(
        ([path]) =>
          path !== DATA_FILES.infrastructure && path !== DATA_FILES.manifest && !path.startsWith(".cache/") && !path.startsWith("history/"),
      );
    expect(others(withPack.artifacts).map(([path]) => path)).toContain(DATA_FILES.zones);
    expect(others(withPack.artifacts)).toEqual(others(without.artifacts));
  }, 120_000);
});
