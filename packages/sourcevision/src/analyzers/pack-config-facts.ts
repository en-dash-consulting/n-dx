/**
 * Language packs' `configReads` and `flagChecks` facts as `config.json`: per
 * file, its reads and checks; across the project, an index of flags by
 * normalized name (spellings, files, checks, gated lines) and of config keys
 * (sources, source files, consumer files).
 *
 * The facts ride the imports phase's one pack call with the other framework
 * facts (`PackFrameworkFacts`). A pack is loaded code, so each fact is
 * checked: one without a usable key or name, source or mechanism, or
 * position is dropped, a missing `normalized` is computed with lang-kit's
 * `normalizeFlagName`, and an inverted `gated` range is left off. Facts for a
 * file the inventory does not list are dropped.
 *
 * {@link packConfigData} returns `undefined` when nothing survives, and the
 * caller then writes no file: an analysis without a producing pack is
 * byte-identical to one before config.json existed.
 *
 * @module sourcevision/analyzers/pack-config-facts
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_SOURCES,
  FLAG_MECHANISMS,
  normalizeFlagName,
  type ConfigReadFact,
  type FlagCheckFact,
  type SourcePosition,
} from "@n-dx/lang-kit";
import type {
  ConfigData,
  ConfigFileEntry,
  ConfigFlagEntry,
  ConfigKeyEntry,
  ConfigRead,
  ConfigSource,
  FlagCheck,
  FlagMechanism,
  GatedLines,
  Inventory,
} from "../schema/index.js";
import { DATA_FILES } from "../schema/data-files.js";
import { toFactFileJSON } from "../util/sort.js";
import type { PackFrameworkFacts } from "./pack-framework-facts.js";

const SOURCES: ReadonlySet<string> = new Set(CONFIG_SOURCES);
const MECHANISMS: ReadonlySet<string> = new Set(FLAG_MECHANISMS);

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";
const isLine = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const isColumn = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const validPosition = (p: SourcePosition | undefined): p is SourcePosition =>
  p !== undefined && isLine(p.line) && isColumn(p.column);

function toRead(fact: ConfigReadFact): ConfigRead | undefined {
  if (!nonEmpty(fact.key) || !SOURCES.has(fact.source) || !validPosition(fact.position)) return undefined;
  return {
    key: fact.key,
    source: fact.source as ConfigSource,
    ...(nonEmpty(fact.sourceFile) ? { sourceFile: fact.sourceFile } : {}),
    line: fact.position.line,
    column: fact.position.column,
  };
}

function toGated(gated: FlagCheckFact["gated"]): GatedLines | undefined {
  if (gated === undefined || !isLine(gated.start) || !isLine(gated.end) || gated.end < gated.start) return undefined;
  return { start: gated.start, end: gated.end };
}

function toCheck(fact: FlagCheckFact): FlagCheck | undefined {
  if (!nonEmpty(fact.name) || !MECHANISMS.has(fact.mechanism) || !validPosition(fact.position)) return undefined;
  const normalized = nonEmpty(fact.normalized) ? fact.normalized : normalizeFlagName(fact.name);
  if (normalized === "") return undefined;
  const gated = toGated(fact.gated);
  return {
    name: fact.name,
    normalized,
    mechanism: fact.mechanism as FlagMechanism,
    ...(nonEmpty(fact.client) ? { client: fact.client } : {}),
    line: fact.position.line,
    column: fact.position.column,
    ...(gated === undefined ? {} : { gated }),
  };
}

/** Rows in position order, then by their text; exact repeats once. */
function sortedDistinct<T extends { line: number; column: number }>(rows: T[]): T[] {
  const keyed = new Map(rows.map((row) => [JSON.stringify(row), row]));
  return [...keyed.entries()]
    .sort(([ka, a], [kb, b]) => a.line - b.line || a.column - b.column || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, row]) => row);
}

const sortedSet = <T extends string>(values: Iterable<T>): T[] => [...new Set(values)].sort();

