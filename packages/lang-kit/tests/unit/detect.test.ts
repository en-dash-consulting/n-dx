/**
 * The detection seam: lang-kit reads no config and walks no tree, so the
 * override and the project file search arrive as options. These tests pin
 * when the search runs, with which configs and whether it counts, which is
 * what keeps the skip set the caller builds from them identical to the
 * inventory's, and how its counts decide a markerless repository.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectLanguage,
  detectLanguages,
  goConfig,
  isFallbackSourceFile,
  javaConfig,
  javaSecondaryConfig,
  terraformConfig,
  typescriptConfig,
  type LanguageConfig,
} from "../../src/index.js";

/** A search answering `terraform` Terraform files and `fallbackSource` fallback source files (when counting). */
function recordingSearch(terraform: number, fallbackSource = 0) {
  const calls: Array<{ others: readonly LanguageConfig[]; count: boolean }> = [];
  return {
    calls,
    searchProjectFiles: async (others: readonly LanguageConfig[], { count }: { count: boolean }) => {
      calls.push({ others: [...others], count });
      return count ? { terraform, fallbackSource } : { terraform: Math.min(terraform, 1), fallbackSource: 0 };
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
    const search = recordingSearch(1);
    expect(await detectLanguage(dir, { override: "go", ...search })).toBe(goConfig);
    expect(search.calls).toEqual([]);
  });

  it("falls through to markers on an unknown override", async () => {
    await writeFile(join(dir, "go.mod"), "module example.com/x\n");
    const search = recordingSearch(1);
    expect(await detectLanguage(dir, { override: "cobol", ...search })).toBe(goConfig);
    expect(search.calls).toEqual([]);
  });

  it("counts as the TypeScript fallback when no marker matched, then as Terraform alone", async () => {
    const yes = recordingSearch(1);
    expect(await detectLanguage(dir, yes)).toBe(terraformConfig);
    expect(yes.calls).toEqual([
      { others: [typescriptConfig], count: true },
      { others: [], count: true },
    ]);

    expect(await detectLanguage(dir, recordingSearch(0))).toBe(typescriptConfig);
    expect(await detectLanguages(dir, recordingSearch(0))).toEqual([typescriptConfig]);
  });

  it.each([
    ["a tie", 1, 1],
    ["more fallback source", 2, 5],
    ["more Terraform files", 3, 1],
    ["one source file among many Terraform files", 832, 1],
  ])("keeps TypeScript primary beside Terraform on %s", async (_, terraform, fallbackSource) => {
    expect(await detectLanguage(dir, recordingSearch(terraform, fallbackSource))).toBe(typescriptConfig);
    const all = recordingSearch(terraform, fallbackSource);
    expect(await detectLanguages(dir, all)).toEqual([typescriptConfig, terraformConfig]);
    expect(all.calls).toEqual([{ others: [typescriptConfig], count: true }]);
  });

  it("is Terraform alone only with no fallback source at all", async () => {
    expect(await detectLanguage(dir, recordingSearch(832, 0))).toBe(terraformConfig);
    expect(await detectLanguages(dir, recordingSearch(832, 0))).toEqual([terraformConfig]);
  });

  it("keeps the fallback when only Terraform's own skip set finds fallback source", async () => {
    // { main.tf, dist/handler.js }: the fallback skips dist/, Terraform alone does not.
    const search = async (others: readonly LanguageConfig[]) => ({ terraform: 1, fallbackSource: others.length === 0 ? 1 : 0 });
    expect(await detectLanguage(dir, { searchProjectFiles: search })).toBe(typescriptConfig);
    expect(await detectLanguages(dir, { searchProjectFiles: search })).toEqual([typescriptConfig, terraformConfig]);
  });

  it.each([
    ["src/index.ts", true],
    ["lib/app.rb", true],
    ["vendor.min.js", false],
    ["handler.py", false],
    ["main.tf", false],
  ])("counts %s as fallback source: %s", (file, expected) => {
    expect(isFallbackSourceFile(file)).toBe(expected);
  });

  it("lets a Java root outrank Terraform without searching", async () => {
    await writeFile(join(dir, "pom.xml"), "<project/>\n");
    const search = recordingSearch(1);
    expect(await detectLanguage(dir, search)).toBe(javaConfig);
    expect(search.calls).toEqual([]);
  });

  it("detectLanguages searches with the configs detected so far", async () => {
    await writeFile(join(dir, "package.json"), "{}\n");
    await writeFile(join(dir, "build.gradle"), "\n");
    const search = recordingSearch(1);
    expect(await detectLanguages(dir, search)).toEqual([typescriptConfig, javaSecondaryConfig, terraformConfig]);
    expect(search.calls).toEqual([{ others: [typescriptConfig, javaSecondaryConfig], count: false }]);
  });

  it("detectLanguages searches as Java on a Java-only root, without counting", async () => {
    await writeFile(join(dir, "pom.xml"), "<project/>\n");
    expect(await detectLanguages(dir, recordingSearch(0))).toEqual([javaConfig]);
    const search = recordingSearch(3, 0);
    expect(await detectLanguages(dir, search)).toEqual([javaConfig, terraformConfig]);
    expect(search.calls).toEqual([{ others: [javaConfig], count: false }]);
  });
});
