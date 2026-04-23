/**
 * Public API for the rex package.
 *
 * ## API philosophy: runtime functions + types
 *
 * Rex is consumed as a **library** by hench (via `prd/ops.ts` gateway).
 * This public API therefore exports runtime functions for store access,
 * tree manipulation, and task selection — everything hench needs to
 * manage PRD state programmatically.
 *
 * Each package's public surface reflects its actual consumption pattern —
 * see PACKAGE_GUIDELINES.md for the full decision tree and comparison table.
 *
 * ## Configuration
 *
 * `DEFAULT_CONFIG(project)` is exported for consumers that need to generate
 * default Rex configurations programmatically (e.g., init scripts, tooling).
 * Note it requires a project name parameter.
 *
 * ## Architectural isolation
 *
 * Rex depends only on `@n-dx/llm-client` (the shared foundation)
 * and has **no dependency on hench or sourcevision**. This strict
 * one-way dependency ensures the monorepo's DAG remains acyclic:
 *
 * ```
 *   hench → rex → claude-client ← sourcevision
 * ```
 *
 * ## Cross-package imports
 *
 * Hench uses `import type { PRDStore, PRDItem, ... } from "rex"` for
 * compile-time type safety. These `import type` statements are erased
 * during compilation and create zero runtime coupling — the packages
 * remain independently deployable.
 *
 * Runtime imports from rex are funnelled through a single gateway module
 * (`hench/src/prd/ops.ts`) to keep the cross-package surface explicit
 * and auditable.
 *
 * Validation functions (Zod schemas) are NOT exported here. Consumers
 * that need runtime validation should import directly from
 * `rex/src/schema/validate.js` to avoid forcing Zod as a transitive
 * dependency on type-only consumers.
 *
 * @module rex/public
 */

// ---- Store ------------------------------------------------------------------

export { resolveStore, PRD_FILENAME } from "./store/index.js";
export type { PRDStore } from "./store/contracts.js";

// ---- Store: git branch helpers ---------------------------------------------

export {
  sanitizeBranchName,
  resolveGitBranch,
  getFirstCommitDate,
} from "./store/branch-naming.js";

// ---- Store: legacy PRD migration -------------------------------------------

export { migrateLegacyPRD } from "./store/prd-migration.js";
export type { MigrationResult } from "./store/prd-migration.js";

// ---- Integration schema system ----------------------------------------------

export {
  validateField,
  validateConfig,
  registerIntegrationSchema,
  getIntegrationSchema,
  listIntegrationSchemas,
  toAdapterConfigSchema,
} from "./store/integration-schema.js";
export type {
  FieldInputType,
  FieldValidationRule,
  FieldSelectOption,
  IntegrationFieldSchema,
  IntegrationSchema,
  IntegrationFieldGroup,
  FieldValidationResult,
} from "./store/integration-schema.js";
export {
  registerBuiltInSchemas,
  ensureSchemas,
} from "./store/integration-schemas/index.js";
export { notionIntegrationSchema } from "./store/integration-schemas/notion.js";
export { jiraIntegrationSchema } from "./store/integration-schemas/jira.js";

// ---- Schema types & constants -----------------------------------------------

export type {
  PRDItem, PRDDocument, ItemLevel, ItemStatus, Priority, ResolutionType, RexConfig,
  RequirementCategory, RequirementValidationType, Requirement,
  FacetDefinition, LoEConfig, ActiveInterval,
} from "./schema/v1.js";
export {
  SCHEMA_VERSION,
  isCompatibleSchema,
  assertSchemaVersion,
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  CHILD_LEVEL,
  LOE_DEFAULTS,
  isPriority,
  isItemLevel,
  isItemStatus,
  isRequirementCategory,
  isValidationType,
  DEFAULT_CONFIG,
} from "./schema/v1.js";

// ---- Schema: level helpers --------------------------------------------------

export type { LevelDisplay } from "./schema/levels.js";
export {
  isRootLevel,
  isWorkItem,
  isContainerLevel,
  isLeafLevel,
  isValidLevel,
  getLevelLabel,
  getLevelPlural,
  getLevelEmoji,
  getLevelDisplayMap,
  getChildLevel,
  getParentLevels,
  getAllLevels,
  getWorkItemLevels,
  getContainerLevels,
  formatLevelSummary,
  setLevelDisplay,
  resetLevelDisplay,
} from "./schema/levels.js";

// ---- Core: tree utilities ---------------------------------------------------

