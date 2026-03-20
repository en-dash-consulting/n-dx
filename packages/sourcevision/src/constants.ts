import { PROJECT_DIRS, PROJECT_ROOT_DIR } from "@n-dx/llm-client";

/** Sourcevision package version. */
export const TOOL_VERSION = "0.1.0";

/** Project-relative output directory for Sourcevision artifacts. */
export const SV_DIR = PROJECT_DIRS.SOURCEVISION;

/** Root n-dx directory name (single path component, for readdirSync matching). */
export const NDX_ROOT = PROJECT_ROOT_DIR;

/** Well-known files within the sourcevision data directory. Basenames only — join with SV_DIR. */
export const SV_FILES = {
  MANIFEST: "manifest.json",
  HINTS: "hints.md",
} as const;
