/**
 * Schema barrel — re-exports types and constants from v1.ts.
 *
 * Validation schemas (Zod) are intentionally NOT re-exported here.
 * Import directly from `./validate.js` when validation is needed.
 * This avoids forcing a transitive Zod dependency on every consumer
 * that only needs type definitions and domain constants.
 *
 * @see ./v1.ts       — canonical type definitions and domain constants
 * @see ./validate.ts — Zod schemas and validation functions (import directly)
 */

export {
  SCHEMA_VERSION,
  LEVEL_HIERARCHY,
  PRIORITY_ORDER,
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
} from "./v1.js";

export type {
  ItemLevel,
  ItemStatus,
  Priority,
  RequirementCategory,
  RequirementValidationType,
  Requirement,
  DuplicateOverrideMarker,
  MergedProposalRecord,
  PRDItem,
  PRDDocument,
  RexConfig,
  FacetDefinition,
  BudgetThresholds,
  LoEConfig,
  LogEntry,
  TokenUsage,
  AnalyzeTokenUsage,
} from "./v1.js";

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
} from "./levels.js";
export type { LevelDisplay } from "./levels.js";
