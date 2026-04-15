/**
 * export-pdf command — generate a PDF report from sourcevision analysis data.
 *
 * Validates that analysis has been run, loads the data, generates a PDF,
 * and writes it to the specified output path.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { SV_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { DATA_FILES } from "../sourcevision-core.js";
import { info, result } from "../output.js";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Components,
} from "../sourcevision-core.js";

export interface ExportPdfOptions {
  output?: string;
}

/**
 * Export sourcevision analysis data as a PDF report.
 *
 * Throws CLIError for:
 * - Missing .sourcevision/ directory
 * - Missing manifest.json (no analysis run yet)
 * - Missing required data files (inventory, imports, zones)
 * - Invalid output directory
 */
export function cmdExportPdf(
  dir: string,
  options?: ExportPdfOptions
): Promise<void> | void {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);

  // ── Validate .sourcevision/ exists ────────────────────────────────────

  if (!existsSync(svDir)) {
    throw new CLIError(
      `Sourcevision directory not found in ${absDir}`,
      "Run 'n-dx init' to set up the project, or 'sourcevision init' if using sourcevision standalone.",
    );
  }

  // ── Validate manifest exists ──────────────────────────────────────────

  const manifestPath = join(svDir, DATA_FILES.manifest);
  if (!existsSync(manifestPath)) {
    throw new CLIError(
      "No analysis data found. The manifest.json file is missing.",
      "Run 'sourcevision analyze' to generate analysis data before exporting.",
    );
  }

  // ── Validate required data files ──────────────────────────────────────

  const required = ["inventory", "imports", "zones"] as const;
  const missing = required.filter(
    (key) => !existsSync(join(svDir, DATA_FILES[key]))
  );

  if (missing.length > 0) {
    throw new CLIError(
      `Missing required analysis files: ${missing.map((k) => DATA_FILES[k]).join(", ")}`,
      "Run 'sourcevision analyze' to generate complete analysis data.",
    );
  }

  // ── Validate output path ──────────────────────────────────────────────

  const outputPath = options?.output
    ? resolve(options.output)
    : join(svDir, "report.pdf");

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    throw new CLIError(
      `Output directory does not exist: ${outputDir}`,
      "Create the directory first, or specify a different output path.",
    );
  }

  // ── Load data ─────────────────────────────────────────────────────────

  info("Loading analysis data...");

  const manifest: Manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8")
  );
  const inventory: Inventory = JSON.parse(
    readFileSync(join(svDir, DATA_FILES.inventory), "utf-8")
  );
  const imports: Imports = JSON.parse(
    readFileSync(join(svDir, DATA_FILES.imports), "utf-8")
  );
  const zones: Zones = JSON.parse(
    readFileSync(join(svDir, DATA_FILES.zones), "utf-8")
  );

  let components: Components | undefined;
  const componentsPath = join(svDir, DATA_FILES.components);
  if (existsSync(componentsPath)) {
    components = JSON.parse(readFileSync(componentsPath, "utf-8"));
  }

  // ── Generate PDF (async) ──────────────────────────────────────────────

  info("Generating PDF report...");

  return import("../../export/pdf-report.js").then(async ({ generatePdfReport }) => {
    const buffer = await generatePdfReport({
      manifest,
      inventory,
      imports,
      zones,
      components,
    });

    writeFileSync(outputPath, buffer);
    result(`PDF report written to ${outputPath}`);
  });
}
