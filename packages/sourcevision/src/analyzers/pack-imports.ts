/**
 * Import graph for languages analyzed through a language pack — Java and Go.
 *
 * Each pack is a package loaded at run time (`language/pack-loader.ts`).
 * Resolution needs an index of the whole project, so every file of a pack's
 * language goes to the pack on each run, incremental or not. A pack degrades
 * when it is missing, of another version or not a pack entry, when its
 * `produces` omits "imports", or when it reports that it could not run (its
 * grammar is not built or will not load, a query will not compile, the
 * project's build files cannot be read), or when its `analyzeProject` rejects
 * anyway (a defect in the pack). It is reported once, produces no
 * edges, and is listed in {@link PackImportGraph.degraded} so a caller with
 * another parser for the language (Go's regex parser) can run it.
 *
 * Edges and externals come from each file's lang-kit imports facts.
 *
 * @module sourcevision/analyzers/pack-imports
 */

import { extname } from "node:path";
import type { FactKind, FileFacts, LanguageConfig, LanguagePackEntry, PackDegradation, PackProjectResult } from "@n-dx/lang-kit";
import type { ExternalImport, ImportEdge, Inventory } from "../schema/index.js";
import {
  INSTALLABLE_PACKS,
  KNOWN_PACKS,
  loadPack,
  packInstallCommand,
  type InstallablePack,
  type KnownPack,
  type PackLoaderOptions,
} from "../language/pack-loader.js";

export interface PackImportsOptions {
  /** Defaults to {@link KNOWN_PACKS}. */
  readonly packs?: readonly KnownPack[];
  /** Where and how packs are found; see `loadPack`. */
  readonly loader?: PackLoaderOptions;
  /** Receives the notice for a pack that degrades. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
  /**
   * Pack id → the parser the caller runs for that language when the pack
   * degrades (e.g. "the regex import parser"); the notice names it instead of
   * inventory-only.
   */
  readonly fallbacks?: ReadonlyMap<string, string>;
  /**
   * Receives each pack's routes and outbound-call facts. When set, the same
   * `analyzeProject` call also asks for the {@link FRAMEWORK_FACT_KINDS} the
   * pack produces, so a file is parsed once per analysis; unset, only
   * imports are asked for.
   */
  readonly framework?: (facts: readonly FileFacts[]) => void;
}

/** The fact kinds a pack's framework rules produce for later phases. */
export const FRAMEWORK_FACT_KINDS = ["routes", "outboundCalls"] as const satisfies readonly FactKind[];

/** The {@link FRAMEWORK_FACT_KINDS} `entry` produces. */
export const frameworkKindsOf = (entry: LanguagePackEntry): FactKind[] =>
  FRAMEWORK_FACT_KINDS.filter((kind) => entry.produces.includes(kind));

export interface PackImportGraph {
  readonly edges: ImportEdge[];
  readonly external: ExternalImport[];
  /** Ids of packs that had files but degraded, so produced no edges. */
  readonly degraded: string[];
}

/** Packs whose files the imports phase analyzes, given the extensions it parses. */
export function packsFor(parseableExtensions: ReadonlySet<string>, packs: readonly KnownPack[] = KNOWN_PACKS): KnownPack[] {
  return packs.filter((pack) => [...pack.config.parseableExtensions].some((ext) => parseableExtensions.has(ext)));
}

/** True when `path` belongs to one of `packs`. */
export function isPackFile(path: string, packs: readonly { readonly config: LanguageConfig }[]): boolean {
  const ext = extname(path).toLowerCase();
  return packs.some((pack) => pack.config.parseableExtensions.has(ext));
}

/**
 * Report the packs the project lists (`sourcevision.packs`) that cannot be
 * used, whether or not the project has files of their language yet: one
 * notice per missing or refused pack, naming its `ndx sv pack add` command,
 * and one warning for all unknown ids. `reported` holds the packs that had
 * files, which {@link buildPackImportGraph} has already reported. A listed
 * pack changes nothing else about the analysis.
 */
export async function noticeListedPacks(
  listed: readonly string[],
  reported: ReadonlySet<string>,
  options: Pick<PackImportsOptions, "loader" | "warn"> & { /** Defaults to {@link INSTALLABLE_PACKS}. */ readonly installable?: readonly InstallablePack[] } = {},
): Promise<void> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const installable = options.installable ?? INSTALLABLE_PACKS;
  const ids = [...new Set(listed)];
  const unknown = ids.filter((id) => !installable.some((p) => p.id === id));
  if (unknown.length > 0) {
    const known = installable.map((p) => p.id).join(", ");
    warn(`sourcevision.packs lists unknown pack${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}; known packs: ${known}.`);
  }
  for (const pack of installable) {
    if (!ids.includes(pack.id) || reported.has(pack.id)) continue;
    const load = await loadPack(pack, options.loader);
    if (load.status !== "loaded") {
      warn(`sourcevision.packs lists ${pack.id}: ${load.notice.reason}. ${load.notice.remedy ?? ""}`.trimEnd());
    }
  }
}

