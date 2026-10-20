/**
 * Module hooks that let a worker thread import lang-kit's TypeScript sources the
 * way vitest does: a relative `./x.js` import from a `.ts` file resolves to
 * `./x.ts`, and `.ts` is transpiled with the package's own `typescript`.
 *
 * Registered by bounded-worker.mjs. Plain JS, because Node loads it directly.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
    const source = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    if (existsSync(source)) return { url: source.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
  const fileName = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
    fileName,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
