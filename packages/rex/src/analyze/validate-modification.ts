/**
 * Validation for natural-language modification requests.
 *
 * Ensures modification requests are specific enough to act upon before
 * sending them to the LLM. Provides helpful feedback when requests are
 * ambiguous so users can iteratively refine their input.
 *
 * All functions are pure (no I/O) and fully testable.
 *
 * @module analyze/validate-modification
 */

import type { Proposal } from "./propose.js";

// ── Types ──

export interface ValidationResult {
  /** Whether the request passed validation. */
  valid: boolean;
  /** Error message when validation fails. */
  error?: string;
  /** Actionable suggestion for how to improve the request. */
  suggestion?: string;
}

export interface ClassificationResult {
  /** The detected intent of the modification request. */
  intent: "add" | "remove" | "modify" | "restructure" | "unknown";
  /** The detected target of the modification (e.g. item name), if any. */
  target?: string;
}

// ── Intent patterns ──

/** Action verbs that indicate adding new items. */
const ADD_PATTERNS = /\b(add|create|include|introduce|insert|append|new)\b/i;

/** Action verbs that indicate removing items. */
const REMOVE_PATTERNS = /\b(remove|delete|drop|omit|exclude|eliminate|cut)\b/i;

/** Action verbs that indicate modifying existing items. */
const MODIFY_PATTERNS = /\b(change|update|modify|rename|set|adjust|increase|decrease|rewrite|revise|rephrase|move)\b/i;

/** Action verbs that indicate restructuring. */
const RESTRUCTURE_PATTERNS = /\b(split|merge|combine|consolidate|reorganize|restructure|separate|break\s*down|flatten|group|regroup|rearrange)\b/i;

/**
 * Minimum word count for a modification request to be considered specific enough.
 * Requests with fewer words are flagged as too vague.
 */
const MIN_WORD_COUNT = 3;

/**
 * Very short vague phrases that are not actionable even if they meet
 * the word count threshold.
 */
const VAGUE_PHRASES = [
  /^make\s+(it\s+)?better$/i,
  /^fix\s+(it|this|that|them)$/i,
  /^change\s+(it|this|that|them)$/i,
  /^update\s+(it|this|that|them)$/i,
  /^improve\s+(it|this|that|them)$/i,
  /^do\s+(it|something|more)$/i,
];

// ── Validation ──

/**
 * Validate a modification request for specificity and actionability.
 *
 * Checks:
 * 1. Request is not empty
 * 2. There are proposals to modify
 * 3. Request has enough words to be meaningful
 * 4. Request is not a known vague phrase
 *
 * @param request - The natural language modification request
 * @param proposals - The current proposals that would be modified
 * @returns Validation result with error and suggestion when invalid
 */
export function validateModificationRequest(
  request: string,
  proposals: Proposal[],
): ValidationResult {
  const trimmed = request.trim();

  // Empty request
  if (!trimmed) {
    return {
      valid: false,
      error: "Modification request is empty. Please provide a description of what you'd like to change.",
      suggestion: 'Try something like: "Add a caching feature" or "Remove the login task" or "Change priority of auth tasks to high".',
    };
  }

  // No proposals to modify
  if (proposals.length === 0) {
    return {
      valid: false,
      error: "No proposals to modify. Generate proposals first with `rex analyze` or `rex add`.",
      suggestion: "Run `rex analyze` to generate proposals, then modify them.",
    };
  }

  // Word count check
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < MIN_WORD_COUNT) {
    return {
      valid: false,
      error: `Modification request is too vague ("${trimmed}"). Please be more specific about what to change.`,
      suggestion: buildVagueSuggestion(trimmed, proposals),
    };
  }

  // Known vague phrases
  for (const pattern of VAGUE_PHRASES) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        error: `Modification request is too vague ("${trimmed}"). Please be more specific about what to change.`,
        suggestion: buildVagueSuggestion(trimmed, proposals),
      };
    }
  }

  return { valid: true };
}

// ── Classification ──

/**
 * Classify the intent of a modification request.
 *
 * Detects whether the user wants to add, remove, modify, or restructure
 * proposals based on action verb patterns. Also attempts to extract the
 * target (the thing being acted upon).
 *
 * This is a heuristic classification — it does not use LLM. It's used
 * for validation feedback and to help guide error messages.
 *
 * @param request - The natural language modification request
 * @returns Classification with detected intent and optional target
 */
export function classifyModificationRequest(
  request: string,
): ClassificationResult {
  const trimmed = request.trim();

  // Check patterns in order of specificity (restructure first since it's
  // more specific than modify).
  if (RESTRUCTURE_PATTERNS.test(trimmed)) {
    return { intent: "restructure", target: extractTarget(trimmed, RESTRUCTURE_PATTERNS) };
  }

  if (ADD_PATTERNS.test(trimmed)) {
    return { intent: "add", target: extractTarget(trimmed, ADD_PATTERNS) };
  }

  if (REMOVE_PATTERNS.test(trimmed)) {
    return { intent: "remove", target: extractTarget(trimmed, REMOVE_PATTERNS) };
  }

  if (MODIFY_PATTERNS.test(trimmed)) {
    return { intent: "modify", target: extractTarget(trimmed, MODIFY_PATTERNS) };
  }

  return { intent: "unknown" };
}

// ── Helpers ──

/**
 * Extract the likely target of a modification request by finding the
 * noun phrase that follows the action verb.
 */
function extractTarget(request: string, verbPattern: RegExp): string | undefined {
  // Find the verb and take the rest of the sentence as context
  const match = request.match(verbPattern);
  if (!match) return undefined;

  const verbEnd = (match.index ?? 0) + match[0].length;
  const rest = request.slice(verbEnd).trim();

  // Take the first significant noun phrase (strip leading articles/prepositions)
  const cleaned = rest.replace(/^(the|a|an|of|for|from|to|into|in)\s+/gi, "");

  // Return up to 50 chars of the cleaned phrase, or undefined if empty
  if (!cleaned) return undefined;
  return cleaned.length > 50 ? cleaned.slice(0, 50) + "..." : cleaned;
}

/**
 * Build a context-aware suggestion when a request is too vague.
 * Uses the current proposals to suggest specific modifications.
 */
function buildVagueSuggestion(request: string, proposals: Proposal[]): string {
  const examples: string[] = [];

  if (proposals.length > 0) {
    const firstEpic = proposals[0].epic.title;
    examples.push(`"Add a new feature for error handling to ${firstEpic}"`);

    if (proposals[0].features.length > 0) {
      const firstFeature = proposals[0].features[0].title;
      examples.push(`"Remove the ${firstFeature} feature"`);
    }

    if (proposals[0].features.length > 0 && proposals[0].features[0].tasks.length > 0) {
      examples.push(`"Change priority of all tasks to high"`);
    }
  } else {
    examples.push(`"Add a new feature for error handling"`);
    examples.push(`"Remove the login task"`);
    examples.push(`"Change priority of auth tasks to high"`);
  }

  return `Try being more specific. Examples:\n  ${examples.join("\n  ")}`;
}