/**
 * Hand every file of each pack's language to the pack and read its imports
 * facts into file-to-file edges and external packages. Packs with no files in
 * `files` are not loaded, so they never report anything.
 */
export async function buildPackImportGraph(
  files: Inventory["files"],
  targetDir: string,
  options: PackImportsOptions = {},
): Promise<PackImportGraph> {
  const edges: ImportEdge[] = [];
  const external = new Map<string, ExternalImport>();
  const degraded: string[] = [];

  const warn = options.warn ?? ((message: string) => console.warn(message));
  /** One notice: what failed, what the language gets instead, how to fix it. */
  const degrade = (pack: KnownPack, notice: PackDegradation): void => {
    const name = pack.config.displayName;
    const fallback = options.fallbacks?.get(pack.id);
    const outcome = fallback ? `${name} imports come from ${fallback}` : `${name} files get inventory only`;
    warn(`${name}: ${notice.reason}; ${outcome}.${notice.remedy === undefined ? "" : ` ${notice.remedy}`}`);
    degraded.push(pack.id);
  };

  for (const pack of options.packs ?? KNOWN_PACKS) {
    const paths = files.filter((f) => isPackFile(f.path, [pack])).map((f) => f.path);
    if (paths.length === 0) continue;

    const load = await loadPack(pack, options.loader);
    if (load.status !== "loaded") {
      degrade(pack, load.notice);
      continue;
    }
    // A pack that does not produce imports would read every file for no
    // edges, so degrade it before it runs and let a fallback parser run.
    if (!load.entry.produces.includes("imports")) {
      degrade(pack, { reason: 'the pack does not produce "imports"' });
      continue;
    }
    // The entry contract says a pack does not throw for its own failures, but a
    // resolver bug or a pack built against another contract can still reject;
    // that must cost only this language, as a missing pack does.
    const kinds: FactKind[] = ["imports", ...(options.framework ? frameworkKindsOf(load.entry) : [])];
    let result: PackProjectResult;
    try {
      result = await load.entry.analyzeProject({ projectDir: targetDir, files: paths, kinds });
    } catch (error) {
      degrade(pack, {
        reason: `the pack failed (${error instanceof Error ? error.message : String(error)})`,
        remedy: `Reinstall it with \`${packInstallCommand(pack)}\`.`,
      });
      continue;
    }
    if (result.degraded) {
      degrade(pack, result.degraded);
      continue;
    }
    for (const notice of result.notices ?? []) warn(notice);
    if (kinds.length > 1) options.framework?.(result.facts);

    for (const { path, imports } of result.facts) {
      if (!imports) continue;
      for (const ref of imports.files) {
        edges.push({ from: path, to: ref.to, type: "static", symbols: [...ref.symbols] });
      }
      for (const ext of imports.external) {
        const existing = external.get(ext.package);
        if (existing) {
          existing.importedBy.push(path);
          existing.symbols = Array.from(new Set([...existing.symbols, ...ext.symbols]));
        } else {
          external.set(ext.package, { package: ext.package, importedBy: [path], symbols: [...ext.symbols] });
        }
      }
    }
  }

  return { edges, external: [...external.values()], degraded };
}

/**
 * Ask each pack only for the {@link FRAMEWORK_FACT_KINDS} it produces: for a
 * phase that runs without the imports phase (`--phase`, `sv narrate`), which
 * otherwise collects these facts in its own call. A pack that cannot load is
 * passed over quietly, since its notice belongs to the imports phase; one that
 * degrades or fails while running gets one notice.
 */
export async function readPackFrameworkFacts(
  files: Inventory["files"],
  targetDir: string,
  options: Pick<PackImportsOptions, "packs" | "loader" | "warn"> = {},
): Promise<FileFacts[]> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const facts: FileFacts[] = [];
  for (const pack of options.packs ?? KNOWN_PACKS) {
    const paths = files.filter((f) => isPackFile(f.path, [pack])).map((f) => f.path);
    if (paths.length === 0) continue;
    const load = await loadPack(pack, options.loader);
    if (load.status !== "loaded") continue;
    const kinds = frameworkKindsOf(load.entry);
    if (kinds.length === 0) continue;
    const name = pack.config.displayName;
    const skip = (notice: PackDegradation): void =>
      warn(`${name}: ${notice.reason}; ${name} routes and outbound calls are not recorded.${notice.remedy === undefined ? "" : ` ${notice.remedy}`}`);
    let result: PackProjectResult;
    try {
      result = await load.entry.analyzeProject({ projectDir: targetDir, files: paths, kinds });
    } catch (error) {
      skip({
        reason: `the pack failed (${error instanceof Error ? error.message : String(error)})`,
        remedy: `Reinstall it with \`${packInstallCommand(pack)}\`.`,
      });
      continue;
    }
    if (result.degraded) {
      skip(result.degraded);
      continue;
    }
    for (const notice of result.notices ?? []) warn(notice);
    facts.push(...result.facts);
  }
  return facts;
}
