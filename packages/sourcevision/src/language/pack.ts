/**
 * sourcevision's built-in language packs, and the runtime's pack loader bound
 * to where this package keeps their grammars.
 *
 * The pack contract and the loader are `@n-dx/lang-runtime`'s. Packs are
 * internal to sourcevision: there is no public plugin API and no loading of
 * packs from outside this package.
 *
 * @module sourcevision/language/pack
 */

import { existsSync } from "node:fs";
import {
  loadLanguagePacks as loadPacks,
  type LanguagePack,
  type LoadPacksOptions,
  type PackStatus,
} from "@n-dx/lang-runtime";
import { buildGrammarsScript, grammarBuildDir } from "./package-paths.js";
import { goPack } from "./go-pack.js";
import { javaPack } from "./java-pack.js";

/** Packs registered in sourcevision. */
export const BUILTIN_PACKS: readonly LanguagePack[] = [javaPack, goPack];

/** The runtime's options; every one may be left out, and the missing-grammar step is this package's. */
export type LoadBuiltinPacksOptions = Partial<Omit<LoadPacksOptions, "missingGrammarStep">>;

/**
 * The step that restores a missing grammar, for the install at hand. A source
 * checkout has the build script; a published install ships every built-in
 * grammar, so a missing one means the install is incomplete.
 */
function missingGrammarStep(): string {
  return existsSync(buildGrammarsScript())
    ? "Build it with `pnpm --filter @n-dx/sourcevision build:grammars` in the n-dx checkout."
    : "Published @n-dx/sourcevision ships this grammar, so this install is incomplete: reinstall n-dx with `npm install -g @n-dx/core@latest`.";
}

/**
 * The runtime's `loadLanguagePacks`, with `packs` defaulting to
 * {@link BUILTIN_PACKS} and `grammarDir` to {@link grammarBuildDir}.
 */
export function loadLanguagePacks(options: LoadBuiltinPacksOptions = {}): PackStatus[] {
  return loadPacks({
    ...options,
    packs: options.packs ?? BUILTIN_PACKS,
    grammarDir: options.grammarDir ?? grammarBuildDir(),
    missingGrammarStep: missingGrammarStep(),
  });
}
