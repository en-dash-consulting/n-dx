/**
 * PDF report generator for sourcevision analysis data.
 *
 * Produces a structured PDF with project overview, zone architecture
 * visualization, component catalog, import graph health indicators,
 * and findings.
 */

import PDFDocument from "pdfkit";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Zone,
  Components,
  ImportType,
} from "../schema/index.js";

export interface PdfReportData {
  manifest: Manifest;
  inventory: Inventory;
  imports: Imports;
  zones: Zones;
  components?: Components;
}

// ── Layout constants ────────────────────────────────────────────────────────

const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width minus margins
const COLORS = {
  title: "#1a1a2e" as const,
  heading: "#16213e" as const,
  body: "#333333" as const,
  muted: "#888888" as const,
  accent: "#0f3460" as const,
  divider: "#cccccc" as const,
  good: "#27ae60" as const,
  warn: "#f39c12" as const,
  critical: "#e74c3c" as const,
  barBg: "#e8e8e8" as const,
  cohesionBar: "#2980b9" as const,
  couplingBar: "#e67e22" as const,
};

/**
 * Generate a PDF report from sourcevision analysis data.
 * Returns the PDF as a Buffer.
 */
export async function generatePdfReport(data: PdfReportData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_MARGIN,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    info: {
      Title: `Sourcevision Report — ${projectName(data.manifest)}`,
      Author: "Sourcevision",
      Creator: "Sourcevision",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // ── Title page ────────────────────────────────────────────────────────

  doc.fontSize(28).fillColor(COLORS.title).text("Sourcevision Report", {
    align: "center",
  });
  doc.moveDown(0.5);
  doc.fontSize(18).fillColor(COLORS.accent).text(projectName(data.manifest), {
    align: "center",
  });
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(`Generated: ${new Date(data.manifest.analyzedAt).toLocaleString()}`, {
      align: "center",
    });

  const gitParts = [
    data.manifest.gitBranch,
    data.manifest.gitSha?.slice(0, 7),
  ].filter(Boolean);
  if (gitParts.length) {
    doc.text(`Git: ${gitParts.join(" @ ")}`, { align: "center" });
  }

  doc.moveDown(2);
  divider(doc);
  doc.moveDown(1);

  // ── Project Overview ──────────────────────────────────────────────────

  sectionHeading(doc, "Project Overview");

  const { summary } = data.inventory;
  const topLangs = Object.entries(summary.byLanguage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang, count]) => `${lang} (${count})`)
    .join(", ");

  bodyText(doc, `Total files: ${summary.totalFiles}`);
  bodyText(doc, `Total lines: ${summary.totalLines.toLocaleString()}`);
  bodyText(doc, `Languages: ${topLangs}`);
  bodyText(doc, `Import edges: ${data.imports.summary.totalEdges}`);
  bodyText(
    doc,
    `External packages: ${data.imports.summary.totalExternal}`
  );
  if (data.imports.summary.circularCount > 0) {
    bodyText(
      doc,
      `Circular dependencies: ${data.imports.summary.circularCount}`
    );
  }
  if (data.components) {
    bodyText(
      doc,
      `Components: ${data.components.summary.totalComponents}`
    );
    bodyText(
      doc,
      `Route modules: ${data.components.summary.totalRouteModules}`
    );
  }

  doc.moveDown(1);

  // ── Zone Architecture Visualization ─────────────────────────────────

  if (data.zones.zones.length > 0) {
    sectionHeading(doc, "Zone Architecture");

    // Zone summary metrics
    const totalZonedFiles = data.zones.zones.reduce(
      (sum, z) => sum + z.files.length,
      0
    );
    const avgCohesion =
      data.zones.zones.reduce((sum, z) => sum + z.cohesion, 0) /
      data.zones.zones.length;
    const avgCoupling =
      data.zones.zones.reduce((sum, z) => sum + z.coupling, 0) /
      data.zones.zones.length;

    bodyText(doc, `Zones: ${data.zones.zones.length}`);
    bodyText(doc, `Zoned files: ${totalZonedFiles}`);
    if (data.zones.unzoned.length > 0) {
      bodyText(doc, `Unzoned files: ${data.zones.unzoned.length}`);
    }
    bodyText(doc, `Avg cohesion: ${avgCohesion.toFixed(2)}  |  Avg coupling: ${avgCoupling.toFixed(2)}`);
    bodyText(doc, `Cross-zone imports: ${data.zones.crossings.length}`);
    doc.moveDown(0.5);

    // Visual bar chart of zone sizes with health indicators
    subHeading(doc, "Zone Size & Health");
    doc.moveDown(0.3);

    const maxFiles = Math.max(...data.zones.zones.map((z) => z.files.length));

    for (const zone of data.zones.zones) {
      ensureSpace(doc, 45);
      zoneBar(doc, zone, maxFiles);
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);

    // Legend for the bar chart
    ensureSpace(doc, 30);
    const legendY = doc.y;
    doc
      .rect(PAGE_MARGIN, legendY, 8, 8)
      .fill(COLORS.cohesionBar);
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text("Cohesion (higher = more self-contained)", PAGE_MARGIN + 12, legendY);
    const legendY2 = doc.y + 2;
    doc
      .rect(PAGE_MARGIN, legendY2, 8, 8)
      .fill(COLORS.couplingBar);
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text("Coupling (lower = less external dependency)", PAGE_MARGIN + 12, legendY2);

    doc.moveDown(1.5);

    // Zone details (descriptions + insights)
    subHeading(doc, "Zone Details");
    doc.moveDown(0.3);

    for (const zone of data.zones.zones) {
      ensureSpace(doc, 50);
      doc
        .fontSize(10)
        .fillColor(COLORS.heading)
        .text(zone.name, { continued: true })
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(`  — ${zone.files.length} files`);

      if (zone.description) {
        doc.fontSize(9).fillColor(COLORS.body).text(zone.description, {
          indent: 10,
        });
      }

      if (zone.insights && zone.insights.length > 0) {
        for (const insight of zone.insights.slice(0, 3)) {
          doc.fontSize(8).fillColor(COLORS.accent).text(`• ${insight}`, {
            indent: 15,
          });
        }
      }
      doc.moveDown(0.3);
    }

    doc.moveDown(1);
  }

  // ── Import Graph Health ─────────────────────────────────────────────

  sectionHeading(doc, "Import Graph Health");

  // Health indicators
  const importSummary = data.imports.summary;
  const healthScore = computeImportHealthScore(data.imports, data.inventory);

  ensureSpace(doc, 80);
  const healthColor =
    healthScore >= 80 ? COLORS.good : healthScore >= 50 ? COLORS.warn : COLORS.critical;
  const healthLabel =
    healthScore >= 80 ? "Healthy" : healthScore >= 50 ? "Fair" : "Needs Attention";

  doc
    .fontSize(12)
    .fillColor(healthColor)
    .text(`Health Score: ${healthScore}/100 — ${healthLabel}`);
  doc.moveDown(0.3);

  bodyText(doc, `Total import edges: ${importSummary.totalEdges}`);
  bodyText(doc, `Average imports per file: ${importSummary.avgImportsPerFile.toFixed(1)}`);
  bodyText(doc, `External packages: ${importSummary.totalExternal}`);
  bodyText(
    doc,
    `Circular dependencies: ${importSummary.circularCount}${importSummary.circularCount === 0 ? " ✓" : ""}`
  );
  doc.moveDown(0.5);

  // Import type breakdown
  const typeCounts = countImportTypes(data.imports);
  const typeEntries = Object.entries(typeCounts).filter(([, v]) => v > 0);
  if (typeEntries.length > 0) {
    subHeading(doc, "Import Types");
    for (const [type, count] of typeEntries) {
      const pct = importSummary.totalEdges > 0
        ? ((count / importSummary.totalEdges) * 100).toFixed(1)
        : "0";
      bodyText(doc, `  ${type}: ${count} (${pct}%)`);
    }
    doc.moveDown(0.5);
  }

  // Top external packages
  if (data.imports.external.length > 0) {
    subHeading(doc, "Top External Packages");
    const topPkgs = [...data.imports.external]
      .sort((a, b) => b.importedBy.length - a.importedBy.length)
      .slice(0, 10);
    for (const pkg of topPkgs) {
      ensureSpace(doc, 15);
      doc
        .fontSize(9)
        .fillColor(COLORS.body)
        .text(`${pkg.package}`, { continued: true })
        .fillColor(COLORS.muted)
        .text(`  (used by ${pkg.importedBy.length} files)`);
    }
    doc.moveDown(0.5);
  }

  // Most imported files
  if (importSummary.mostImported.length > 0) {
    subHeading(doc, "Most Imported Files");
    for (const item of importSummary.mostImported.slice(0, 10)) {
      ensureSpace(doc, 15);
      doc
        .fontSize(9)
        .fillColor(COLORS.body)
        .text(`${item.path}`, { continued: true })
        .fillColor(COLORS.muted)
        .text(`  (${item.count} imports)`);
    }
    doc.moveDown(0.5);
  }

  // Circular dependencies
  if (importSummary.circulars.length > 0) {
    subHeading(doc, "Circular Dependencies");
    for (const circ of importSummary.circulars.slice(0, 10)) {
      ensureSpace(doc, 15);
      doc
        .fontSize(9)
        .fillColor(COLORS.critical)
        .text(circ.cycle.join(" → "));
    }
    doc.moveDown(0.5);
  }

  doc.moveDown(0.5);

  // ── Component Catalog ──────────────────────────────────────────────

  if (data.components) {
    sectionHeading(doc, "Component Catalog");

    const compSummary = data.components.summary;

    bodyText(doc, `Total components: ${compSummary.totalComponents}`);
    bodyText(doc, `Total usage edges: ${compSummary.totalUsageEdges}`);
    bodyText(doc, `Route modules: ${compSummary.totalRouteModules}`);
    if (compSummary.layoutDepth > 0) {
      bodyText(doc, `Layout nesting depth: ${compSummary.layoutDepth}`);
    }
    doc.moveDown(0.5);

    // Component kind breakdown
    if (data.components.components.length > 0) {
      const kindCounts: Record<string, number> = {};
      for (const comp of data.components.components) {
        kindCounts[comp.kind] = (kindCounts[comp.kind] || 0) + 1;
      }
      const kindEntries = Object.entries(kindCounts).sort(([, a], [, b]) => b - a);

      subHeading(doc, "Component Types");
      for (const [kind, count] of kindEntries) {
        bodyText(doc, `  ${kind}: ${count}`);
      }
      doc.moveDown(0.5);
    }

    // Most used components
    if (compSummary.mostUsedComponents.length > 0) {
      subHeading(doc, "Most Used Components");
      for (const comp of compSummary.mostUsedComponents.slice(0, 10)) {
        ensureSpace(doc, 15);
        doc
          .fontSize(9)
          .fillColor(COLORS.body)
          .text(`${comp.name}`, { continued: true })
          .fillColor(COLORS.muted)
          .text(`  (${comp.usageCount} uses, ${comp.file})`);
      }
      doc.moveDown(0.5);
    }

    // Route conventions
    const conventions = Object.entries(compSummary.routeConventions).filter(
      ([, v]) => v > 0
    );
    if (conventions.length > 0) {
      subHeading(doc, "Route Conventions");
      for (const [kind, count] of conventions) {
        bodyText(doc, `  ${kind}: ${count} modules`);
      }
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5);
  }

  // ── Findings ──────────────────────────────────────────────────────────

  const findings = data.zones.findings ?? [];
  const warnAndCritical = findings.filter(
    (f) => f.severity === "warning" || f.severity === "critical"
  );

  if (warnAndCritical.length > 0) {
    sectionHeading(doc, "Findings");

    for (const f of warnAndCritical.slice(0, 20)) {
      ensureSpace(doc, 15);
      const color =
        f.severity === "critical" ? COLORS.critical : COLORS.warn;
      const label = f.severity === "critical" ? "CRITICAL" : "WARNING";
      doc
        .fontSize(9)
        .fillColor(color)
        .text(`[${label}] `, { continued: true })
        .fillColor(COLORS.body)
        .text(f.text);
    }

    doc.moveDown(1);
  }

  // ── Footer ────────────────────────────────────────────────────────────

  divider(doc);
  doc.moveDown(0.5);
  doc
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      `Generated by Sourcevision v${data.manifest.toolVersion}`,
      { align: "center" }
    );

  // ── Finalize ──────────────────────────────────────────────────────────

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function projectName(manifest: Manifest): string {
  return manifest.targetPath.split("/").pop() || "project";
}

function sectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  ensureSpace(doc, 40);
  doc.fontSize(14).fillColor(COLORS.heading).text(text);
  doc.moveDown(0.3);
}

function subHeading(doc: PDFKit.PDFDocument, text: string): void {
  ensureSpace(doc, 30);
  doc.fontSize(11).fillColor(COLORS.accent).text(text);
  doc.moveDown(0.2);
}

function bodyText(doc: PDFKit.PDFDocument, text: string): void {
  doc.fontSize(10).fillColor(COLORS.body).text(text);
}

function divider(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc
    .strokeColor(COLORS.divider)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .stroke();
}

/** Add a new page if less than `minSpace` points remain. */
function ensureSpace(doc: PDFKit.PDFDocument, minSpace: number): void {
  if (doc.y + minSpace > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
  }
}

/**
 * Draw a horizontal bar for a zone showing relative size and
 * cohesion/coupling metric indicators.
 */
function zoneBar(
  doc: PDFKit.PDFDocument,
  zone: Zone,
  maxFiles: number,
): void {
  const barX = PAGE_MARGIN + 130;
  const barMaxWidth = CONTENT_WIDTH - 130;
  const barHeight = 10;
  const ratio = maxFiles > 0 ? zone.files.length / maxFiles : 0;
  const barWidth = Math.max(ratio * barMaxWidth, 2);

  // Zone name label
  const y = doc.y;
  doc
    .fontSize(9)
    .fillColor(COLORS.heading)
    .text(zone.name, PAGE_MARGIN, y, { width: 125 });

  // File count bar (background)
  doc.rect(barX, y, barMaxWidth, barHeight).fill(COLORS.barBg);

  // File count bar (fill)
  doc.rect(barX, y, barWidth, barHeight).fill(COLORS.accent);

  // File count label
  doc
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text(`${zone.files.length} files`, barX + barMaxWidth + 5, y + 1, {
      width: 50,
    });

  // Cohesion/coupling mini-bars below
  const miniY = y + barHeight + 2;
  const miniWidth = 50;

  // Cohesion indicator
  doc.rect(barX, miniY, miniWidth, 4).fill(COLORS.barBg);
  doc
    .rect(barX, miniY, miniWidth * zone.cohesion, 4)
    .fill(COLORS.cohesionBar);

  // Coupling indicator
  doc.rect(barX + miniWidth + 10, miniY, miniWidth, 4).fill(COLORS.barBg);
  doc
    .rect(barX + miniWidth + 10, miniY, miniWidth * zone.coupling, 4)
    .fill(COLORS.couplingBar);

  doc
    .fontSize(6)
    .fillColor(COLORS.muted)
    .text(
      `coh: ${zone.cohesion.toFixed(2)}`,
      barX,
      miniY + 5,
      { width: miniWidth },
    );
  doc
    .fontSize(6)
    .fillColor(COLORS.muted)
    .text(
      `cpl: ${zone.coupling.toFixed(2)}`,
      barX + miniWidth + 10,
      miniY + 5,
      { width: miniWidth },
    );

  // Move doc.y past the bar
  doc.y = miniY + 14;
  doc.x = PAGE_MARGIN;
}

