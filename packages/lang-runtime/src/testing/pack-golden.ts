/**
 * Golden-file harness for language packs.
 *
 * Convention: a pack with id `<id>` keeps its fixture project in
 * `<fixture root>/<id>/` — source files under `src/`, the committed result in
 * `golden.json`; the fixture root is the testing package's
 * `tests/fixtures/language-packs`. The harness runs the pack's queries over
 * every file whose extension the pack's config claims, then the pack's
 * resolver (if any) over those results, and compares both with the golden.
 * Goldens are rewritten only when {@link UPDATE_ENV} is set, which the
 * testing package's `test:update-goldens` script does.
 *
 * @module lang-runtime/testing/pack-golden
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { FileReferences, LanguagePack } from "../pack.js";
import {
  createTreeSitterRunner,
  type FileResult,
  type ParsedFile,
  type RunnablePack,
} from "../runner.js";

/** Set to `1` to rewrite goldens instead of comparing. Never set by default. */
export const UPDATE_ENV = "SV_UPDATE_PACK_GOLDENS";

/** The pack's fixture project under `fixtureRoot`. */
export function fixtureDirFor(fixtureRoot: string, pack: LanguagePack): string {
  return join(fixtureRoot, pack.id);
}

export function goldenPathFor(fixtureDir: string): string {
  return join(fixtureDir, "golden.json");
}

export interface PackGolden {
  readonly pack: string;
  readonly grammar: { readonly name: string; readonly version: string };
  /** Sorted by path. */
  readonly files: readonly FileResult[];
  /** The pack resolver's output per parsed file, in path order; absent for a pack with no resolver. */
  readonly references?: Readonly<Record<string, FileReferences>>;
}

/** Project-relative, forward-slash paths of the fixture's source files, sorted. */
export function listFixtureFiles(fixtureDir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(relative(fixtureDir, full).split(sep).join("/"));
      }
    }
  };
  walk(fixtureDir);
  return found.sort();
}

/** Run every query of the pack over the fixture's files, then its resolver over the results. */
export async function runPackOverFixture(
  target: RunnablePack,
  fixtureDir: string,
): Promise<PackGolden> {
  const { pack } = target;
  const runner = createTreeSitterRunner();
  try {
    const files: FileResult[] = [];
    for (const path of listFixtureFiles(fixtureDir, [...pack.config.extensions])) {
      files.push(await runner.parseFile(target, join(fixtureDir, path)).then((r) => ({ ...r, path })));
    }
    if (!pack.resolver) return { pack: pack.id, grammar: pack.grammar, files };
    const parsed = files.filter((f): f is ParsedFile => f.status === "parsed");
    const resolver = (await pack.resolver.forProject?.(fixtureDir, files.map((f) => f.path))) ?? pack.resolver;
    const prepared = resolver.prepare(parsed);
    const references = Object.fromEntries(parsed.map((f) => [f.path, prepared.resolve(f.path)]));
    return { pack: pack.id, grammar: pack.grammar, files, references };
  } finally {
    runner.dispose();
  }
}

/** Stable text form of a golden: two-space JSON, trailing newline. */
export function serializeGolden(golden: PackGolden): string {
  return `${JSON.stringify(golden, null, 2)}\n`;
}

export type GoldenOutcome = "matched" | "updated";

/**
 * Compare `actual` with the golden at `goldenPath`. Throws, naming the
 * update command, when it differs or is missing. Only when `update` is true
 * is the file written.
 */
export function checkGolden(actual: PackGolden, goldenPath: string, update: boolean): GoldenOutcome {
  const text = serializeGolden(actual);
  if (update) {
    writeFileSync(goldenPath, text);
    return "updated";
  }
  if (!existsSync(goldenPath)) {
    throw new Error(`No golden at ${goldenPath}. Create it with the test:update-goldens script.`);
  }
  if (readFileSync(goldenPath, "utf-8") !== text) {
    throw new Error(
      `Pack output differs from ${goldenPath}. If the change is intended, ` +
        `review it and run the test:update-goldens script.`,
    );
  }
  return "matched";
}

export function updateRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[UPDATE_ENV] === "1";
}
