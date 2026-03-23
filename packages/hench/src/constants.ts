import { PROJECT_DIRS } from "./prd/llm-gateway.js";

export const HENCH_DIR = PROJECT_DIRS.HENCH;

/** Well-known files/dirs within the hench data directory. Basenames only — join with HENCH_DIR. */
export const HENCH_FILES = {
  CONFIG: "config.json",
  RUNS: "runs",
} as const;