export {
  findItem, walkTree, collectAllIds,
  insertChild, updateInTree, removeFromTree,
} from "./core/tree.js";
export type { TreeEntry } from "./core/tree.js";

// ---- Core: stats ------------------------------------------------------------

export { computeStats } from "./core/stats.js";
export type { TreeStats } from "./core/stats.js";

// ---- Core: deletion ---------------------------------------------------------

export { deleteItem, cleanBlockedByRefs } from "./core/delete.js";
export { removeEpic } from "./core/remove-epic.js";
export type { RemoveEpicResult } from "./core/remove-epic.js";
export { removeTask } from "./core/remove-task.js";
export type { RemoveTaskResult, ParentAutoCompletion } from "./core/remove-task.js";
export { preCheckFeatureDeletion, removeFeature } from "./core/remove-feature.js";
export type {
  DeletionPreCheck, RemoveFeatureResult,
  ExternalDependent, SyncedItem,
} from "./core/remove-feature.js";

// ---- Core: task selection ---------------------------------------------------

export {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  explainSelection,
  extractTaskKeywords,
  matchTasksByKeywords,
  requirementsScore,
} from "./core/next-task.js";
export type { SelectionExplanation, TaskMatch, PrioritizationOptions, RiskTolerance } from "./core/next-task.js";

// ---- Core: keywords ---------------------------------------------------------

export { extractKeywords, scoreMatch } from "./core/keywords.js";

// ---- Core: fix (structural auto-repair) -------------------------------------

export {
  detectIssues,
  applyFixes,
  detectTimestampIssues,
  detectOrphanBlockedBy,
  detectParentChildMisalignment,
} from "./fix/index.js";
export type { FixKind, FixAction, FixResult } from "./fix/index.js";

// ---- Core: verify (acceptance criteria → test file mapping) -----------------

export {
  verify,
  findTestFiles,
  mapCriteriaToTests,
  collectVerifiableTasks,
} from "./core/verify.js";
export type {
  CriterionResult,
  TaskVerification,
  TestRunResult,
  VerifyResult,
  VerifyOptions,
} from "./core/verify.js";

// ---- Core: timestamps -------------------------------------------------------

export { computeTimestampUpdates } from "./core/timestamps.js";
export type { TimestampUpdates } from "./core/timestamps.js";

// ---- Core: durations --------------------------------------------------------

export { getTaskDuration } from "./core/durations.js";
export type { TaskDuration } from "./core/durations.js";

// ---- Core: parent auto-completion -------------------------------------------

export { findAutoCompletions } from "./core/parent-completion.js";

// ---- Core: parent status reset ----------------------------------------------

export { findParentResets, cascadeParentReset } from "./core/parent-reset.js";

// ---- Core: requirements -----------------------------------------------------

export {
  collectRequirements,
  collectRequirementsByCategory,
  collectRequirementsByValidationType,
  validateRequirements,
  validateAutomatedRequirements,
  formatRequirementsValidation,
  buildTraceabilityMatrix,
} from "./core/requirements.js";
export type {
  TracedRequirement,
  RequirementValidationResult,
  RequirementsValidationSummary,
  CommandExecutor,
} from "./core/requirements.js";

// ---- Core: merge/consolidation ----------------------------------------------

export { validateMerge, previewMerge, mergeItems } from "./core/merge.js";
export type { MergeOptions, MergeValidation, MergePreview, MergeResult } from "./core/merge.js";

// ---- Core: prune ------------------------------------------------------------

export {
  countSubtree, isFullyCompleted,
  findPrunableItems, pruneItems,
} from "./core/prune.js";
export type { PruneResult } from "./core/prune.js";

// ---- Core: reorganize -------------------------------------------------------

export {
  detectReorganizations,
  formatReorganizationPlan,
} from "./core/reorganize.js";
export type {
  ProposalType, RiskLevel,
  ReorganizationProposal, ReorganizationPlan,
  ProposalDetail, MergeDetail, MoveDetail, SplitDetail,
  DeleteDetail, PruneDetail, CollapseDetail,
  DetectorOptions,
} from "./core/reorganize.js";

export {
  applyProposals,
  formatApplyResult,
} from "./core/reorganize-executor.js";
export type { ApplyResult, ProposalResult } from "./core/reorganize-executor.js";

// ---- Core: reshape ----------------------------------------------------------

export { applyReshape } from "./core/reshape.js";
export type { ReshapeProposal, ReshapeAction, ReshapeResult } from "./core/reshape.js";

// ---- Analyze: reshape-reason ------------------------------------------------

