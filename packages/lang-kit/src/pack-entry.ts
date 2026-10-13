/**
 * The pack entry: the one object a language pack package hands its host.
 *
 * A pack package exports it as `pack` (`export const pack: LanguagePackEntry`).
 * The host (sourcevision) finds the package at run time, imports it and reads
 * nothing else from it. The entry says which language it covers and which
 * fact kinds it fills, and answers one project-level call with lang-kit's
 * per-file facts ({@link FileFacts}).
 *
 * The call is per project, not per file: resolving a reference needs an index
 * of the whole project (same-package lookups, build files), so the pack sees
 * every file of its language at once.
 *
 * Nothing here is tied to a parser. Each field below says what it means for a
 * grammar-based pack (a grammar and query files run by `@n-dx/lang-runtime`)
 * and for a pack that is not one: a TS/JS pack on the TypeScript compiler, or
 * a precise tier that reads a SCIP index.
 *
 * @module lang-kit/pack-entry
 */

import type { LanguageConfig } from "./registry.js";
import { isFactKind, type FactKind, type FactProducer, type FileFacts } from "./pack-contract.js";

/** What the host asks of a pack for one analysis. */
export interface PackProjectRequest {
  /** Absolute path of the project being analyzed. */
  readonly projectDir: string;
  /**
   * Project-relative, forward-slash paths of the project's files in this
   * pack's language, as the host's inventory lists them. The pack reads them
   * from `projectDir`; it never walks the project for more source files, though
   * it may read build files (`go.mod`, `tsconfig.json`) it needs to resolve.
   */
  readonly files: readonly string[];
  /**
   * Fact kinds the host wants; defaults to everything in `produces`. A kind
   * the pack does not produce stays absent. A pack may skip work no wanted
   * kind needs.
   */
  readonly kinds?: readonly FactKind[];
}

/**
 * Why a pack could not run at all. The host words the notice: it puts the
 * language's name before `reason` and what the language gets instead (another
 * parser, inventory only) between `reason` and `remedy`.
 */
export interface PackDegradation {
  /**
   * What failed, as a clause: `grammar <name>@<version> is not built
   * (expected …)`, `the project's build files could not be read (…)`, `no
   * index.scip in the project`.
   */
  readonly reason: string;
  /** One or more sentences telling the user how to fix it; absent when they cannot. */
  readonly remedy?: string;
}

/** A pack's answer for one project. */
export interface PackProjectResult {
  /**
   * One entry per file the pack read, in request order. A grammar-based pack
   * lists each file it parsed, even one with syntax errors; a compiler-based
   * pack lists each file in its program; a SCIP pack lists each file the index
   * documents.
   */
  readonly facts: readonly FileFacts[];
  /**
   * Requested files the pack had but could not read into facts: unreadable,
   * over a size limit, absent from the index. They still exist, so a resolver
   * that maps references to directories counts them. Never listed in `facts`.
   */
  readonly unparsed: readonly string[];
  /**
   * Set when the pack could not run at all — for a grammar-based pack a grammar
   * that is missing or will not load, a query that will not compile, build
   * files that cannot be read; for a compiler-based pack a compiler that will
   * not start; for a SCIP pack an index that is missing or unreadable. `facts`
   * and `unparsed` are then empty. A pack reports these here and never throws
   * for them.
   */
  readonly degraded?: PackDegradation;
}

/** The object a pack package exports as `pack`. */
export interface LanguagePackEntry extends FactProducer {
  /** The pack's npm package name, e.g. `@n-dx/lang-java`. */
  readonly packageName: string;
  /**
   * The version in the pack's own `package.json`. The host refuses a pack
   * whose version is not its own, so the two are always released together.
   */
  readonly version: string;
  /** The language id; same as `config.id`. */
  readonly id: string;
  /**
   * The language's registry config. Its extensions decide which inventory
   * files the host passes in `files`, whatever the pack parses them with.
   */
  readonly config: LanguageConfig;
  /**
   * Read the project's files of this language into per-file facts. Resolves
   * with a degraded result rather than rejecting when the pack cannot run.
   */
  analyzeProject(request: PackProjectRequest): Promise<PackProjectResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * True when `value` has the shape of a {@link LanguagePackEntry}. A host checks
 * what it imported from a package it did not build before using it.
 */
export function isLanguagePackEntry(value: unknown): value is LanguagePackEntry {
  if (!isRecord(value)) return false;
  const { packageName, version, id, config, produces, analyzeProject } = value;
  return (
    typeof packageName === "string" &&
    typeof version === "string" &&
    typeof id === "string" &&
    isRecord(config) &&
    config.id === id &&
    Array.isArray(produces) &&
    produces.every((kind) => typeof kind === "string" && isFactKind(kind)) &&
    typeof analyzeProject === "function"
  );
}
