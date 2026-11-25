/**
 * Language packs' `declarations` facts as `declarations.json`: per language,
 * each file's namespaces and the named types it declares (kind, name,
 * qualified name, line), so a type nothing imports can still be found.
 * imports.json lists only what is imported, and callgraph.json is too large
 * to read for this.
 *
 * Files are split as sdlc-profile.json's `ecosystem` splits them
 * (`byLanguage` in `pack-ecosystem.ts`): the application's own, third-party
 * files apart, mirror copies left out.
 *
 * {@link packDeclarationsData} returns `undefined` when no file has a
 * declaration, and {@link writeDeclarationsData} then writes nothing and
 * removes a stale file: a repository without such a pack is byte-identical to
 * one before declarations.json existed.
 *
 * @module sourcevision/analyzers/pack-declarations-files
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeclarationsFact } from "@n-dx/lang-kit";
import { DATA_FILES } from "../schema/data-files.js";
import type { DeclarationFileEntry, DeclarationLanguageFiles, DeclarationsData, DeclaredTypeEntry, Inventory } from "../schema/index.js";
import { toFactFileJSON } from "../util/sort.js";
import { byLanguage } from "./pack-ecosystem.js";
import type { PackFrameworkFacts } from "./pack-framework-facts.js";

type Fact = PackFrameworkFacts[number];

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byType = (a: DeclaredTypeEntry, b: DeclaredTypeEntry): number =>
  a.line - b.line || compareText(a.qualifiedName, b.qualifiedName) || compareText(a.kind, b.kind);

function entry(path: string, fact: DeclarationsFact): DeclarationFileEntry {
  return {
    path,
    namespaces: [...new Set(fact.namespaces)],
    types: fact.types
      .map((t) => ({ kind: t.kind, name: t.name, qualifiedName: t.qualifiedName, line: t.position.line }))
      .sort(byType),
  };
}

function entries(facts: readonly Fact[]): DeclarationFileEntry[] {
  return facts
    .flatMap((f) => (f.declarations === undefined ? [] : [entry(f.path, f.declarations)]))
    .filter((e) => e.namespaces.length > 0 || e.types.length > 0)
    .sort((a, b) => compareText(a.path, b.path));
}

/**
 * Each language's files with declarations, keyed by the inventory's language
 * lower-cased (the pack id); undefined when there is none. Facts for files the
 * inventory does not list are dropped.
 */
export function packDeclarationsData(facts: PackFrameworkFacts | undefined, inventory: Inventory): DeclarationsData | undefined {
  const languages: Record<string, DeclarationLanguageFiles> = {};
  for (const [language, { own, outside }] of [...byLanguage(facts, inventory)].sort(([a], [b]) => compareText(a, b))) {
    const files = entries(own);
    const thirdParty = entries(outside);
    if (files.length === 0 && thirdParty.length === 0) continue;
    languages[language] = { files, ...(thirdParty.length === 0 ? {} : { thirdParty }) };
  }
  return Object.keys(languages).length === 0 ? undefined : { languages };
}

/**
 * Write `data` to `<svDir>/declarations.json` canonically; with no data,
 * remove one an earlier run left, so the directory never holds facts this
 * analysis did not find.
 */
export function writeDeclarationsData(svDir: string, data: DeclarationsData | undefined): void {
  const path = join(svDir, DATA_FILES.declarations);
  if (data === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, toFactFileJSON(data));
}
