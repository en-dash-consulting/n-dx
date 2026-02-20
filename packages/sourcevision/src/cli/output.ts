/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * Re-exports the shared foundation primitives from @n-dx/llm-client.
 * All existing consumers import from this file — the re-export preserves
 * their import paths while consolidating the implementation.
 */

export { setQuiet, isQuiet, info, result } from "@n-dx/llm-client";
