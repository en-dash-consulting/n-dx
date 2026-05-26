/**
 * CLI string parsing utilities for common patterns like CSV lists.
 */

/**
 * Parse a comma-separated string into a trimmed, non-empty array.
 * @param input - A comma-separated list
 * @returns Array of trimmed non-empty strings
 */
export function parseCsvList(input: string): string[] {
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse a comma-separated string of integers.
 * @param input - A comma-separated list of integers
 * @returns Array of valid integers (NaN values are filtered out)
 */
export function parseIntList(input: string): number[] {
  return input.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}
