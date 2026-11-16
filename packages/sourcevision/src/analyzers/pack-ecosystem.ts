/**
 * Language packs' `versionFloor` and `legacyConstructs` facts as the SDLC
 * profile's `ecosystem`, per language (the inventory's, lower-cased):
 *
 * - `versionFloors`: files by the oldest version whose syntax covers them.
 * - `legacyConstructs`: uses of constructs later versions removed or
 *   deprecated, by rule and by the version that removed (or deprecated) them,
 *   with review notices counted apart.
 *
 * Readiness carries it through (`readiness-score.ts`). `versionFloors`
 * appears when a pack was asked for floors over the language's files, even if
 * none has one; `legacyConstructs` only when a file has a use. A language
 * appears only with a section, and the profile gains `ecosystem` only then, so
 * a repository without such a pack, or without files of its language, writes
 * the profile it always did.
 *
 * @module sourcevision/analyzers/pack-ecosystem
 */

import { compareLanguageVersions, type LegacyConstructFact } from "@n-dx/lang-kit";
import type {
  Inventory,
  SdlcLanguageEcosystem,
  SdlcLegacyConstructs,
  SdlcLegacyRuleCount,
  SdlcProfile,
  SdlcVersionFloors,
} from "../schema/index.js";
import type { PackFrameworkFacts } from "./pack-framework-facts.js";

/** Facts for files the inventory lists, grouped by language. */
function byLanguage(facts: PackFrameworkFacts | undefined, inventory: Inventory): Map<string, PackFrameworkFacts[number][]> {
  const languages = new Map(inventory.files.map((f) => [f.path, f.language.toLowerCase()]));
  const grouped = new Map<string, PackFrameworkFacts[number][]>();
  for (const fact of facts ?? []) {
    const language = languages.get(fact.path);
    if (language === undefined) continue;
    let list = grouped.get(language);
    if (list === undefined) grouped.set(language, (list = []));
    list.push(fact);
  }
  return grouped;
}

/** `counts` as an object keyed oldest version first. */
const byVersion = (counts: ReadonlyMap<string, number>): Record<string, number> =>
  Object.fromEntries([...counts.keys()].sort(compareLanguageVersions).map((v) => [v, counts.get(v)!]));

const add = (counts: Map<string, number>, key: string, n = 1) => counts.set(key, (counts.get(key) ?? 0) + n);

/**
 * A language's files by floor. `files` counts the pack's fact entries, which
 * lang-kit's contract makes one per file the pack read (`PackProjectResult.facts`),
 * facts or none; files it could not read are not counted. `none` counts those
 * without a floor, and `highest` is absent when no file has one. Written when
 * the pack was asked for `versionFloor` (`asked`), so "no file uses syntax a
 * rule dates" is told from "no pack ran"; undefined otherwise.
 */
export function versionFloors(facts: readonly PackFrameworkFacts[number][]): SdlcVersionFloors | undefined {
  const floors = new Map<string, number>();
  let none = 0;
  let asked = false;
  for (const fact of facts) {
    if (fact.asked?.includes("versionFloor")) asked = true;
    if (fact.versionFloor === undefined) none++;
    else add(floors, fact.versionFloor.version);
  }
  if (floors.size === 0 && !asked) return undefined;
  const ordered = byVersion(floors);
  const highest = Object.keys(ordered).at(-1);
  return { files: facts.length, floors: ordered, none, ...(highest === undefined ? {} : { highest }) };
}

/** One rule's count, from its first fact; the boundaries are the rule's, so every fact of a rule carries the same. */
function ruleCount(fact: LegacyConstructFact): SdlcLegacyRuleCount {
  return {
    status: fact.status,
    uses: 0,
    files: 0,
    ...(fact.deprecated === undefined ? {} : { deprecated: { version: fact.deprecated.version, source: fact.deprecated.source } }),
    ...(fact.removed === undefined ? {} : { removed: { version: fact.removed.version, source: fact.removed.source } }),
    ...(fact.changed === undefined ? {} : { changed: { version: fact.changed.version, source: fact.changed.source } }),
    source: fact.source,
    ...(fact.likely === true ? { likely: true as const } : {}),
  };
}

/** A language's legacy-construct uses, counted. Undefined when no file has one. */
export function legacyConstructs(facts: readonly PackFrameworkFacts[number][]): SdlcLegacyConstructs | undefined {
  const rules = new Map<string, SdlcLegacyRuleCount>();
  const removedIn = new Map<string, number>();
  const deprecatedIn = new Map<string, number>();
  let files = 0;
  let uses = 0;
  let notices = 0;
  for (const { legacyConstructs: list } of facts) {
    if (list === undefined || list.length === 0) continue;
    files++;
    const seen = new Set<string>();
    for (const fact of list) {
      let count = rules.get(fact.rule);
      if (count === undefined) rules.set(fact.rule, (count = ruleCount(fact)));
      count.uses++;
      if (!seen.has(fact.rule)) {
        seen.add(fact.rule);
        count.files++;
      }
      if (fact.status === "notice") notices++;
      else {
        uses++;
        if (fact.removed !== undefined) add(removedIn, fact.removed.version);
        else if (fact.deprecated !== undefined) add(deprecatedIn, fact.deprecated.version);
      }
    }
  }
  if (files === 0) return undefined;
  return {
    files,
    uses,
    notices,
    rules: Object.fromEntries([...rules].sort(([a], [b]) => a.localeCompare(b))),
    removedIn: byVersion(removedIn),
    deprecatedIn: byVersion(deprecatedIn),
  };
}

/**
 * Each language's sections, keyed by the inventory's language lower-cased;
 * undefined when no language has one. Facts for files the inventory does not
 * list are dropped.
 */
export function packEcosystem(facts: PackFrameworkFacts | undefined, inventory: Inventory): Record<string, SdlcLanguageEcosystem> | undefined {
  const ecosystem: Record<string, SdlcLanguageEcosystem> = {};
  for (const [language, list] of [...byLanguage(facts, inventory)].sort(([a], [b]) => a.localeCompare(b))) {
    const floors = versionFloors(list);
    const legacy = legacyConstructs(list);
    if (floors === undefined && legacy === undefined) continue;
    ecosystem[language] = {
      ...(floors === undefined ? {} : { versionFloors: floors }),
      ...(legacy === undefined ? {} : { legacyConstructs: legacy }),
    };
  }
  return Object.keys(ecosystem).length === 0 ? undefined : ecosystem;
}

/** `profile` with `ecosystem` set; `profile` itself when there is none. */
export function withEcosystem(profile: SdlcProfile, ecosystem: Record<string, SdlcLanguageEcosystem> | undefined): SdlcProfile {
  return ecosystem === undefined ? profile : { ...profile, ecosystem };
}
