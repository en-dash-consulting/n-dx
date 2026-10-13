/**
 * Gate for tests that need a tree-sitter grammar built by
 * scripts/build-grammars.mjs. A grammar is a local build artifact, so on a
 * developer machine a missing one skips the test. A CI job that is meant to
 * have it sets SV_REQUIRE_GRAMMARS=1, and then a missing grammar fails the
 * test instead of passing silently as a skip.
 *
 * @module lang-runtime/testing/grammar
 */

import { existsSync } from "node:fs";

export const REQUIRE_GRAMMARS_ENV = "SV_REQUIRE_GRAMMARS";

/** The part of a test context the gate uses; vitest's `TestContext` has it. */
export interface SkippableTest {
  skip(note?: string): void;
}

export function grammarsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REQUIRE_GRAMMARS_ENV] === "1";
}

/** Skip the running test unless `wasmPath` is built; throw instead when grammars are required. */
export function skipUnlessGrammar(
  ctx: SkippableTest,
  wasmPath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (existsSync(wasmPath)) return;
  const message = `${wasmPath} is not built — run \`node packages/lang-runtime/scripts/build-grammars.mjs\``;
  if (grammarsRequired(env)) throw new Error(`${message} (${REQUIRE_GRAMMARS_ENV}=1 forbids skipping)`);
  ctx.skip(message);
}
