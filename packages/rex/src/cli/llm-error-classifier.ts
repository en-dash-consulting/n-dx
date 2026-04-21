/**
 * Shared LLM error classifier — re-exports from the foundation layer.
 *
 * The canonical implementation lives in @n-dx/llm-client so both rex and
 * sourcevision can import it without violating domain-layer independence.
 * This module re-exports everything for backward compatibility with
 * existing rex-internal consumers.
 */

export {
  classifyLLMError,
} from "@n-dx/llm-client";

export type {
  LLMErrorCategory,
  LLMErrorClassification,
} from "@n-dx/llm-client";
