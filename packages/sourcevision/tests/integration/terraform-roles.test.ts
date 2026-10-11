/**
 * Terraform files in a TypeScript repo must not change classifications or zones.
 *
 * Terraform is inventoried with the role `config` (or `test` under a test
 * path), and classification reads only `source` files. Zone detection leaves
 * Terraform out entirely (task 43a98ad8, decision 3), as main did when it did
 * not inventory Terraform at all. This runs the real analyze command on the
 * same fixture with and without the Terraform files.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { DATA_FILES } from "../../src/schema/data-files.js";

const TS_FILES: Record<string, string> = {
  "package.json": '{ "name": "tf-mixed" }',
  "src/index.ts": 'import { route } from "./api/route.js";\nimport { save } from "./db/store.js";\nexport const run = () => save(route());\n',
  "src/api/route.ts": 'import { parse } from "./parse.js";\nexport const route = () => parse("/orders");\n',
  "src/api/parse.ts": "export const parse = (p: string) => p.split(\"/\");\n",
  "src/db/store.ts": 'import { connect } from "./client.js";\nexport const save = (x: unknown) => connect().put(x);\n',
  "src/db/client.ts": "export const connect = () => ({ put: (x: unknown) => x });\n",
  "tests/route.test.ts": 'import { route } from "../src/api/route.js";\nroute();\n',
};

const SQS_QUEUE = 'resource "aws_sqs_queue" "orders" {\n  name = "orders-intake-queue"\n}\n';

const TERRAFORM_FILES: Record<string, string> = {
  "infra/main.tf": SQS_QUEUE,
  "infra/variables.tf": 'variable "region" {\n  default = "us-east-1"\n}\n',
  "infra/prod.tfvars": 'region = "us-west-2"\n',
  "infra/terragrunt.hcl": 'include {\n  path = find_in_parent_folders()\n}\n',
  "infra/tests/main.tftest.hcl": 'run "plan" {\n  command = plan\n}\n',
  "tests/fixtures/infra/main.tf": SQS_QUEUE,
};

const isTerraform = (path: string): boolean => path in TERRAFORM_FILES;

interface ZonesOutput {
  zones: { id: string; description?: string; files: string[] }[];
}

/** Fields that legitimately differ between two runs, whatever the input. */
const VOLATILE = new Set(["analyzedAt", "generatedAt", "timestamp", "durationMs"]);

function readOutput(svDir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(svDir, file), "utf-8"), (key, value) =>
    VOLATILE.has(key) ? undefined : value,
  );
}

describe("analyze a TypeScript repo with and without Terraform", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function analyze(files: Record<string, string>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "sv-tf-zones-"));
    dirs.push(dir);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    await cmdAnalyze(dir, ["--fast"]);
    return join(dir, ".sourcevision");
  }

  it("inventories Terraform as config, or test under a TypeScript test path", async () => {
    const mixed = await analyze({ ...TS_FILES, ...TERRAFORM_FILES });
    const inventory = readOutput(mixed, DATA_FILES.inventory) as { files: { path: string; role: string }[] };
    const tfRoles = inventory.files
      .filter((f) => isTerraform(f.path))
      .map((f) => [f.path, f.role]);
    expect(tfRoles).toEqual(
      Object.keys(TERRAFORM_FILES).sort().map((p) => [p, /(^|\/)tests\//.test(p) ? "test" : "config"]),
    );
  }, 120_000);

  it("writes identical zones.json, and no zone lists or names Terraform", async () => {
    const plain = await analyze(TS_FILES);
    const mixed = await analyze({ ...TS_FILES, ...TERRAFORM_FILES });
    const zones = readOutput(mixed, DATA_FILES.zones) as ZonesOutput;
    expect(zones).toEqual(readOutput(plain, DATA_FILES.zones));
    for (const zone of zones.zones) {
      expect(zone.files.filter(isTerraform)).toEqual([]);
      expect(zone.description ?? "").not.toMatch(/terraform/i);
    }
  }, 120_000);

  it("writes identical classifications.json", async () => {
    const plain = await analyze(TS_FILES);
    const mixed = await analyze({ ...TS_FILES, ...TERRAFORM_FILES });
    expect(readOutput(mixed, DATA_FILES.classifications)).toEqual(readOutput(plain, DATA_FILES.classifications));
  }, 120_000);

  it("analyzes a Terraform-primary repo and zones its other files as before", async () => {
    const helpers: Record<string, string> = {
      "scripts/plan.ts": 'import { fmt } from "./fmt.js";\nexport const plan = () => fmt("plan");\n',
      "scripts/fmt.ts": "export const fmt = (s: string) => s.trim();\n",
    };
    const terraform: Record<string, string> = {
      "main.tf": 'module "queue" {\n  source = "./modules/queue"\n}\n',
      "variables.tf": 'variable "region" {\n  default = "us-east-1"\n}\n',
      "modules/queue/main.tf": SQS_QUEUE,
    };
    const plain = await analyze(helpers);
    const mixed = await analyze({ ...helpers, ...terraform });
    const inventory = readOutput(mixed, DATA_FILES.inventory) as { files: { path: string; language: string }[] };
    expect(inventory.files.filter((f) => f.language === "Terraform").map((f) => f.path).sort())
      .toEqual(Object.keys(terraform).sort());
    expect(readOutput(mixed, DATA_FILES.zones)).toEqual(readOutput(plain, DATA_FILES.zones));
  }, 120_000);
});
