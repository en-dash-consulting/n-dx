/**
 * Compatibility bridge for legacy `@n-dx/claude-client` imports.
 *
 * The canonical foundation package is now `@n-dx/llm-client`.
 * This module re-exports the same public surface so existing imports can
 * migrate incrementally without immediate code churn.
 */

export * from "@n-dx/llm-client";
