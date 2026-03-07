/**
 * Input validation helpers for CLI commands.
 *
 * Centralises flag parsing and validation so every command gives
 * consistent, user-friendly error messages with suggestions.
 */

import { CLIError } from "./errors.js";
import { LEVEL_HIERARCHY, VALID_LEVELS, isItemLevel, getLevelLabel } from "../schema/index.js";
import type { ItemLevel } from "../schema/index.js";

/**
 * Validate that `level` is a recognised hierarchy level.
 * Throws a CLIError listing valid levels when it isn't.
 */
export function validateLevel(level: string): asserts level is ItemLevel {
  if (!isItemLevel(level)) {
    throw new CLIError(
      `Invalid level "${level}".`,
      `Valid levels: ${[...VALID_LEVELS].join(", ")}`,
    );
  }
}

/**
 * Ensure a parent ID is present for levels that require one.
 * Throws a CLIError with a suggestion to check `rex status`.
 */
export function requireParent(level: ItemLevel, parentId: string | undefined): void {
  const allowedParents = LEVEL_HIERARCHY[level];
  const canBeRoot = allowedParents.includes(null);

  if (!canBeRoot && !parentId) {
    const parentNames = allowedParents
      .filter((p): p is ItemLevel => p !== null)
      .join(" or ");
    throw new CLIError(
      `A ${getLevelLabel(level)} requires a parent (${parentNames}).`,
      "Run 'rex status' to find a suitable parent ID, then use --parent=<id>.",
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Validate an output format string against a list of valid options.
 * Throws a CLIError suggesting the valid formats when the value is not recognised.
 */
export function validateFormat(
  format: string,
  validFormats: readonly string[],
): void {
  if (!validFormats.includes(format)) {
    throw new CLIError(
      `Unknown format: "${format}"`,
      `Valid formats: ${validFormats.join(", ")}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Integer parsing                                                    */
/* ------------------------------------------------------------------ */

export interface ParseIntOptions {
  /** Minimum allowed value (inclusive). */
  min?: number;
  /** Maximum allowed value (inclusive). */
  max?: number;
  /** Value to return when `raw` is undefined or empty. */
  defaultValue?: number;
}

/**
 * Parse a string flag into a safe integer with bounds checking.
 *
 * Edge-case behaviour:
 *  - `undefined` / empty string → returns `defaultValue` (or throws when no default).
 *  - Floats, NaN, Infinity, negative-when-min-is-0, etc. → CLIError.
 *  - Leading/trailing whitespace is trimmed.
 *  - Strings like "10abc" are rejected (unlike bare parseInt).
 */
export function parseIntSafe(
  raw: string | undefined,
  flagName: string,
  opts: ParseIntOptions = {},
): number {
  const { min, max, defaultValue } = opts;

  // Handle missing / empty input
  if (raw === undefined || raw.trim() === "") {
    if (defaultValue !== undefined) return defaultValue;
    throw new CLIError(
      `Missing value for --${flagName}.`,
      `Provide a${min !== undefined && min >= 0 ? " positive" : "n"} integer (e.g. --${flagName}=10).`,
    );
  }

  const trimmed = raw.trim();
  const num = Number(trimmed);

  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new CLIError(
      `Invalid --${flagName}: "${trimmed}" is not an integer.`,
      `Provide a whole number (e.g. --${flagName}=10).`,
    );
  }

  if (min !== undefined && num < min) {
    throw new CLIError(
      `Invalid --${flagName}: ${num} is below the minimum of ${min}.`,
      `Value must be at least ${min}.`,
    );
  }

  if (max !== undefined && num > max) {
    throw new CLIError(
      `Invalid --${flagName}: ${num} exceeds the maximum of ${max}.`,
      `Value must be at most ${max}.`,
    );
  }

  return num;
}

/* ------------------------------------------------------------------ */
/*  Update helpers                                                     */
/* ------------------------------------------------------------------ */

const UPDATE_FLAGS = ["--status", "--priority", "--title", "--description", "--blockedBy"] as const;

/**
 * Ensure at least one update field is present.
 * Throws a CLIError listing the available flags when the update object is empty.
 */
export function requireUpdates(updates: Record<string, unknown>): void {
  if (Object.keys(updates).length === 0) {
    throw new CLIError(
      "No updates specified.",
      `Use ${UPDATE_FLAGS.join(", ")} to specify what to change.`,
    );
  }
}
