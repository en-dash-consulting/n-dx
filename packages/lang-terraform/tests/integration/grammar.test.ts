/**
 * The tree-sitter-hcl grammar built by `pnpm --filter @n-dx/lang-terraform
 * build:grammars` parses Terraform and Terragrunt sources (these tests skip
 * when it is not built), and the pack entry runs it over a project.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, terraformGrammarPath, terraformPack } from "../../src/index.js";

const WASM = terraformGrammarPath();
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

const TF = `terraform {
  required_version = ">= 1.6"
}

variable "name" {
  type = string
}

resource "aws_sqs_queue" "orders" {
  name = "\${var.name}-orders"
  tags = { for k, v in var.tags : k => upper(v) }
}
`;

describe("tree-sitter-hcl grammar", () => {
  it("parses a Terraform file without error nodes", async (ctx) => {
    skipUnlessGrammar(ctx, WASM);
    const result = await runner.parseSource({ pack: terraformPack, grammarPath: WASM }, "main.tf", TF);
    expect(result).toMatchObject({ status: "parsed", hasErrorNodes: false, hasMissingNodes: false });
  });

  it("reports a file it cannot fully parse", async (ctx) => {
    skipUnlessGrammar(ctx, WASM);
    const result = await runner.parseSource({ pack: terraformPack, grammarPath: WASM }, "bad.tf", 'resource "a" {\n  x = \n');
    expect(result).toMatchObject({ status: "parsed" });
    expect(result.status === "parsed" && (result.hasErrorNodes || result.hasMissingNodes)).toBe(true);
  });
});

describe("pack entry", () => {
  it("parses a project's Terraform files and returns each one's resources", async (ctx) => {
    skipUnlessGrammar(ctx, WASM);
    const dir = await mkdtemp(join(tmpdir(), "lang-tf-"));
    try {
      await mkdir(join(dir, "infra"));
      await writeFile(join(dir, "infra", "main.tf"), TF);
      const result = await pack.analyzeProject({ projectDir: dir, files: ["infra/main.tf", "infra/missing.tf"] });
      expect(result.degraded).toBeUndefined();
      expect(result.unparsed).toEqual(["infra/missing.tf"]);
      expect(result.facts).toEqual([
        {
          path: "infra/main.tf",
          resources: [{ type: "aws_sqs_queue", name: "orders", position: { line: 9, column: 0 }, provider: { name: "aws" } }],
        },
      ]);
      const symbolsOnly = await pack.analyzeProject({ projectDir: dir, files: ["infra/main.tf"], kinds: ["symbols"] });
      expect(symbolsOnly.facts).toEqual([{ path: "infra/main.tf" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
