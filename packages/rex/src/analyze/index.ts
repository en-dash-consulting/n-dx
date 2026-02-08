export type { ScanResult, ScanOptions } from "./scanners.js";
export { scanTests, scanDocs, scanSourceVision, scanPackageJson } from "./scanners.js";

export type { ReconcileStats } from "./reconcile.js";
export { reconcile } from "./reconcile.js";

export type { Proposal, ProposalFeature, ProposalTask } from "./propose.js";
export { buildProposals } from "./propose.js";

export { similarity, deduplicateScanResults } from "./dedupe.js";

export { formatDiff } from "./diff.js";

export type { FileFormat, AddPromptOptions, QualityIssue, ClaudeResult, ReasonResult, GranularityAssessment, GranularityAssessmentResult } from "./reason.js";
export {
  DEFAULT_MODEL,
  MAX_RETRIES,
  setClaudeConfig,
  setClaudeClient,
  getAuthMode,
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
  chunkScanResults,
  summarizeScanResults,
  estimateItemSize,
  groupScanResults,
} from "./reason.js";

export type { GuidedContext, ClarifyResponse } from "./guided.js";
export { runGuidedSpec, clarify, generateSpecFromContext } from "./guided.js";
