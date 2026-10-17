import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "@n-dx/llm-client";
import { detectLanguage, detectLanguages, getLanguageConfig, mergeLanguageConfigs } from "../../../src/language/detect.js";
import { terraformConfig, isTerraformFile, javaConfig, javaSecondaryConfig, typescriptConfig } from "@n-dx/lang-kit";
import { analyzeInventory, classifyRole, detectLanguage as inventoryLanguage } from "../../../src/analyzers/inventory.js";
import { computeInfrastructure, toInfrastructureData, isTerraformPath } from "../../../src/analyzers/infrastructure.js";

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

    it("detects a Terragrunt leaf deeper than three directories", async () => {
      await touch("live/root.hcl");
      await touch("live/prod/us-east-1/vpc/app/terragrunt.hcl");
      expect(await detectLanguages(dir)).toEqual([terraformConfig]);
      const inv = await analyzeInventory(dir, { languageConfig: terraformConfig });
      expect(inv.files.map((f) => f.path)).toEqual(["live/prod/us-east-1/vpc/app/terragrunt.hcl"]);
    });

    it("keeps the TypeScript fallback primary in a markerless repo with JS/TS and a deep .tf", async () => {
      await touch("src/a.js");
      await touch("src/a.test.js");
      await touch("src/types.d.ts");
      await touch("dist/bundle.js");
      await touch("deploy/envs/prod/eu/west/main.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      const configs = await detectLanguages(dir);
      expect(configs).toEqual([typescriptConfig, terraformConfig]);
      const inv = await analyzeInventory(dir, { languageConfig: mergeLanguageConfigs(configs) });
      expect(Object.fromEntries(inv.files.map((f) => [f.path, f.role]))).toEqual({
        "deploy/envs/prod/eu/west/main.tf": "config",
        "src/a.js": "source",
        "src/a.test.js": "test",
        "src/types.d.ts": "generated",
      });
    });

    it("keeps the TypeScript fallback for a markerless repo in a language with no config", async () => {
      await touch("lib/app.rb");
      await touch("tests/app_test.rb");
      await touch("deploy/envs/prod/eu/west/main.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      const configs = await detectLanguages(dir);
      expect(configs).toEqual([typescriptConfig, terraformConfig]);
      const inv = await analyzeInventory(dir, { languageConfig: mergeLanguageConfigs(configs) });
      expect(inv.files.find((f) => f.path === "tests/app_test.rb")?.role).toBe("test");
    });

    it("keeps the TypeScript fallback when the only source sits deeper than three levels", async () => {
      await touch("apps/web/src/components/X.tsx");
      await touch("infra/main.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      expect(await detectLanguages(dir)).toEqual([typescriptConfig, terraformConfig]);
    });

    it("does not count source the inventory ignores", async () => {
      await touch(".gitignore", "generated-site/\n");
      await touch("generated-site/app.js");
      await touch("dist/bundle.js");
      await touch("main.tf");
      expect(await detectLanguage(dir)).toBe(terraformConfig);
      expect(await detectLanguages(dir)).toEqual([terraformConfig]);
    });

    it("keeps the TypeScript fallback in a polyglot repo with more Terraform files than source", async () => {
      await touch("web/package.json", "{}");
      await touch("src/app.ts");
      await touch("src/app.test.ts");
      await touch("infra/main.tf");
      await touch("infra/variables.tf");
      await touch("infra/outputs.tf");
      await touch("infra/versions.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      const configs = await detectLanguages(dir);
      expect(configs).toEqual([typescriptConfig, terraformConfig]);
      const inv = await analyzeInventory(dir, { languageConfig: mergeLanguageConfigs(configs) });
      expect(inv.files.find((f) => f.path === "src/app.test.ts")?.role).toBe("test");
    });

    it("keeps the TypeScript fallback for one source file among many Terraform files", async () => {
      // cloud-foundation-fabric: 832 .tf files and one Cloud Function at depth 4.
      await touch("modules/api-gateway/recipe-multi-region/function/index.js");
      await touch("modules/api-gateway/main.tf");
      await touch("modules/api-gateway/variables.tf");
      expect(await detectLanguage(dir)).toBe(typescriptConfig);
      expect(await detectLanguages(dir)).toEqual([typescriptConfig, terraformConfig]);
    });

    it("stays Terraform alone with no fallback source", async () => {
      await touch("modules/network/main.tf");
      await touch("modules/network/variables.tf");
      await touch("live/prod.tfvars");
      expect(await detectLanguage(dir)).toBe(terraformConfig);
      expect(await detectLanguages(dir)).toEqual([terraformConfig]);
    });

    it("stays Terraform alone when the only other code is in a language that has a config", async () => {
      // terraform-aws-rds: 104 .tf files and one Python Lambda fixture.
      await touch("main.tf");
      await touch("examples/role-association-postgres/fixtures/lambda_function.py");
      expect(await detectLanguage(dir)).toBe(terraformConfig);
      expect(await detectLanguages(dir)).toEqual([terraformConfig]);
    });

    /** Detection says Terraform exactly when the analyze-phase inventory lists a Terraform file. */
    async function expectAgreement(expected: boolean): Promise<void> {
      const configs = await detectLanguages(dir);
      const inv = await analyzeInventory(dir, { languageConfig: mergeLanguageConfigs(configs) });
      expect(configs.includes(terraformConfig)).toBe(expected);
      expect(inv.files.some((f) => f.language === "Terraform")).toBe(expected);
    }

    it.each([
      "a/b/c/d/vendor/x/main.tf",
      "a/b/c/d/third_party/x/main.tf",
      "a/b/c/d/.terraform/modules/x/main.tf",
      "a/b/c/d/node_modules/x/main.tf",
      "a/b/c/d/dist/main.tf",
      "a/b/c/d/ignored/main.tf",
      "a/b/c/d/extra-skip/main.tf",
    ])("skips %s in detection and the inventory alike", async (rel) => {
      await touch("package.json", "{}");
      await touch(".gitignore", "ignored/\n");
      await touch(".n-dx.json", JSON.stringify({ sourcevision: { extraSkipDirs: ["extra-skip"] } }));
      await touch(rel);
      await expectAgreement(false);
    });

    it("searches the hidden directories the inventory walks", async () => {
      await touch("package.json", "{}");
      await touch(".infra/a/b/c/main.tf");
      await expectAgreement(true);
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
      "main.tf", "MAIN.TF", "prod.tfvars", "prod.TFVARS", "terragrunt.hcl", "Terragrunt.hcl", "plan.tftest.hcl", "PLAN.TFTEST.HCL",
      "main.tf.json", "prod.tfvars.json", "main.tf.bak", "foo.hcl", "tftest.hcl", "terragrunt.hcl.bak",
      "main.ts", "README.md",
    ];

    it.each(names)("inventory, detection and infrastructure agree on %s", async (name) => {
      await touch(name);
      const inventoried = inventoryLanguage(name) === "Terraform";
      expect(inventoried).toBe(isTerraformFile(name));
      expect(isTerraformPath(name)).toBe(inventoried);
      expect(isTerraformPath(`live/prod/${name}`)).toBe(inventoried);
      expect((await detectLanguages(dir)).includes(terraformConfig)).toBe(inventoried);
    });
  });

  describe("inventory roles", () => {
    const role = (p: string): string => classifyRole(p, "Terraform", terraformConfig);
    // A TypeScript repo containing Terraform: what inventory receives in practice.
    const tsWithTerraform = mergeLanguageConfigs([typescriptConfig, terraformConfig]);
    const tsRole = (p: string): string => classifyRole(p, "Terraform", tsWithTerraform);

    it("classifies Terraform outside a test path as config", () => {
      for (const r of [role, tsRole]) {
        expect(r("infra/main.tf")).toBe("config");
        expect(r("infra/prod.tfvars")).toBe("config");
        expect(r("live/prod/terragrunt.hcl")).toBe("config");
        expect(r("contest/main.tf")).toBe("config");
      }
    });

    it("keeps Terraform under a TypeScript test path in test quarantine", () => {
      expect(tsRole("tests/fixtures/infra/main.tf")).toBe("test");
      expect(tsRole("tests/fixtures/infra/prod.tfvars")).toBe("test");
      expect(tsRole("src/__tests__/terragrunt.hcl")).toBe("test");
      expect(tsRole("infra/tests/basic.tftest.hcl")).toBe("test");
    });

    it("does not make a file a test by Terraform's own patterns in a repo led by another language", () => {
      expect(tsRole("basic.tftest.hcl")).toBe("config");
      expect(tsRole("infra/basic.tftest.hcl")).toBe("config");
    });

    it("never applies Terraform's patterns to a file of another language", () => {
      for (const path of ["test/helpers.ts", "infra/tests/setup.ts", "src/app.ts"]) {
        expect(classifyRole(path, "TypeScript", tsWithTerraform)).toBe(classifyRole(path, "TypeScript", typescriptConfig));
      }
    });

    it("takes its own test paths in a Terraform-first repo (decision 8)", () => {
      expect(role("tests/fixtures/infra/main.tf")).toBe("test");
      expect(role("modules/db/test/main.tf")).toBe("test");
      expect(role("infra/tests/basic.tftest.hcl")).toBe("test");
      expect(role("basic.tftest.hcl")).toBe("test");
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
