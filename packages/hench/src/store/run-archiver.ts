/**
 * Run file archival and compression.
 *
 * Compresses old run files (`.json` → `.json.gz`) to reduce filesystem
 * overhead while preserving all historical data. Compressed files are
 * transparently readable by the run store and aggregation systems.
 *
 * ## Design
 *
 * Uses Node.js built-in `zlib` (gzip) — no external dependencies. Files
 * are compressed in-place (same `runs/` directory) with a `.json.gz`
 * extension. The original `.json` file is removed after successful
 * compression.
 *
 * Archival is an explicit operation (not automatic on every run) so
 * callers can control when the I/O cost is incurred. Configuration
 * lives in `.n-dx.json` under the `archival` key.
 *
 * @module hench/store/run-archiver
 */

import { join } from "node:path";
import { readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for run file archival. */
export interface ArchivalConfig {
  /** Number of days after which completed run files are compressed. */
  maxAgeDays: number;
  /** Whether archival is enabled. */
  enabled: boolean;
}

/** Result of a single file compression. */
export interface CompressedFileResult {
  /** Original filename (e.g., `"abc123.json"`). */
  file: string;
  /** Original file size in bytes. */
  originalSize: number;
  /** Compressed file size in bytes. */
  compressedSize: number;
}

/** Summary of an archival pass. */
export interface ArchivalResult {
  /** Number of files compressed. */
  filesCompressed: number;
  /** Number of files skipped (too recent, already compressed, or errors). */
  filesSkipped: number;
  /** Total bytes saved (original - compressed). */
  bytesSaved: number;
  /** Per-file compression results. */
  details: CompressedFileResult[];
  /** Files that failed to archive (filename → error message). */
  errors: Array<{ file: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ARCHIVAL_CONFIG: ArchivalConfig = {
  maxAgeDays: 30,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

/**
 * Load archival configuration from `.n-dx.json`.
 *
 * Reads the `archival` section from the project config file. Missing
 * or invalid fields fall back to {@link DEFAULT_ARCHIVAL_CONFIG}.
 *
 * @param projectDir Project root directory containing `.n-dx.json`.
 */
export async function loadArchivalConfig(
  projectDir: string,
): Promise<ArchivalConfig> {
  try {
    const raw = await readFile(join(projectDir, ".n-dx.json"), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const section = data.archival as Record<string, unknown> | undefined;
    if (!section || typeof section !== "object") {
      return { ...DEFAULT_ARCHIVAL_CONFIG };
    }
    return {
      maxAgeDays:
        typeof section.maxAgeDays === "number" && section.maxAgeDays > 0
          ? section.maxAgeDays
          : DEFAULT_ARCHIVAL_CONFIG.maxAgeDays,
      enabled:
        typeof section.enabled === "boolean"
          ? section.enabled
          : DEFAULT_ARCHIVAL_CONFIG.enabled,
    };
  } catch {
    return { ...DEFAULT_ARCHIVAL_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// Compression utilities
// ---------------------------------------------------------------------------

/**
 * Read a gzip-compressed JSON file and parse it.
 *
 * @param filePath Absolute path to a `.json.gz` file.
 * @returns Parsed JSON data.
 */
export async function readCompressedJSON(filePath: string): Promise<unknown> {
  const compressed = await readFile(filePath);
  const decompressed = await gunzipAsync(compressed);
  return JSON.parse(decompressed.toString("utf-8"));
}

/**
 * Compress a JSON file in-place: writes `.json.gz` alongside the original,
 * then removes the original `.json` file.
 *
 * @param runsDir The runs directory.
 * @param filename The `.json` filename to compress.
 * @returns Compression result with size statistics.
 */
export async function compressRunFile(
  runsDir: string,
  filename: string,
): Promise<CompressedFileResult> {
  const sourcePath = join(runsDir, filename);
  const destPath = join(runsDir, filename.replace(/\.json$/, ".json.gz"));

  const raw = await readFile(sourcePath);
  const compressed = await gzipAsync(raw);

  // Write compressed file first, then remove original (atomic-ish)
  await writeFile(destPath, compressed);
  await unlink(sourcePath);

  return {
    file: filename,
    originalSize: raw.length,
    compressedSize: compressed.length,
  };
}

// ---------------------------------------------------------------------------
// Archival identification
// ---------------------------------------------------------------------------

/**
 * Identify run files in a directory that are eligible for archival.
 *
 * A file is eligible if:
 * 1. It has a `.json` extension (not already compressed)
 * 2. It is not a metadata file (e.g., checkpoint)
 * 3. Its modification time is older than `maxAgeDays` from now
 *
 * @param runsDir Path to the `.hench/runs/` directory.
 * @param maxAgeDays Threshold in days.
 * @param now Optional reference time (for testing). Defaults to `Date.now()`.
 * @returns Array of filenames eligible for archival.
 */
export async function identifyArchivableRuns(
  runsDir: string,
  maxAgeDays: number,
  now?: number,
): Promise<string[]> {
  const cutoff = (now ?? Date.now()) - maxAgeDays * 24 * 60 * 60 * 1000;

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter(
    (f) => f.endsWith(".json") && !f.startsWith("."),
  );

  const eligible: string[] = [];

  await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const st = await stat(join(runsDir, file));
        if (st.mtimeMs < cutoff) {
          eligible.push(file);
        }
      } catch {
        // File disappeared between readdir and stat — skip
      }
    }),
  );

  // Sort for deterministic output
  eligible.sort();
  return eligible;
}

// ---------------------------------------------------------------------------
// Main archival orchestrator
// ---------------------------------------------------------------------------

/**
 * Archive old run files by compressing them with gzip.
 *
 * Scans the `runs/` directory, identifies files older than the configured
 * threshold, and compresses each one (`.json` → `.json.gz`). The original
 * uncompressed file is removed after successful compression.
 *
 * All token usage metadata is fully preserved in the compressed file.
 *
 * @param runsDir Path to the `.hench/runs/` directory.
 * @param config Archival configuration.
 * @param now Optional reference time (for testing).
 * @returns Summary of the archival operation.
 */
export async function archiveOldRuns(
  runsDir: string,
  config: ArchivalConfig = DEFAULT_ARCHIVAL_CONFIG,
  now?: number,
): Promise<ArchivalResult> {
  if (!config.enabled) {
    return {
      filesCompressed: 0,
      filesSkipped: 0,
      bytesSaved: 0,
      details: [],
      errors: [],
    };
  }

  const eligible = await identifyArchivableRuns(runsDir, config.maxAgeDays, now);

  // Count total .json files for skip calculation
  let totalJsonFiles: string[];
  try {
    const allFiles = await readdir(runsDir);
    totalJsonFiles = allFiles.filter(
      (f) => f.endsWith(".json") && !f.startsWith("."),
    );
  } catch {
    totalJsonFiles = [];
  }

  const details: CompressedFileResult[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of eligible) {
    try {
      const result = await compressRunFile(runsDir, file);
      details.push(result);
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const bytesSaved = details.reduce(
    (sum, d) => sum + (d.originalSize - d.compressedSize),
    0,
  );

  return {
    filesCompressed: details.length,
    filesSkipped: totalJsonFiles.length - eligible.length,
    bytesSaved,
    details,
    errors,
  };
}
