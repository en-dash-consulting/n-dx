import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

export const DASHBOARD_ARTIFACT_FILENAME = "dashboard-artifacts.json";

const SOURCEVISION_DASHBOARD_INPUT_FILES = [
  "manifest.json",
  "inventory.json",
  "imports.json",
  "zones.json",
  "components.json",
  "callgraph.json",
];

/**
 * Refresh metadata describing SourceVision-derived dashboard artifacts.
 * The web UI can inspect this file to confirm data refresh recency.
 */
export function refreshSourcevisionDashboardArtifacts(projectDir) {
  const absDir = resolve(projectDir);
  const svDir = join(absDir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });

  const refreshedAt = new Date().toISOString();
  const sourceFiles = SOURCEVISION_DASHBOARD_INPUT_FILES.map((name) => {
    const filePath = join(svDir, name);
    if (!existsSync(filePath)) {
      return { name, exists: false, mtime: null };
    }
    const stat = statSync(filePath);
    return {
      name,
      exists: true,
      mtime: Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : null,
    };
  });

  const sourceFileCount = sourceFiles.filter((f) => f.exists).length;
  const artifact = {
    schemaVersion: "1.0.0",
    artifact: "sourcevision-dashboard",
    refreshedAt,
    sourcevision: {
      inputFiles: sourceFiles,
      presentInputCount: sourceFileCount,
      missingInputCount: sourceFiles.length - sourceFileCount,
    },
  };

  const artifactPath = join(svDir, DASHBOARD_ARTIFACT_FILENAME);
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n", "utf-8");

  return { artifactPath, refreshedAt };
}