/** Count import edges by type. */
function countImportTypes(imports: Imports): Record<ImportType, number> {
  const counts: Record<ImportType, number> = {
    static: 0,
    dynamic: 0,
    require: 0,
    reexport: 0,
    type: 0,
  };
  for (const edge of imports.edges) {
    counts[edge.type]++;
  }
  return counts;
}

/**
 * Compute a 0–100 health score for the import graph based on:
 * - Circular dependency ratio (weight: 40)
 * - Average imports per file (weight: 30)
 * - External dependency ratio (weight: 30)
 */
export function computeImportHealthScore(
  imports: Imports,
  inventory: Inventory,
): number {
  const totalFiles = inventory.summary.totalFiles;
  if (totalFiles === 0) return 100;

  // Circular penalty: 0 circulars = full score, scales down
  const circularRatio = totalFiles > 0
    ? imports.summary.circularCount / totalFiles
    : 0;
  const circularScore = Math.max(0, 100 - circularRatio * 500);

  // Average imports per file: ideal range is 1-8, penalty above 15
  const avgImports = imports.summary.avgImportsPerFile;
  let avgScore: number;
  if (avgImports <= 8) {
    avgScore = 100;
  } else if (avgImports <= 15) {
    avgScore = 100 - ((avgImports - 8) / 7) * 50;
  } else {
    avgScore = Math.max(0, 50 - (avgImports - 15) * 5);
  }

  // External dependency balance: high ratio of external to internal is fine,
  // but extremely high counts penalize slightly
  const extRatio = totalFiles > 0
    ? imports.summary.totalExternal / totalFiles
    : 0;
  const extScore = extRatio <= 3 ? 100 : Math.max(0, 100 - (extRatio - 3) * 20);

  return Math.round(circularScore * 0.4 + avgScore * 0.3 + extScore * 0.3);
}
