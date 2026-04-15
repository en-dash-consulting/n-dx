/**
 * CLI command: sourcevision workspace
 *
 * Aggregates multiple pre-analyzed repos into a unified .sourcevision/ output.
 *
 * Usage:
 *   sourcevision workspace [dir]              — aggregate from config
 *   sourcevision workspace --add <dir> [root]  — add a member
 *   sourcevision workspace --remove <dir> [root] — remove a member
 *   sourcevision workspace --status [root]     — show member status
 */

import { resolve, basename } from "node:path";
import { info } from "../output.js";
import { CLIError } from "../errors.js";
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  resolveMembers,
  writeWorkspaceOutput,
  getWorkspaceStatus,
  toPosix,
} from "../sourcevision-core.js";
import type { WorkspaceConfig, WorkspaceMember } from "../sourcevision-core.js";

// ── Flag parsing ────────────────────────────────────────────────────────────

interface WorkspaceFlags {
  add: string[];
  remove: string[];
  status: boolean;
}

export function parseWorkspaceFlags(args: string[]): WorkspaceFlags {
  const flags: WorkspaceFlags = { add: [], remove: [], status: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--add" && i + 1 < args.length) {
      flags.add.push(args[++i]);
    } else if (arg.startsWith("--add=")) {
      flags.add.push(arg.slice("--add=".length));
    } else if (arg === "--remove" && i + 1 < args.length) {
      flags.remove.push(args[++i]);
    } else if (arg.startsWith("--remove=")) {
      flags.remove.push(arg.slice("--remove=".length));
    } else if (arg === "--status") {
      flags.status = true;
    }
  }

  return flags;
}

// ── Add member ──────────────────────────────────────────────────────────────

function addMembers(rootDir: string, paths: string[]): void {
  const config = loadWorkspaceConfig(rootDir) ?? { members: [] };

  for (const rawPath of paths) {
    const memberPath = toPosix(rawPath).replace(/\/$/, "");
    const name = basename(memberPath);

    // Check for duplicates
    const existing = config.members.find(
      (m) => toPosix(m.path) === memberPath || (m.name ?? basename(m.path)) === name,
    );

    if (existing) {
      info(`Member "${memberPath}" already configured.`);
      continue;
    }

    const member: WorkspaceMember = { path: memberPath };
    // Only set name explicitly if it differs from directory basename
    if (name !== basename(memberPath)) {
      member.name = name;
    }

    config.members.push(member);
    info(`Added workspace member: ${memberPath}`);
  }

  saveWorkspaceConfig(rootDir, config);
}

// ── Remove member ───────────────────────────────────────────────────────────

function removeMembers(rootDir: string, paths: string[]): void {
  const config = loadWorkspaceConfig(rootDir);
  if (!config) {
    throw new CLIError(
      "No workspace configuration found.",
      "Run 'sourcevision workspace --add <dir>' to create one.",
    );
  }

  for (const rawPath of paths) {
    const memberPath = toPosix(rawPath).replace(/\/$/, "");
    const idx = config.members.findIndex(
      (m) => toPosix(m.path) === memberPath || (m.name ?? basename(m.path)) === basename(memberPath),
    );

    if (idx === -1) {
      info(`Member "${memberPath}" not found in workspace configuration.`);
      continue;
    }

    const removed = config.members.splice(idx, 1)[0];
    info(`Removed workspace member: ${removed.path}`);
  }

  saveWorkspaceConfig(rootDir, config);
}

// ── Status ──────────────────────────────────────────────────────────────────

function showStatus(rootDir: string): void {
  const config = loadWorkspaceConfig(rootDir);
  if (!config || config.members.length === 0) {
    info("No workspace members configured.");
    info("Use 'sourcevision workspace --add <dir>' to add members.");
    return;
  }

  const statuses = getWorkspaceStatus(rootDir, config);

  info(`Workspace: ${statuses.length} member(s)\n`);

  for (const s of statuses) {
    const status = s.analyzed ? "✓ analyzed" : "✗ not analyzed";
    const details: string[] = [];
    if (s.analyzedAt) details.push(`at ${s.analyzedAt}`);
    if (s.zoneCount != null) details.push(`${s.zoneCount} zones`);
    if (s.fileCount != null) details.push(`${s.fileCount} files`);

    const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
    info(`  ${s.name} [${s.path}] — ${status}${detailStr}`);
  }
}

// ── Aggregate (default) ─────────────────────────────────────────────────────

function runAggregate(rootDir: string): void {
  const resolved = resolveMembers(rootDir);

  if (!resolved) {
    throw new CLIError(
      "No workspace members found.",
      "Add members with 'sourcevision workspace --add <dir>' or ensure subdirectories have .sourcevision/ analyses.",
    );
  }

  const { members, source } = resolved;

  info(`Workspace aggregation (${source === "config" ? "from config" : "auto-detected"})`);
  info(`Members: ${members.map((m) => m.prefix).join(", ")}`);
  info("");

  const result = writeWorkspaceOutput(rootDir, members);

  info(`Aggregated ${result.fileCount} files across ${result.zoneCount} zones`);
  if (result.crossingCount > 0) {
    info(`Cross-zone crossings: ${result.crossingCount}`);
  }
  info("");
  info("Done.");
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function cmdWorkspace(targetDir: string, extraArgs: string[]): void {
  const absDir = resolve(targetDir);
  const flags = parseWorkspaceFlags(extraArgs);

  if (flags.add.length > 0) {
    addMembers(absDir, flags.add);
    return;
  }

  if (flags.remove.length > 0) {
    removeMembers(absDir, flags.remove);
    return;
  }

  if (flags.status) {
    showStatus(absDir);
    return;
  }

  // Default: run aggregation
  runAggregate(absDir);
}
