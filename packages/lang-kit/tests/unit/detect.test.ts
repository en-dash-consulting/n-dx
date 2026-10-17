/**
 * The detection seam: lang-kit reads no config and walks no tree, so the
 * override and the Terraform search arrive as options. These tests pin when
 * the search runs and with which configs, which is what keeps the skip set
 * the caller builds from them identical to the inventory's.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectLanguage,
  detectLanguages,
  goConfig,
  javaConfig,
  javaSecondaryConfig,
  terraformConfig,
  typescriptConfig,
  type LanguageConfig,
} from "../../src/index.js";

function recordingSearch(answer: boolean) {
  const calls: Array<readonly LanguageConfig[]> = [];
  return {
    calls,
    hasTerraformFile: async (others: readonly LanguageConfig[]) => {
      calls.push([...others]);
      return answer;
    },
  };
}

describe("lang-kit detection seam", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lang-kit-detect-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the override's config without searching for Terraform", async () => {
    const search = recordingSearch(true);
    expect(await detectLanguage(dir, { override: "go", ...search })).toBe(goConfig);
    expect(search.calls).toEqual([]);
  });

  it("falls through to markers on an unknown override", async () => {
    await writeFile(join(dir, "go.mod"), "module example.com/x\n");
    const search = recordingSearch(true);
    expect(await detectLanguage(dir, { override: "cobol", ...search })).toBe(goConfig);
    expect(search.calls).toEqual([]);
  });

  it("searches for Terraform as the TypeScript fallback when no marker matched", async () => {
    const yes = recordingSearch(true);
    expect(await detectLanguage(dir, yes)).toBe(terraformConfig);
    expect(yes.calls).toEqual([[typescriptConfig]]);

    const no = recordingSearch(false);
    expect(await detectLanguage(dir, no)).toBe(typescriptConfig);
  });

  it.each(["src/index.ts", "lib/app.rb"])("keeps TypeScript primary beside Terraform when %s is present", async (file) => {
    await mkdir(join(dir, dirname(file)), { recursive: true });
    await writeFile(join(dir, file), "\n");
    const one = recordingSearch(true);
    expect(await detectLanguage(dir, one)).toBe(typescriptConfig);
    expect(one.calls).toEqual([]);

    const all = recordingSearch(true);
    expect(await detectLanguages(dir, all)).toEqual([typescriptConfig, terraformConfig]);
    expect(all.calls).toEqual([[typescriptConfig]]);
  });

  it("does not count minified JavaScript as fallback source", async () => {
    await writeFile(join(dir, "vendor.min.js"), "\n");
    expect(await detectLanguage(dir, recordingSearch(true))).toBe(terraformConfig);
    expect(await detectLanguages(dir, recordingSearch(true))).toEqual([terraformConfig]);
  });

  it("lets a Java root outrank Terraform without searching", async () => {
    await writeFile(join(dir, "pom.xml"), "<project/>\n");
    const search = recordingSearch(true);
    expect(await detectLanguage(dir, search)).toBe(javaConfig);
    expect(search.calls).toEqual([]);
  });

  it("detectLanguages searches with the configs detected so far", async () => {
    await writeFile(join(dir, "package.json"), "{}\n");
    await writeFile(join(dir, "build.gradle"), "\n");
    const search = recordingSearch(true);
    expect(await detectLanguages(dir, search)).toEqual([typescriptConfig, javaSecondaryConfig, terraformConfig]);
    expect(search.calls).toEqual([[typescriptConfig, javaSecondaryConfig]]);
  });

  it("detectLanguages searches as Java on a Java-only root", async () => {
    await writeFile(join(dir, "pom.xml"), "<project/>\n");
    const search = recordingSearch(false);
    expect(await detectLanguages(dir, search)).toEqual([javaConfig]);
    expect(search.calls).toEqual([[javaConfig]]);
  });
});