export { reasonForReshape, formatReshapeProposal } from "./analyze/reshape-reason.js";
export type { ReshapeReasonOptions, ReshapeReasonResult } from "./analyze/reshape-reason.js";

// ---- Core: health -----------------------------------------------------------

export {
  computeHealthScore,
  formatHealthScore,
} from "./core/health.js";
export type {
  StructureHealthScore, HealthDimensions, HealthOptions,
} from "./core/health.js";

// ---- Core: analytics --------------------------------------------------------

export {
  computeEpicStats, computePriorityDistribution,
  computeRequirementsSummary,
} from "./core/analytics.js";
export type {
  EpicStats, PriorityDistribution, RequirementsSummary,
} from "./core/analytics.js";

// ---- Core: per-item token rollup --------------------------------------------

export {
  aggregateItemTokenUsage,
  readRunTokensFromHench,
} from "./core/item-token-rollup.js";
export type {
  ItemTokenTuple,
  ItemRunTokens,
  ItemTokenTotals,
  ItemTokenAggregation,
} from "./core/item-token-rollup.js";

// ---- Analyze: finding acknowledgment ----------------------------------------

export {
  computeFindingHash, loadAcknowledged, saveAcknowledged,
  acknowledgeFinding, isAcknowledged, isAcknowledgedFuzzy,
} from "./analyze/acknowledge.js";
export type { AcknowledgedFinding, AcknowledgedStore } from "./analyze/acknowledge.js";

// ---- Recommend: PRD creation from recommendations ---------------------------

export { createItemsFromRecommendations } from "./recommend/create-from-recommendations.js";
export type {
  EnrichedRecommendation, RecommendationMeta, CreationResult,
  SkippedRecommendation, UpdatedRecommendation, ReparentedRecommendation,
} from "./recommend/create-from-recommendations.js";

// ---- Core: facets -----------------------------------------------------------

export {
  isFacetTag,
  parseFacetTag,
  getFacetValue,
  setFacetValue,
  removeFacet,
  getItemFacets,
  getItemsByFacet,
  groupByFacet,
  suggestFacets,
  computeFacetDistribution,
} from "./core/facets.js";
export type { FacetConfig, FacetSuggestion } from "./core/facets.js";

// ---- Core: scope creep detection --------------------------------------------

export {
  detectScopeCreep,
  setInitialChildCount,
} from "./core/scope-creep.js";
export type { ScopeCreepResult } from "./core/scope-creep.js";

// ---- Core: code coverage cross-reference ------------------------------------

export { crossReferenceChanges } from "./core/code-coverage.js";
export type {
  AffectedTask, UncoveredChange, CrossReferenceResult,
} from "./core/code-coverage.js";

// ---- Analyze: LoE decomposition ---------------------------------------------

export type { DecomposedTask, DecompositionResult } from "./analyze/decompose.js";
export { applyDecompositionPass, buildDecompositionPrompt } from "./analyze/decompose.js";

// ---- Analyze: proposal types ------------------------------------------------

export type { Proposal, ProposalEpic, ProposalFeature, ProposalTask } from "./analyze/propose.js";

// ---- Analyze: consolidation guard -------------------------------------------

export type { ConsolidationGuardResult } from "./analyze/consolidation-guard.js";
export { countProposalTasks, buildConsolidationGuardPrompt, applyConsolidationGuard } from "./analyze/consolidation-guard.js";

// ---- Analyze: structured extraction -----------------------------------------

export {
  extractFromMarkdown,
  extractFromText,
  extractFromFile,
  classifyHeadingLevels,
  isAmbiguousStructure,
  maybeDisambiguate,
} from "./analyze/extract.js";
export type { ExtractionOptions, ExtractionResult } from "./analyze/extract.js";

// ---- Analyze: file validation -----------------------------------------------

export {
  validateFileInput,
  validateMarkdownContent,
  validateTextContent,
  validateJsonContent,
  validateYamlContent,
  detectMagicBytes,
  FileValidationError,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  LARGE_FILE_WARNING_BYTES,
} from "./analyze/file-validation.js";
export type {
  FileValidationResult,
  MarkdownValidationResult,
  TextValidationResult,
  JsonValidationResult,
  YamlValidationResult,
  FileValidationErrorCode,
} from "./analyze/file-validation.js";

// ---- MCP server factory -----------------------------------------------------

export { createRexMcpServer } from "./cli/mcp.js";

// ---- MCP tool handlers (for direct invocation by web/gateway) ---------------

export { handleEditItem } from "./cli/mcp-tools.js";
