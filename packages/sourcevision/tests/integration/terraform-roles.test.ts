/**
 * Terraform files in a TypeScript repo must not change classifications.
 *
 * Terraform is inventoried with the role `config`, and classification reads
 * only `source` files. This runs the real analyze command on the same fixture
 * with and without `infra/*.tf`.
 *
 * Zones select files by extension, not role, so `infra/*.tf` forms its own
 * zone, as it did before Terraform was recognised (task e052cf8e, decision 2:
 * main's zoning is the baseline). Terraform under a test path keeps the role
 * `test` it had then, so it stays quarantined with the tests.
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
};

const TERRAFORM_FILES: Record<string, string> = {
  "infra/main.tf": 'resource "aws_sqs_queue" "orders" {\n  name = "orders-intake-queue"\n}\n',
  "infra/variables.tf": 'variable "region" {\n  default = "us-east-1"\n}\n',
  "infra/prod.tfvars": 'region = "us-west-2"\n',
  "infra/terragrunt.hcl": 'include {\n  path = find_in_parent_folders()\n}\n',
  "infra/tests/main.tftest.hcl": 'run "plan" {\n  command = plan\n}\n',
};

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
      .filter((f) => f.path.startsWith("infra/"))
      .map((f) => [f.path, f.role]);
    expect(tfRoles).toEqual(
      Object.keys(TERRAFORM_FILES).sort().map((p) => [p, p.includes("/tests/") ? "test" : "config"]),
    );
  }, 120_000);

  it("quarantines Terraform under tests/ with the tests", async () => {
    const fixture = "tests/fixtures/infra/main.tf";
    const mixed = await analyze({
      ...TS_FILES,
      ...TERRAFORM_FILES,
      "tests/route.test.ts": 'import { route } from "../src/api/route.js";\nroute();\n',
      [fixture]: TERRAFORM_FILES["infra/main.tf"],
    });
    const inventory = readOutput(mixed, DATA_FILES.inventory) as { files: { path: string; role: string }[] };
    const role = new Map(inventory.files.map((f) => [f.path, f.role]));
    expect(role.get(fixture)).toBe("test");

    const { zones } = readOutput(mixed, DATA_FILES.zones) as { zones: { id: string; files: string[] }[] };
    const holding = zones.filter((z) => z.files.includes(fixture));
    expect(holding).toHaveLength(1);
    expect(holding[0].files.filter((f) => role.get(f) !== "test")).toEqual([]);
  }, 120_000);

  it("writes identical classifications.json", async () => {
    const plain = await analyze(TS_FILES);
    const mixed = await analyze({ ...TS_FILES, ...TERRAFORM_FILES });
    expect(readOutput(mixed, DATA_FILES.classifications)).toEqual(readOutput(plain, DATA_FILES.classifications));
  }, 120_000);
});
