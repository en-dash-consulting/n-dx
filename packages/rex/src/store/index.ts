export type { PRDStore, StoreCapabilities } from "./contracts.js";
export { FileStore, ensureRexDir, PRD_FILENAME } from "./file-adapter.js";
export {
  PRD_CACHE_DIRNAME,
  PRD_TREE_DIRNAME,
  TREE_META_FILENAME,
  prdLockPath,
  resolveRexPaths,
} from "./paths.js";
export type { RexPaths } from "./paths.js";
export {
  sanitizeBranchName,
  resolveGitBranch,
  getFirstCommitDate,
  generatePRDFilename,
  resolvePRDFilename,
} from "./branch-naming.js";
export {
  discoverPRDFiles,
  parsePRDBranchSegment,
  parsePRDFileDate,
  findPRDFileForBranch,
  resolvePRDFile,
} from "./prd-discovery.js";
export type { PRDFileResolution } from "./prd-discovery.js";
export { migrateLegacyPRD } from "./prd-migration.js";
export type { MigrationResult } from "./prd-migration.js";
export {
  migrateJsonPrdToMarkdown,
  PRD_MARKDOWN_FILENAME,
  PRDMarkdownMigrationError,
  jsonToMarkdownFilename,
  toMarkdownSourcePath,
  CANONICAL_MARKDOWN_SOURCE_PATH,
} from "./prd-md-migration.js";
export type { MarkdownMigrationResult } from "./prd-md-migration.js";
export { serializeDocument } from "./markdown-serializer.js";
export {
  serializeFolderTree,
  slugify,
  slugifyTitle,
  resolveSiblingSlugs,
} from "./folder-tree-serializer.js";
export { findNonConformingSlugs, findTreeIdentityFaults, SLUG_RULE_VERSION } from "./folder-tree-serializer.js";
export { assertSlugRuleWritable, assertSlugRuleAdoptable, checkTreeConformance, readSlugRuleMarker, SlugRuleMismatchError, SLUG_RULE_MARKER_MISSING } from "./slug-rule-guard.js";
export type { TreeConformanceRefusal } from "./slug-rule-guard.js";
export type { SlugMismatch } from "./folder-tree-serializer.js";
export type { SerializeResult } from "./folder-tree-serializer.js";
export { parseFolderTree } from "./folder-tree-parser.js";
export { treeMetaContents, parseTreeMeta } from "./tree-meta.js";
export type { TreeMeta } from "./tree-meta.js";
export type { FolderParseResult, ParseWarning } from "./folder-tree-parser.js";
export {
  SELF_HEAL_TAG,
  SELF_HEAL_ENV_VAR,
  isSelfHealRun,
  withSelfHealTag,
} from "./self-heal-tag.js";
export { withLock, acquireLock } from "./file-lock.js";
export { readPerfFlags, clearPerfFlagCache } from "./perf-flags.js";
export type { RexPerfFlags } from "./perf-flags.js";
export { openClaimsStore, claimsStorePath, resolveClaimHolder } from "./claims.js";
export type { ClaimsStore, ClaimHolder, TaskClaim, PendingCompletion } from "./claims.js";
export {
  ensureLegacyPrdMigrated,
  LegacyPrdMigrationError,
} from "./ensure-legacy-prd-migrated.js";
export type { LegacyPrdMigrationResult } from "./ensure-legacy-prd-migrated.js";

import { FileStore, PRD_FILENAME } from "./file-adapter.js";
import { dirname } from "node:path";
import { resolveGitBranch } from "./branch-naming.js";
import { findPRDFileForBranch } from "./prd-discovery.js";
import { PRD_MARKDOWN_FILENAME } from "./prd-md-migration.js";
import type { PRDStore } from "./contracts.js";

/**
 * The only store backend rex has.
 *
 * Kept as a named constant rather than inlined so the one place that still
 * takes a backend name has something to compare against.
 */
const FILE_ADAPTER = "file";

/**
 * Create a PRDStore for the given backend name.
 *
 * `"file"` is the only backend. The parameter survives the removal of the
 * Notion, Jira, Asana and GitHub Projects adapters because callers across rex
 * and hench pass it explicitly, and a name that is silently ignored is worse
 * than one that is checked — a caller asking for a backend that no longer
 * exists should hear so rather than quietly get the local store.
 *
 * @throws If `adapter` is anything other than `"file"`.
 */
export function createStore(adapter: string, rexDir: string): PRDStore {
  if (adapter !== FILE_ADAPTER) {
    throw new Error(
      `Unknown store adapter "${adapter}". The only adapter is "${FILE_ADAPTER}".`,
    );
  }
  return new FileStore(rexDir);
}

/**
 * Resolve the local PRDStore for a `.rex/` directory.
 *
 * Always returns a FileStore. Reads aggregate all branch-scoped PRD files
 * (`prd_{branch}_{date}.json`) plus `prd.json` into one in-memory document.
 * On first load after the markdown-storage upgrade, `prd.md` is generated from
 * `prd.json` when the markdown file is missing. When a branch-scoped file
 * already exists for the current git branch, new root-level items are routed
 * there; otherwise they go to `prd.json`.
 *
 * CLI commands that write new root items should call {@link resolvePRDFile}
 * before writing to ensure the branch file exists and the store targets it.
 *
 * @param rexDir  Path to the rex state directory. Resolve it with
 *                {@link resolveRexPaths} rather than joining a directory name
 *                to the project root — where it lives depends on the layout.
 * @returns A FileStore instance.
 *
 * @example
 * ```ts
 * const store = await resolveStore(resolveRexPaths(dir).rexDir);
 * const doc = await store.loadDocument();
 * ```
 */
export async function resolveStore(rexDir: string): Promise<PRDStore> {
  const projectDir = dirname(rexDir);
  const branch = resolveGitBranch(projectDir);
  const currentBranchFile = await findPRDFileForBranch(rexDir, branch);
  return new FileStore(rexDir, {
    currentBranchFile: currentBranchFile ?? PRD_FILENAME,
  });
}
