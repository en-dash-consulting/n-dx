/**
 * The shapes a Jev call asks and answers in: the three question types, their
 * answers, and the JSON values a question's state and criteria carry.
 *
 * Types only, so judgment-cache.ts can key and store answers without
 * importing jev-client.ts, which imports the cache: reading them from there
 * closed an import cycle. jev-client.ts re-exports every one.
 *
 * @module llm-client/jev-types
 */

/** JSON-serialisable value, for state and criteria payloads. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A Choice: pick one option from a fixed set. `criteria` maps each option to
 * a description — a string, or an object such as `{ what, not_for, examples }`
 * when neighbouring options are easy to confuse.
 */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, JsonValue>;
}

/**
 * A Noul: does a condition hold? Answered as the probability of yes. Optional
 * `criteria` sharpens the boundary when yes/no is subtle.
 */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: Record<string, JsonValue>;
}

/**
 * A Score: where on an ordered scale does the content sit? `criteria` is 2–10
 * level descriptions, lowest first; each must describe a concrete situation
 * that stands on its own, because the model rates every level independently.
 */
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: JsonValue[];
}

/** The question types this client sends. */
export type JevQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

// ── Answers ──────────────────────────────────────────────────────────────────

export interface ChoiceAnswer {
  type: "choice";
  /** The highest-probability option. */
  choice: string;
  /** Distribution across every option; sums to 1. */
  probabilities: Record<string, number>;
  /** 0–1, from the spread of the distribution — not the probability of `choice`. */
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability that the answer is yes. Near 0.5 means undecided, not "medium". */
  noul: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted mean of the level indexes; fractional. */
  score: number;
  /** Distribution across the levels, in level order. */
  probabilities: number[];
  /** 0–1, from the spread of the distribution. */
  confidence: number;
}

export type JevAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;
