/**
 * Language auto-detection, as sourcevision runs it.
 *
 * The detection chain itself is `@n-dx/lang-kit`'s, which reads no config and
 * walks no tree. This layer supplies both: the project config's `language`
 * override (read through the layout resolver) and the project file search
 * (the inventory's own walk). The pure names are re-exported so
 * existing importers keep one module to reach for.
 *
 * @module sourcevision/language/detect
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
import {
  detectLanguage as detectLanguageWith,
  detectLanguages as detectLanguagesWith,
  isFallbackSourceFile,
  isTerraformFile,
  mergeLanguageConfigs as mergeLanguageConfigsWith,
  terraformConfig,
  type LanguageConfig,
  type ProjectFileCounts,
} from "@n-dx/lang-kit";
import { loadIgnoreFilter, projectSkip, walkProjectFiles } from "../util/project-walk.js";

export { getLanguageConfig, languageConfigsFromIds, mergeLanguageConfigs, VALID_LANGUAGE_IDS } from "@n-dx/lang-kit";

/**
 * lang-kit's project file search, run as the inventory's own walk: the same
 * skipped directories (base, vendored, `otherConfigs`' and Terraform's
 * `skipDirectories` and `skipUnlessContains`, the user's `extraSkipDirs`) and
 * the same `.gitignore` / `.sourcevisionignore` filter, at any depth.
 * `otherConfigs` are the languages detected without Terraform, so when
 * Terraform is added beside them the skip set equals the one the
 * analyze-phase inventory uses with the result, and the files counted are
 * the files it lists. When Terraform is detected alone (a markerless
 * repository with no fallback source) it does not: the search also
 * skipped the fallback's directories (`dist`, `build`, `coverage`, …), so a
 * file found only there is not counted. Without `count`, stops at the first
 * Terraform file.
 */
async function searchProjectFiles(
  rootDir: string,
  otherConfigs: readonly LanguageConfig[],
  { count }: { count: boolean },
): Promise<ProjectFileCounts> {
  const { extraSkipDirs } = await loadInventoryConfig(rootDir);
  const skip = projectSkip(mergeLanguageConfigsWith([...otherConfigs, terraformConfig]), extraSkipDirs);
  const ig = await loadIgnoreFilter(rootDir);
  const counts: ProjectFileCounts = { terraform: 0, fallbackSource: 0 };
  try {
    for await (const relPath of walkProjectFiles(rootDir, rootDir, ig, skip)) {
      const name = basename(relPath);
      if (isTerraformFile(name)) {
        counts.terraform++;
        if (!count) break;
      } else if (count && isFallbackSourceFile(name)) {
        counts.fallbackSource++;
      }
    }
  } catch {
    // Unreadable root — what was counted stands, as for the other languages' checks.
  }
  return counts;
}

/**
 * Read the project config’s `language` override, if present.
 *
 * The path comes from the layout resolver, not a `.n-dx.json` literal: on a
 * project with `.ndx/` the file is `.ndx/config.json`, and reading the legacy
 * name there just misses — the override is ignored with no error, and the
 * project is auto-detected as if it had never set one.
 *
 * Returns the language id string or `undefined` if not set.
 */
async function readConfigOverride(rootDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(resolveLayout(rootDir).configFile, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.language === "string" && config.language !== "auto") {
      return config.language;
    }
  } catch {
    // File doesn't exist or is invalid — no override
  }
  return undefined;
}

/** Inventory-related overrides read from the `.n-dx.json` `sourcevision` key. */
export interface InventoryConfigOverride {
  /** Restrict the inventory to program-code files only (default true). */
  codeOnly?: boolean;
  /** Extra file extensions to always include when `codeOnly` is true (lower-cased, leading dot). */
  extraExtensions?: string[];
  /** Extra directory names to skip during the inventory walk. */
  extraSkipDirs?: string[];
  /** Language pack ids the project wants (`sourcevision.packs`); reported on, never changes what is analysed. */
  packs?: string[];
}

/**
 * Read inventory-related overrides from `.n-dx.json` under the `sourcevision`
 * key. Returns an empty object when the file or key is absent/invalid, so the
 * caller applies its own defaults (notably `codeOnly` defaults to true).
 */
export async function loadInventoryConfig(rootDir: string): Promise<InventoryConfigOverride> {
  try {
    const raw = await readFile(resolveLayout(rootDir).configFile, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const sv = config.sourcevision;
    if (!sv || typeof sv !== "object") return {};
    const s = sv as Record<string, unknown>;
    const out: InventoryConfigOverride = {};
    if (typeof s.codeOnly === "boolean") out.codeOnly = s.codeOnly;
    if (Array.isArray(s.extraExtensions)) {
      out.extraExtensions = s.extraExtensions.filter((e): e is string => typeof e === "string");
    }
    if (Array.isArray(s.extraSkipDirs)) {
      out.extraSkipDirs = s.extraSkipDirs.filter((e): e is string => typeof e === "string");
    }
    if (Array.isArray(s.packs)) {
      out.packs = s.packs.filter((e): e is string => typeof e === "string");
    }
    return out;
  } catch {
    // File doesn't exist or is invalid — use defaults
    return {};
  }
}

/**
 * Detect the primary project language: the config override first, then
 * `@n-dx/lang-kit`'s marker chain with the walk-backed project file search.
 */
export async function detectLanguage(rootDir: string): Promise<LanguageConfig> {
  const override = await readConfigOverride(rootDir);
  return detectLanguageWith(rootDir, {
    override,
    searchProjectFiles: (otherConfigs, options) => searchProjectFiles(rootDir, otherConfigs, options),
  });
}

/**
 * Detect ALL languages present in a project, primary first. Ignores the
 * config override, as it always has.
 */
export async function detectLanguages(rootDir: string): Promise<LanguageConfig[]> {
  return detectLanguagesWith(rootDir, {
    searchProjectFiles: (otherConfigs, options) => searchProjectFiles(rootDir, otherConfigs, options),
  });
}
