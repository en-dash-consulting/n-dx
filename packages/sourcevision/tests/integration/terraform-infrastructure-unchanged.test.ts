/**
 * Inventorying Terraform files must not change `infrastructure.json`.
 *
 * `.tf` files are in the inventory now, and `analyze` hands every inventory
 * path to `computeInfrastructure`. Without its Terraform exclusion, a
 * resource's own `.tf` file would be linked as a user of that resource.
 * This runs the real analyze command so the wiring in `analyze.ts` is covered,
 * not just the helper.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { DATA_FILES } from "../../src/schema/data-files.js";

describe("analyze with Terraform files", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("links infrastructure only to non-Terraform files", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-tf-infra-"));
    const files: Record<string, string> = {
      "package.json": "{}",
      "src/app.ts": 'export const q = "orders-intake-queue";\n',
      "infra/main.tf": 'resource "aws_sqs_queue" "orders" {\n  name = "orders-intake-queue"\n}\n',
      "infra/variables.tf": '# orders-intake-queue is created in main.tf\nvariable "x" {}\n',
    };
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }

    await cmdAnalyze(dir, ["--fast"]);

    const svDir = join(dir, ".sourcevision");
    const inventory = JSON.parse(readFileSync(join(svDir, DATA_FILES.inventory), "utf-8"));
    expect(inventory.files.map((f: { path: string }) => f.path)).toContain("infra/main.tf");

    const infra = JSON.parse(readFileSync(join(svDir, DATA_FILES.infrastructure), "utf-8"));
    expect(infra.links.map((l: { target: string }) => l.target)).toEqual(["src/app.ts"]);
  }, 60_000);
});
