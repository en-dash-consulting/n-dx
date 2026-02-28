export type { ScanResult, ScanOptions } from "./scanners.js";
export { scanTests, scanDocs, scanSourceVision, scanPackageJson } from "./scanners.js";

export type { ReconcileStats, UpdateCandidate, ReconcileOptions } from "./reconcile.js";
export { reconcile } from "./reconcile.js";

export type {
  Proposal,
  ProposalEpic,
  ProposalFeature,
  ProposalTask,
  DuplicateReasonType,
  DuplicateReasonReference,
  DuplicateReasonMetadata,
} from "./propose.js";
export { buildProposals } from "./propose.js";

export { similarity, deduplicateScanResults } from "./dedupe.js";

export { formatDiff } from "./diff.js";

export type { FileFormat, AddPromptOptions, QualityIssue, ClaudeResult, ReasonResult, GranularityAssessment, GranularityAssessmentResult, BatchImportItem, BatchImportResult } from "./reason.js";
export {
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
  MAX_RETRIES,
  setLLMConfig,
  setClaudeConfig,
  setClaudeClient,
  getAuthMode,
  getLLMVendor,
  CHUNK_CHAR_LIMIT,
  CHUNK_ITEM_LIMIT,
  FEW_SHOT_EXAMPLE,
  spawnClaude,
  reasonFromFile,
  reasonFromFiles,
  reasonFromScanResults,
  reasonFromDescription,
  reasonFromDescriptions,
  reasonFromIdeasFile,
  buildIdeasPrompt,
  readProjectContext,
  parseProposalResponse,
  parseTokenUsage,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
  extractJson,
  repairTruncatedJson,
  validateProposalQuality,
  buildAddPrompt,
  buildMultiAddPrompt,
  buildBreakdownPrompt,
  buildConsolidatePrompt,
  adjustGranularity,
  buildAssessmentPrompt,
  parseAssessmentResponse,
  formatAssessment,
  assessGranularity,
  detectFileFormat,
  parseStructuredFile,
  mergeProposals,
  reasonFromBatch,
  chunkScanResults,
  summarizeScanResults,
  estimateItemSize,
  groupScanResults,
} from "./reason.js";

export type { GuidedContext, ClarifyResponse } from "./guided.js";
export { runGuidedSpec, clarify, generateSpecFromContext } from "./guided.js";

export type { ReshapeReasonOptions, ReshapeReasonResult } from "./reshape-reason.js";
export { reasonForReshape, parseReshapeResponse, formatReshapeProposal } from "./reshape-reason.js";

export type { ModifyProposalOptions, ModifyProposalResult } from "./modify-reason.js";
export { buildModifyPrompt, modifyProposals } from "./modify-reason.js";

export type { ValidationResult, ClassificationResult } from "./validate-modification.js";
export { validateModificationRequest, classifyModificationRequest } from "./validate-modification.js";
