import { PROJECT_DIRS } from "@n-dx/llm-client";

export const REX_DIR = PROJECT_DIRS.REX;

/** Well-known files within the rex data directory. Basenames only — join with REX_DIR. */
export const REX_FILES = {
  CONFIG: "config.json",
  PRD: "prd.json",
  WORKFLOW: "workflow.md",
  EXECUTION_LOG: "execution-log.jsonl",
  ARCHIVE: "archive.json",
  PENDING_PROPOSALS: "pending-proposals.json",
  ACKNOWLEDGED_FINDINGS: "acknowledged-findings.json",
  ADAPTERS: "adapters.json",
} as const;
