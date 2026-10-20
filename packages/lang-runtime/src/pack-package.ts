/**
 * Where a pack package keeps its assets, worked out from the root the pack
 * passes in: its built grammar in `<root>/build/grammars`, its queries in
 * `<root>/queries/<lang>`, its version in `<root>/package.json`. Every value
 * is computed on first use, so importing a pack never touches the filesystem.
 *
 * @module lang-runtime/pack-package
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A pack package's name and the locations of what it ships. */
export interface PackPackage {
  /** npm name, e.g. `@n-dx/lang-java`. */
  readonly name: string;
  /** The `version` in the package's `package.json`. */
  version(): string;
  /** Directory holding the package's built `<grammar>.wasm`. */
  grammarDir(): string;
  /** Directory holding the `.scm` query files for `lang`. */
  queryDir(lang: string): string;
  /** The sentence that ends a notice for a grammar that is not built. */
  missingGrammarStep(): string;
  /** The sentence that ends a notice for a built grammar, or a query, that fails. */
  rebuildStep(): string;
}

/**
 * True when the pack at `packRoot` sits in the n-dx source checkout, with
 * `packages/lang-runtime/scripts/build-grammars.mjs` beside it. An installed
 * pack has no such sibling: published packages ship built grammars instead
 * of the script.
 */
function inSourceCheckout(packRoot: string): boolean {
  return existsSync(join(packRoot, "..", "lang-runtime", "scripts", "build-grammars.mjs"));
}

/** The pack package named `name` whose root directory `root` returns. */
export function packPackage(name: string, root: () => string): PackPackage {
  let version: string | undefined;
  const buildCommand = `\`pnpm --filter ${name} build:grammars\``;
  return {
    name,
    version() {
      version ??= String((JSON.parse(readFileSync(join(root(), "package.json"), "utf-8")) as { version?: unknown }).version);
      return version;
    },
    grammarDir: () => join(root(), "build", "grammars"),
    queryDir: (lang) => join(root(), "queries", lang),
    missingGrammarStep: () =>
      inSourceCheckout(root())
        ?`Build it with ${buildCommand} in the n-dx checkout.`
        : `Published ${name} ships this grammar, so this install is incomplete: reinstall ${name}.`,
    rebuildStep: () => `Rebuild it with ${buildCommand} in the n-dx checkout, or reinstall ${name}.`,
  };
}
