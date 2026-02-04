export type { ScanResult, ScanOptions } from "./scanners.js";
export { scanTests, scanDocs, scanSourceVision } from "./scanners.js";

export type { ReconcileStats } from "./reconcile.js";
export { reconcile } from "./reconcile.js";

export type { Proposal, ProposalFeature, ProposalTask } from "./propose.js";
export { buildProposals } from "./propose.js";

export { similarity, deduplicateScanResults } from "./dedupe.js";

export { formatDiff } from "./diff.js";

export type { FileFormat, AddPromptOptions } from "./reason.js";
export {
  DEFAULT_MODEL,
  CHUNK_CHAR_LIMIT,
  reasonFromFile,
  reasonFromFiles,
  reasonFromScanResults,
  reasonFromDescription,
  readProjectContext,
  parseProposalResponse,
  buildAddPrompt,
  detectFileFormat,
  parseStructuredFile,
  mergeProposals,
  chunkScanResults,
  summarizeScanResults,
} from "./reason.js";
