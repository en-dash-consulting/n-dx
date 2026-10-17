import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "@n-dx/llm-client";
import { detectLanguage, detectLanguages, getLanguageConfig } from "../../../src/language/detect.js";
import { terraformConfig } from "../../../src/language/terraform.js";
import { javaConfig, javaSecondaryConfig } from "../../../src/language/java.js";
import { typescriptConfig } from "../../../src/language/typescript.js";
import { analyzeInventory, classifyRole } from "../../../src/analyzers/inventory.js";
import { computeInfrastructure, toInfrastructureData } from "../../../src/analyzers/infrastructure.js";
import { GRAMMARS } from "../../../scripts/build-grammars.mjs";

describe("terraform language config", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-tf-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function touch(rel: string, body = ""): Promise<void> {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  it("is registered under the id terraform", () => {
    expect(getLanguageConfig("terraform")).toBe(terraformConfig);
  });

  it("pins tree-sitter-hcl v1.2.0 with a checksum", () => {
    expect(GRAMMARS["tree-sitter-hcl"]).toMatchObject({
      repo: "tree-sitter-grammars/tree-sitter-hcl",
      version: "1.2.0",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  describe("detection", () => {
    it("is primary when .tf files are the only evidence", async () => {
      await touch("infra/main.tf");
      expect(await detectLanguage(dir)).toBe(terraformConfig);
      expect(await detectLanguages(dir)).toEqual([terraformConfig]);
    });

    it("never displaces another primary language", async () => {
      await touch("package.json", "{}");
      await touch("infra/main.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      expect(await detectLanguages(dir)).toEqual([typescriptConfig, terraformConfig]);
    });

    it("ranks Java above Terraform", async () => {
      await touch("pom.xml");
      await touch("infra/main.tf");
      expect(await detectLanguage(dir)).toBe(javaConfig);
      expect(await detectLanguages(dir)).toEqual([javaConfig, terraformConfig]);
      await touch("package.json", "{}");
      expect(await detectLanguages(dir)).toEqual([typescriptConfig, javaSecondaryConfig, terraformConfig]);
    });

    it("ignores .tf files under .terraform/ and node_modules", async () => {
      await touch(".terraform/modules/x/main.tf");
      await touch("node_modules/pkg/main.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      expect(await detectLanguages(dir)).toEqual([typescriptConfig]);
    });

    it("leaves repositories without .tf files unchanged", async () => {
      await touch("package.json", "{}");
      await touch("main.tfvars");
      expect(await detectLanguages(dir)).toEqual([typescriptConfig]);
    });
  });

  describe("inventory roles", () => {
    const role = (p: string): string => classifyRole(p, "Terraform", terraformConfig);

    it("classifies roles", () => {
      expect(role("infra/main.tf")).toBe("source");
      expect(role("infra/prod.tfvars")).toBe("config");
      expect(role("live/prod/terragrunt.hcl")).toBe("config");
      expect(role("infra/tests/basic.tftest.hcl")).toBe("test");
    });

    it("inventories Terraform files and skips .terraform/", async () => {
      await touch("main.tf", "");
      await touch("prod.tfvars", "x = 1\n");
      await touch("live/terragrunt.hcl", "");
      await touch("other.hcl", "");
      await touch(".terraform/providers/p.tf", "");
      const inv = await analyzeInventory(dir, { languageConfig: terraformConfig });
      const byPath = Object.fromEntries(inv.files.map((f) => [f.path, f.role]));
      expect(byPath).toEqual({
        "main.tf": "source",
        "prod.tfvars": "config",
        "live/terragrunt.hcl": "config",
      });
    });
  });

  it("leaves infrastructure.json content unchanged by inventorying .tf files", async () => {
    await touch("src/app.ts", 'export const q = "orders-intake-queue";\n');
    await touch(
      "infra/main.tf",
      'resource "aws_sqs_queue" "orders" {\n  name = "orders-intake-queue"\n}\n',
    );
    await touch("infra/variables.tf", '# orders-intake-queue is created in main.tf\nvariable "x" {}\n');

    const render = (paths: string[]): string =>
      toCanonicalJSON(toInfrastructureData(computeInfrastructure(dir, paths)));

    // Before: the inventory never held Terraform files.
    const before = render(["src/app.ts"]);

    const inv = await analyzeInventory(dir, { languageConfig: typescriptConfig });
    expect(inv.files.some((f) => f.path.endsWith(".tf"))).toBe(true);
    const after = render(inv.files.map((f) => f.path));

    expect(after).toBe(before);
    expect(after).toContain("orders-intake-queue");
    expect(JSON.parse(after).links.map((l: { target: string }) => l.target)).toEqual(["src/app.ts"]);
  });
});