/** Lines covered by at least one range. */
function coveredLines(ranges: readonly GatedLines[]): number {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let total = 0;
  let end = 0;
  for (const range of sorted) {
    if (range.end <= end) continue;
    total += range.end - Math.max(range.start, end + 1) + 1;
    end = range.end;
  }
  return total;
}

function flagIndex(files: readonly ConfigFileEntry[]): ConfigFlagEntry[] {
  const byName = new Map<string, { names: Set<string>; mechanisms: Set<FlagMechanism>; files: Map<string, GatedLines[]>; checks: number }>();
  for (const { file, flagChecks } of files) {
    for (const check of flagChecks) {
      let entry = byName.get(check.normalized);
      if (entry === undefined) {
        entry = { names: new Set(), mechanisms: new Set(), files: new Map(), checks: 0 };
        byName.set(check.normalized, entry);
      }
      entry.names.add(check.name);
      entry.mechanisms.add(check.mechanism);
      entry.checks += 1;
      const ranges = entry.files.get(file) ?? [];
      if (check.gated !== undefined) ranges.push(check.gated);
      entry.files.set(file, ranges);
    }
  }
  return [...byName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([normalized, entry]) => ({
      normalized,
      names: sortedSet(entry.names),
      mechanisms: sortedSet(entry.mechanisms),
      files: sortedSet(entry.files.keys()),
      checks: entry.checks,
      gatedLines: [...entry.files.values()].reduce((sum, ranges) => sum + coveredLines(ranges), 0),
    }));
}

function keyIndex(files: readonly ConfigFileEntry[]): ConfigKeyEntry[] {
  const byKey = new Map<string, { sources: Set<ConfigSource>; sourceFiles: Set<string>; files: Set<string> }>();
  for (const { file, configReads } of files) {
    for (const read of configReads) {
      let entry = byKey.get(read.key);
      if (entry === undefined) {
        entry = { sources: new Set(), sourceFiles: new Set(), files: new Set() };
        byKey.set(read.key, entry);
      }
      entry.sources.add(read.source);
      if (read.sourceFile !== undefined) entry.sourceFiles.add(read.sourceFile);
      entry.files.add(file);
    }
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => ({
      key,
      sources: sortedSet(entry.sources),
      sourceFiles: sortedSet(entry.sourceFiles),
      files: sortedSet(entry.files),
    }));
}

/**
 * config.json's content from the packs' facts, or `undefined` when no pack
 * produced a usable config read or flag check for an inventoried file.
 */
export function packConfigData(facts: PackFrameworkFacts | undefined, inventory: Inventory): ConfigData | undefined {
  const listed = new Set(inventory.files.map((f) => f.path));
  const byFile = new Map<string, { reads: ConfigRead[]; checks: FlagCheck[] }>();
  for (const { path, configReads, flagChecks } of facts ?? []) {
    if (!listed.has(path) || (!configReads?.length && !flagChecks?.length)) continue;
    const entry = byFile.get(path) ?? { reads: [], checks: [] };
    for (const fact of configReads ?? []) {
      const read = toRead(fact);
      if (read !== undefined) entry.reads.push(read);
    }
    for (const fact of flagChecks ?? []) {
      const check = toCheck(fact);
      if (check !== undefined) entry.checks.push(check);
    }
    byFile.set(path, entry);
  }
  const files: ConfigFileEntry[] = [...byFile.entries()]
    .filter(([, { reads, checks }]) => reads.length > 0 || checks.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, { reads, checks }]) => ({ file, configReads: sortedDistinct(reads), flagChecks: sortedDistinct(checks) }));
  if (files.length === 0) return undefined;
  return { files, flags: flagIndex(files), keys: keyIndex(files) };
}

/**
 * Write `data` to `<svDir>/config.json` canonically; with no data, remove a
 * config.json an earlier run left, so the directory never holds facts this
 * analysis did not find. Nothing is written or created otherwise.
 */
export function writeConfigData(svDir: string, data: ConfigData | undefined): void {
  const path = join(svDir, DATA_FILES.config);
  if (data === undefined) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, toFactFileJSON(data));
}
