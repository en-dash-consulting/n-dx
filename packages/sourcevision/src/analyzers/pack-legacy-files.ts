/**
 * Language packs' `versionFloor` and `legacyConstructs` facts as
 * `legacy.json`: per language, each file's floor and every legacy-construct
 * use, so an upgrade can be planned file by file.
 *
 * Files are split as sdlc-profile.json's `ecosystem` splits them
 * (`byLanguage` in `pack-ecosystem.ts`): the application's own, third-party
 * files apart, mirror copies left out. Per-file `uses`, `notices`,
 * `removedIn` and `deprecatedIn` follow `legacyConstructs`'s definitions, so
 * summing the files gives the profile's totals. Versions and positions only:
 * each rule's pages are in the profile once, and no code is copied.
 *
 * {@link packLegacyData} returns `undefined` when no file has a floor or a
 * use, and {@link writeLegacyData} then writes nothing and removes a stale
 * file: an analysis without such facts is byte-identical to one before
 * legacy.json existed.
 *
 * @module sourcevision/analyzers/pack-legacy-files
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LegacyConstructFact } from "@n-dx/lang-kit";
import { DATA_FILES } from "../schema/data-files.js";
import type { Inventory, LegacyConstructUse, LegacyData, LegacyFileEntry, LegacyLanguageFiles } from "../schema/index.js";
import { toFactFileJSON } from "../util/sort.js";
import { byLanguage, byVersion } from "./pack-ecosystem.js";
import type { PackFrameworkFacts } from "./pack-framework-facts.js";

type Fact = PackFrameworkFacts[number];

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function use(fact: LegacyConstructFact): LegacyConstructUse {
  return {
    rule: fact.rule,
    construct: fact.construct,
    status: fact.status,
    line: fact.position.line,
    column: fact.position.column,
    ...(fact.deprecated === undefined ? {} : { deprecated: fact.deprecated.version }),
    ...(fact.removed === undefined ? {} : { removed: fact.removed.version }),
    ...(fact.changed === undefined ? {} : { changed: fact.changed.version }),
    ...(fact.likely === true ? { likely: true as const } : {}),
  };
}

/** One file's entry; undefined when it has neither a floor nor a use. */
function fileEntry(fact: Fact): LegacyFileEntry | undefined {
  const list = fact.legacyConstructs ?? [];
  const floor = fact.versionFloor;
  if (floor === undefined && list.length === 0) return undefined;
  const removedIn = new Map<string, number>();
  const deprecatedIn = new Map<string, number>();
  let uses = 0;
  let notices = 0;
  for (const f of list) {
    if (f.status === "notice") {
      notices++;
      continue;
    }
    uses++;
    if (f.removed !== undefined) removedIn.set(f.removed.version, (removedIn.get(f.removed.version) ?? 0) + 1);
    else if (f.deprecated !== undefined) deprecatedIn.set(f.deprecated.version, (deprecatedIn.get(f.deprecated.version) ?? 0) + 1);
  }
  return {
    path: fact.path,
    ...(floor === undefined ? {} : { floor: { version: floor.version, rule: floor.rule, line: floor.position.line } }),
    uses,
    notices,
    removedIn: byVersion(removedIn),
    deprecatedIn: byVersion(deprecatedIn),
    constructs: list.map(use).sort((a, b) => a.line - b.line || a.column - b.column),
  };
}

function entries(facts: readonly Fact[]): LegacyFileEntry[] {
  return facts
    .map(fileEntry)
    .filter((e): e is LegacyFileEntry => e !== undefined)
    .sort((a, b) => compareText(a.path, b.path));
}

/**
 * Each language's files with a floor or a use, keyed by the inventory's
 * language lower-cased; undefined when there is none. Facts for files the
 * inventory does not list are dropped.
 */
export function packLegacyData(facts: PackFrameworkFacts | undefined, inventory: Inventory): LegacyData | undefined {
  const languages: Record<string, LegacyLanguageFiles> = {};
  for (const [language, { own, outside }] of [...byLanguage(facts, inventory)].sort(([a], [b]) => compareText(a, b))) {
    const files = entries(own);
    const thirdParty = entries(outside);
    if (files.length === 0 && thirdParty.length === 0) continue;
    languages[language] = { files, ...(thirdParty.length === 0 ? {} : { thirdParty }) };
  }
  return Object.keys(languages).length === 0 ? undefined : { languages };
}

/**
 * Write `data` to `<svDir>/legacy.json` canonically; with no data, remove a
 * legacy.json an earlier run left, so the directory never holds facts this
 * analysis did not find.
 */
export function writeLegacyData(svDir: string, data: LegacyData | undefined): void {
  const path = join(svDir, DATA_FILES.legacy);
  if (data === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, toFactFileJSON(data));
}
