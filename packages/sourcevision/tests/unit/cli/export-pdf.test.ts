import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { cmdExportPdf } from "../../../src/cli/commands/export-pdf.js";
import { CLIError } from "../../../src/cli/errors.js";

describe("cmdExportPdf", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-export-pdf-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws CLIError when .sourcevision/ does not exist", () => {
    expect(() => cmdExportPdf(tmpDir)).toThrow(CLIError);
    expect(() => cmdExportPdf(tmpDir)).toThrow(/Sourcevision directory not found/);
  });

  it("throws CLIError when manifest.json is missing", () => {
    mkdirSync(join(tmpDir, ".n-dx/sourcevision"), { recursive: true });
    expect(() => cmdExportPdf(tmpDir)).toThrow(CLIError);
    expect(() => cmdExportPdf(tmpDir)).toThrow(/No analysis data found/);
  });

  it("throws CLIError when required analysis files are missing", () => {
    const svDir = join(tmpDir, ".n-dx/sourcevision");
    mkdirSync(svDir, { recursive: true });
    writeFileSync(
      join(svDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        toolVersion: "0.1.0",
        analyzedAt: new Date().toISOString(),
        targetPath: tmpDir,
        modules: {},
      })
    );
    // No inventory.json, imports.json, or zones.json
    expect(() => cmdExportPdf(tmpDir)).toThrow(CLIError);
    expect(() => cmdExportPdf(tmpDir)).toThrow(/Missing required analysis/);
  });

  it("generates PDF when analysis data is present", async () => {
    setupAnalysisData(tmpDir);
    const outputPath = join(tmpDir, "report.pdf");

    await cmdExportPdf(tmpDir, { output: outputPath });

    expect(existsSync(outputPath)).toBe(true);
  });

  it("defaults output to .sourcevision/report.pdf when no path given", async () => {
    setupAnalysisData(tmpDir);

    await cmdExportPdf(tmpDir);

    expect(existsSync(join(tmpDir, ".n-dx/sourcevision", "report.pdf"))).toBe(true);
  });

  it("throws CLIError when output directory does not exist", () => {
    setupAnalysisData(tmpDir);
    const badPath = join(tmpDir, "nonexistent", "report.pdf");

    expect(() => cmdExportPdf(tmpDir, { output: badPath })).toThrow(CLIError);
    expect(() => cmdExportPdf(tmpDir, { output: badPath })).toThrow(
      /Output directory does not exist/
    );
  });
});

/** Helper: write minimal valid analysis data to .sourcevision/ */
function setupAnalysisData(dir: string): void {
  const svDir = join(dir, ".n-dx/sourcevision");
  mkdirSync(svDir, { recursive: true });

  writeFileSync(
    join(svDir, "manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: new Date().toISOString(),
      targetPath: dir,
      modules: {
        inventory: { status: "complete" },
        imports: { status: "complete" },
        zones: { status: "complete" },
      },
    })
  );

  writeFileSync(
    join(svDir, "inventory.json"),
    JSON.stringify({
      files: [
        {
          path: "src/index.ts",
          size: 100,
          language: "TypeScript",
          lineCount: 10,
          hash: "abc123",
          role: "source",
          category: "main",
        },
      ],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { main: 1 },
      },
    })
  );

  writeFileSync(
    join(svDir, "imports.json"),
    JSON.stringify({
      edges: [],
      external: [],
      summary: {
        totalEdges: 0,
        totalExternal: 0,
        circularCount: 0,
        circulars: [],
        mostImported: [],
        avgImportsPerFile: 0,
      },
    })
  );

  writeFileSync(
    join(svDir, "zones.json"),
    JSON.stringify({
      zones: [
        {
          id: "zone-1",
          name: "Core",
          description: "Core module",
          files: ["src/index.ts"],
          entryPoints: ["src/index.ts"],
          cohesion: 0.8,
          coupling: 0.2,
        },
      ],
      crossings: [],
      unzoned: [],
    })
  );
}
