/**
 * Language packs' `dynamicCode` facts as `sites.json`: per language, each
 * file's sites (code run from a string, what runs chosen by a value, an
 * include whose path is built at run time) with the code of the pack notice
 * that counts it, so a reviewer can find each one without the console.
 *
 * Files are split as sdlc-profile.json's `ecosystem` splits them
 * (`byLanguage` in `pack-ecosystem.ts`): the application's own, third-party
 * files apart, mirror copies left out. Positions and names only: an
 * include's candidate files (at most {@link MAX_SITE_CANDIDATES}, with the
 * total and `truncated` past it), a database-fed site's tables and
 * `table.column` names. Never the expression as written, a value or a
 * query's source location.
 *
 * {@link packSitesData} returns `undefined` when no file has a site, and
 * {@link writeSitesData} then writes nothing and removes a stale file: an
 * analysis without sites is byte-identical to one before sites.json existed.
 *
 * @module sourcevision/analyzers/pack-sites-files
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DynamicCodeFact } from "@n-dx/lang-kit";
import { DATA_FILES } from "../schema/data-files.js";
import type { CodeSite, CodeSiteCandidates, Inventory, SiteFileEntry, SiteLanguageFiles, SitesData } from "../schema/index.js";
import { toFactFileJSON } from "../util/sort.js";
import { byLanguage } from "./pack-ecosystem.js";
import type { PackFrameworkFacts } from "./pack-framework-facts.js";

type Fact = PackFrameworkFacts[number];

/** How many candidate files a site lists; the rest are counted in `total`. A pack is loaded code, so its own cap is not relied on. */
export const MAX_SITE_CANDIDATES = 50;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedNames = (names: readonly string[]): string[] => [...new Set(names)].sort(compareText);

function candidates(found: DynamicCodeFact["candidates"]): CodeSiteCandidates | undefined {
  if (found === undefined) return undefined;
  const all = sortedNames(found.files);
  if (all.length === 0) return undefined;
  const files = all.slice(0, MAX_SITE_CANDIDATES);
  const total = Math.max(found.total, all.length);
  return { files, total, ...(total > files.length ? { truncated: true as const } : {}) };
}

function site(fact: DynamicCodeFact): CodeSite {
  const listed = candidates(fact.candidates);
  return {
    code: fact.notice ?? fact.kind,
    kind: fact.kind,
    construct: fact.construct,
    line: fact.position.line,
    column: fact.position.column,
    ...(fact.scope === undefined ? {} : { scope: fact.scope }),
    ...(fact.literal === true ? { literal: true as const } : {}),
    ...(listed === undefined ? {} : { candidates: listed }),
    ...(fact.database === undefined
      ? {}
      : { database: { tables: sortedNames(fact.database.tables), columns: sortedNames(fact.database.columns) } }),
  };
}

const bySite = (a: CodeSite, b: CodeSite): number =>
  a.line - b.line || a.column - b.column || compareText(a.code, b.code) || compareText(a.construct, b.construct);

function entries(facts: readonly Fact[]): SiteFileEntry[] {
  return facts
    .filter((f) => (f.dynamicCode?.length ?? 0) > 0)
    .map((f) => ({ path: f.path, sites: f.dynamicCode!.map(site).sort(bySite) }))
    .sort((a, b) => compareText(a.path, b.path));
}

/**
 * Each language's files with a dynamic-code site, keyed by the inventory's
 * language lower-cased; undefined when there is none. Facts for files the
 * inventory does not list are dropped.
 */
export function packSitesData(facts: PackFrameworkFacts | undefined, inventory: Inventory): SitesData | undefined {
  const languages: Record<string, SiteLanguageFiles> = {};
  for (const [language, { own, outside }] of [...byLanguage(facts, inventory)].sort(([a], [b]) => compareText(a, b))) {
    const files = entries(own);
    const thirdParty = entries(outside);
    if (files.length === 0 && thirdParty.length === 0) continue;
    languages[language] = { files, ...(thirdParty.length === 0 ? {} : { thirdParty }) };
  }
  return Object.keys(languages).length === 0 ? undefined : { languages };
}

/**
 * Write `data` to `<svDir>/sites.json` canonically; with no data, remove a
 * sites.json an earlier run left, so the directory never holds facts this
 * analysis did not find.
 */
export function writeSitesData(svDir: string, data: SitesData | undefined): void {
  const path = join(svDir, DATA_FILES.sites);
  if (data === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, toFactFileJSON(data));
}
