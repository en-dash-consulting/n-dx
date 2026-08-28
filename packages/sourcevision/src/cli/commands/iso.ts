/**
 * iso command — render the analysis as a standalone isometric architecture map.
 *
 * Opt-in only. `sourcevision analyze` never calls this: the map is a reading
 * aid, not an analysis artifact, and regenerating it on every analyze would put
 * a large generated HTML file into every diff.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { SV_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { DATA_FILES } from "../sourcevision-core.js";
import { info, result } from "../output.js";
import type {
  Classifications,
  Components,
  Imports,
  Inventory,
  Manifest,
  Zones,
} from "../sourcevision-core.js";

export interface IsoOptions {
  /** Output path. Defaults to `.sourcevision/iso-map.html`. */
  output?: string;
  /** Cap on rendered zones. */
  maxNodes?: number;
  /** Suppress the shared-dependency column. */
  noExternals?: boolean;
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
    }
  }
  return options;
}

/**
 * Render `.sourcevision/iso-map.html` from existing analysis output.
 *
 * Throws CLIError for a missing `.sourcevision/`, a missing manifest, missing
 * required data files, or an output directory that does not exist.
 */
export async function cmdIso(dir: string, options: IsoOptions = {}): Promise<void> {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);

  if (!existsSync(svDir)) {
    throw new CLIError(
      `Sourcevision directory not found in ${absDir}`,
      "Run 'n-dx init' to set up the project, or 'sourcevision init' if using sourcevision standalone.",
    );
  }

  const manifestPath = join(svDir, DATA_FILES.manifest);
  if (!existsSync(manifestPath)) {
    throw new CLIError(
      "No analysis data found. The manifest.json file is missing.",
      "Run 'sourcevision analyze' to generate analysis data before rendering the map.",
    );
  }

  const required = ["inventory", "imports", "zones"] as const;
  const missing = required.filter((key) => !existsSync(join(svDir, DATA_FILES[key])));
  if (missing.length > 0) {
    throw new CLIError(
      `Missing required analysis files: ${missing.map((k) => DATA_FILES[k]).join(", ")}`,
      "Run 'sourcevision analyze' to generate complete analysis data.",
    );
  }

  const outputPath = options.output
    ? resolve(options.output)
    : join(svDir, ISO_OUTPUT_FILE);

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    throw new CLIError(
      `Output directory does not exist: ${outputDir}`,
      "Create the directory first, or specify a different output path.",
    );
  }

  info("Loading analysis data...");

  const read = <T>(file: string): T => JSON.parse(readFileSync(join(svDir, file), "utf-8")) as T;

  const manifest = read<Manifest>(DATA_FILES.manifest);
  const inventory = read<Inventory>(DATA_FILES.inventory);
  const imports = read<Imports>(DATA_FILES.imports);
  const zones = read<Zones>(DATA_FILES.zones);

  const classifications = existsSync(join(svDir, DATA_FILES.classifications))
    ? read<Classifications>(DATA_FILES.classifications)
    : undefined;
  const components = existsSync(join(svDir, DATA_FILES.components))
    ? read<Components>(DATA_FILES.components)
    : undefined;

  if (zones.zones.length === 0) {
    throw new CLIError(
      "No architectural zones were detected, so there is nothing to draw.",
      "Run 'sourcevision analyze' with zone detection enabled (phase 3).",
    );
  }

  info("Building isometric model...");

  const { buildIsoModel } = await import("../../export/iso-model.js");
  const { renderIsoMap } = await import("../../export/iso-map.js");

  const model = buildIsoModel(
    {
      manifest,
      zones,
      inventory,
      imports,
      classifications,
      components,
      projectName: basename(absDir),
    },
    {
      maxNodes: options.maxNodes,
      includeExternals: !options.noExternals,
    },
  );

  const html = renderIsoMap(model);
  writeFileSync(outputPath, html, "utf-8");

  result(
    `Isometric map written to ${outputPath} ` +
      `(${model.meta.shownZones} zones, ${model.edges.length} edges)`,
  );
}
