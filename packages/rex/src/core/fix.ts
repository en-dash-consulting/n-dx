export {
  detectIssues,
  applyFixes,
  detectTimestampIssues,
  detectOrphanBlockedBy,
  detectParentChildMisalignment,
} from "../fix/index.js";
export type {
  FixAction,
  FixItem as PRDItem,
  FixItemStatus as ItemStatus,
  FixKind,
  FixResult,
} from "../fix/index.js";
