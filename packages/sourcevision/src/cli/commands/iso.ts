/**
 * iso command — render the analysis as a standalone isometric architecture map.
 *
 * Opt-in only. `sourcevision analyze` never calls this: the map is a reading
 * aid, not an analysis artifact, and regenerating it on every analyze would put
 * a large generated HTML file into every diff.
 *
 * The model building, scanning and rendering all live in `src/export/iso-*`,
 * shared verbatim with the standalone skill bundle. This file is argument
 * parsing and error reporting only.
 */

import { writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { SV_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import type { IsoSourceMode } from "../../export/iso-sources.js";

export interface IsoOptions {
  /** Output path. Defaults to `.sourcevision/iso-map.html`. */
  output?: string;
  /** Cap on rendered zones. */
  maxNodes?: number;
  /** Suppress the shared-dependency column. */
  noExternals?: boolean;
  /** Where the facts come from. */
  source?: IsoSourceMode;
  /** Base URL for source links. */
  linkBase?: string;
  /** Timestamp override, for reproducible output. */
  analyzedAt?: string;
}

/** Default output filename inside `.sourcevision/`. */
export const ISO_OUTPUT_FILE = "iso-map.html";

/**
 * Parse `iso`-specific flags out of a raw argv tail.
 *
 * Kept separate from the command body so the flag contract is testable without
 * touching the filesystem.
 */
export function parseIsoArgs(args: string[]): IsoOptions {
  const options: IsoOptions = {};
  for (const arg of args) {
    if (arg.startsWith("--output=") || arg.startsWith("-o=")) {
      options.output = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--max-nodes=")) {
      const raw = arg.split("=")[1];
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new CLIError(
          `Invalid --max-nodes value: ${raw}`,
          "Pass a positive integer, e.g. --max-nodes=25.",
        );
      }
      options.maxNodes = value;
    } else if (arg === "--no-externals") {
      options.noExternals = true;
    } else if (arg.startsWith("--source=")) {
      const mode = arg.split("=")[1];
      if (mode !== "auto" && mode !== "sourcevision" && mode !== "scan") {
        throw new CLIError(
          `Invalid --source value: ${mode}`,
          "Expected one of: auto, sourcevision, scan.",
        );
      }
      options.source = mode;
    } else if (arg.startsWith("--link-base=")) {
      options.linkBase = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--analyzed-at=")) {
      options.analyzedAt = arg.split("=").slice(1).join("=");
    }
  }
  return options;
}

/**
 * Render `.sourcevision/iso-map.html` from existing analysis, or from a direct
 * scan when asked.
 */
export async function cmdIso(dir: string, options: IsoOptions = {}): Promise<void> {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);
  const mode: IsoSourceMode = options.source ?? "auto";

  // Scan mode works on any directory; the analysis modes need the output dir.
  if (mode !== "scan" && !existsSync(svDir)) {
    throw new CLIError(
      `Sourcevision directory not found in ${absDir}`,
      "Run 'sourcevision analyze' first, or pass --source=scan to derive zones from the file tree.",
    );
  }

  const outputPath = options.output
    ? resolve(options.output)
    : join(existsSync(svDir) ? svDir : absDir, ISO_OUTPUT_FILE);

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    throw new CLIError(
      `Output directory does not exist: ${outputDir}`,
      "Create the directory first, or specify a different output path.",
    );
  }

  const { loadIsoInput } = await import("../../export/iso-sources.js");
  const { buildIsoModel } = await import("../../export/iso-model.js");
  const { renderIsoMap } = await import("../../export/iso-map.js");

  info(mode === "scan" ? "Scanning project..." : "Loading analysis data...");

  const input = loadIsoInput(absDir, mode, {
    analyzedAt: options.analyzedAt,
    linkBase: options.linkBase,
  });

  if (!input) {
    throw new CLIError(
      "No usable analysis data found in .sourcevision/.",
      "Run 'sourcevision analyze' to generate it, or pass --source=scan.",
    );
  }
  if (input.zones.length === 0) {
    if (input.meta.origin === "scan") {
      // A .sourcevision/ directory with nothing usable in it means the user
      // most likely wanted an analysis, not a scan that found no source.
      throw new CLIError(
        `No source files found under ${absDir}.`,
        existsSync(svDir) && mode === "auto"
          ? "No analysis data found either — run 'sourcevision analyze' first."
          : "Check the directory, or run from the project root.",
      );
    }
    throw new CLIError(
      "No architectural zones were detected, so there is nothing to draw.",
      "Run 'sourcevision analyze' with zone detection enabled (phase 3).",
    );
  }

  info("Building isometric model...");

  const model = buildIsoModel(input, {
    maxNodes: options.maxNodes,
    includeExternals: !options.noExternals,
  });

  writeFileSync(outputPath, renderIsoMap(model), "utf-8");

  result(
    `Isometric map written to ${outputPath} ` +
      `(${model.meta.shownZones} zones, ${model.edges.length} edges, ${model.meta.origin})`,
  );
}
