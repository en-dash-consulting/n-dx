import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "@n-dx/llm-client";
import { detectLanguage, detectLanguages, getLanguageConfig, mergeLanguageConfigs } from "../../../src/language/detect.js";
import { terraformConfig, isTerraformFile } from "../../../src/language/terraform.js";
import { javaConfig, javaSecondaryConfig } from "../../../src/language/java.js";
import { typescriptConfig } from "../../../src/language/typescript.js";
import { analyzeInventory, classifyRole, detectLanguage as inventoryLanguage } from "../../../src/analyzers/inventory.js";
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

    it("leaves repositories without any Terraform file unchanged", async () => {
      await touch("package.json", "{}");
      await touch("main.hcl");
      expect(await detectLanguages(dir)).toEqual([typescriptConfig]);
    });

    it("detects a Terragrunt-only repository the same way the inventory sees it", async () => {
      await touch("live/prod/terragrunt.hcl");
      await touch("live/prod/prod.tfvars");
      expect(await detectLanguage(dir)).toBe(terraformConfig);
      expect(await detectLanguages(dir)).toEqual([terraformConfig]);
      const inv = await analyzeInventory(dir, { languageConfig: terraformConfig });
      expect(inv.files.map((f) => f.path).sort()).toEqual(["live/prod/prod.tfvars", "live/prod/terragrunt.hcl"]);
    });

    it.each(["live/prod.tfvars", "live/terragrunt.hcl", "live/x.tftest.hcl"])(
      "counts %s as a Terraform marker",
      async (rel) => {
        await touch(rel);
        expect(await detectLanguages(dir)).toEqual([terraformConfig]);
      },
    );
  });

  describe("one Terraform file set", () => {
    const names = [
      "main.tf", "MAIN.TF", "prod.tfvars", "terragrunt.hcl", "Terragrunt.hcl", "plan.tftest.hcl",
      "main.tf.json", "prod.tfvars.json", "main.tf.bak", "foo.hcl", "tftest.hcl", "terragrunt.hcl.bak",
      "main.ts", "README.md",
    ];

    it.each(names)("inventory and detection agree on %s", async (name) => {
      await touch(name);
      const inventoried = inventoryLanguage(name) === "Terraform";
      expect(inventoried).toBe(isTerraformFile(name));
      expect((await detectLanguages(dir)).includes(terraformConfig)).toBe(inventoried);
    });
  });

  describe("inventory roles", () => {
    const role = (p: string): string => classifyRole(p, "Terraform", terraformConfig);
    // A TypeScript repo containing Terraform: what inventory receives in practice.
    const tsWithTerraform = mergeLanguageConfigs([typescriptConfig, terraformConfig]);
    const tsRole = (p: string): string => classifyRole(p, "Terraform", tsWithTerraform);

    it("classifies Terraform outside a test path as config until the structure model lands", () => {
      for (const r of [role, tsRole]) {
        expect(r("infra/main.tf")).toBe("config");
        expect(r("infra/prod.tfvars")).toBe("config");
        expect(r("live/prod/terragrunt.hcl")).toBe("config");
      }
    });

    it("keeps Terraform under a TypeScript test path in test quarantine", () => {
      expect(tsRole("tests/fixtures/infra/main.tf")).toBe("test");
      expect(tsRole("tests/fixtures/infra/prod.tfvars")).toBe("test");
      expect(tsRole("src/__tests__/terragrunt.hcl")).toBe("test");
      expect(tsRole("infra/tests/basic.tftest.hcl")).toBe("test");
    });

    it("does not make a file a test by Terraform's own .tftest.hcl pattern", () => {
      expect(role("basic.tftest.hcl")).toBe("config");
      expect(tsRole("basic.tftest.hcl")).toBe("config");
      expect(tsRole("infra/basic.tftest.hcl")).toBe("config");
    });

    it("has no test path of its own in a Terraform-primary repo", () => {
      expect(role("tests/fixtures/infra/main.tf")).toBe("config");
      expect(role("infra/tests/basic.tftest.hcl")).toBe("config");
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
        "main.tf": "config",
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
