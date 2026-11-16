/**
 * Language packs' `versionFloor` facts as the SDLC profile's `ecosystem`: per
 * language (the inventory's, lower-cased), a histogram of files by the oldest
 * version whose syntax covers them. Readiness carries it through
 * (`readiness-score.ts`).
 *
 * Only a language whose pack produced at least one floor gets an entry, and
 * the profile gains `ecosystem` only then, so a repository without such a
 * pack, or a pack that dates nothing, writes the profile it always did.
 *
 * @module sourcevision/analyzers/pack-version-floors
 */

import { compareLanguageVersions } from "@n-dx/lang-kit";
import type { Inventory, SdlcLanguageEcosystem, SdlcProfile, SdlcVersionFloors } from "../schema/index.js";
import type { PackFrameworkFacts } from "./pack-framework-facts.js";

/**
 * One histogram per language with a floor, keyed by the inventory's language
 * lower-cased; undefined when no pack produced one. A language's `files`
 * counts every file a pack returned facts for in that language, `none` those
 * without a floor. Facts for files the inventory does not list are dropped.
 */
export function packVersionFloors(facts: PackFrameworkFacts | undefined, inventory: Inventory): Record<string, SdlcLanguageEcosystem> | undefined {
  const languages = new Map(inventory.files.map((f) => [f.path, f.language.toLowerCase()]));
  const byLanguage = new Map<string, { files: number; none: number; floors: Map<string, number> }>();
  for (const { path, versionFloor } of facts ?? []) {
    const language = languages.get(path);
    if (language === undefined) continue;
    let tally = byLanguage.get(language);
    if (tally === undefined) byLanguage.set(language, (tally = { files: 0, none: 0, floors: new Map() }));
    tally.files++;
    if (versionFloor === undefined) tally.none++;
    else tally.floors.set(versionFloor.version, (tally.floors.get(versionFloor.version) ?? 0) + 1);
  }

  const ecosystem: Record<string, SdlcLanguageEcosystem> = {};
  for (const [language, tally] of [...byLanguage].sort(([a], [b]) => a.localeCompare(b))) {
    if (tally.floors.size === 0) continue;
    const versions = [...tally.floors.keys()].sort(compareLanguageVersions);
    const versionFloors: SdlcVersionFloors = {
      files: tally.files,
      floors: Object.fromEntries(versions.map((v) => [v, tally.floors.get(v)!])),
      none: tally.none,
      highest: versions.at(-1)!,
    };
    ecosystem[language] = { versionFloors };
  }
  return Object.keys(ecosystem).length === 0 ? undefined : ecosystem;
}

/** `profile` with `ecosystem` set; `profile` itself when there is none. */
export function withEcosystem(profile: SdlcProfile, ecosystem: Record<string, SdlcLanguageEcosystem> | undefined): SdlcProfile {
  return ecosystem === undefined ? profile : { ...profile, ecosystem };
}
