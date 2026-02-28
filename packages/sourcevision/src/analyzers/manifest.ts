/**
 * Manifest management — TypeScript port of common.sh manifest logic.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getCurrentHead, getCurrentBranch } from "@n-dx/llm-client";
import type { Manifest, ModuleStatus } from "../schema/index.js";
import { SV_DIR, TOOL_VERSION } from "../constants.js";

function getGitInfo(dir: string): { sha?: string; branch?: string } {
  return {
    sha: getCurrentHead(dir),
    branch: getCurrentBranch(dir),
  };
}

export function readManifest(dir: string): Manifest {
  const absDir = resolve(dir);
  const manifestPath = join(absDir, SV_DIR, "manifest.json");

  if (existsSync(manifestPath)) {
    const raw = readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as Manifest;
  }

  // Create a fresh manifest
  const git = getGitInfo(absDir);
  return {
    schemaVersion: "1.0.0",
    toolVersion: TOOL_VERSION,
    analyzedAt: new Date().toISOString(),
    ...(git.sha ? { gitSha: git.sha } : {}),
    ...(git.branch ? { gitBranch: git.branch } : {}),
    targetPath: absDir,
    modules: {},
  };
}

export function writeManifest(dir: string, manifest: Manifest): void {
  const absDir = resolve(dir);
  const svDir = join(absDir, SV_DIR);
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

export function updateManifestModule(
  dir: string,
  moduleName: string,
  status: ModuleStatus
): void {
  const manifest = readManifest(dir);
  const now = new Date().toISOString();

  manifest.analyzedAt = now;

  if (!manifest.modules[moduleName]) {
    manifest.modules[moduleName] = { status };
  } else {
    manifest.modules[moduleName].status = status;
  }

  if (status === "running") {
    manifest.modules[moduleName].startedAt = now;
  } else {
    manifest.modules[moduleName].completedAt = now;
  }

  // Clear previous error on new run
  if (status === "running" || status === "complete") {
    delete manifest.modules[moduleName].error;
  }

  writeManifest(dir, manifest);
}

export function updateManifestError(
  dir: string,
  moduleName: string,
  error: string
): void {
  const manifest = readManifest(dir);
  const now = new Date().toISOString();

  if (!manifest.modules[moduleName]) {
    manifest.modules[moduleName] = { status: "error" };
  }

  manifest.modules[moduleName].status = "error";
  manifest.modules[moduleName].completedAt = now;
  manifest.modules[moduleName].error = error;

  writeManifest(dir, manifest);
}
