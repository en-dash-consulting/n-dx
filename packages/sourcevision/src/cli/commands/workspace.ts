/**
 * CLI command: sourcevision workspace
 *
 * Aggregates multiple pre-analyzed repos into a unified .sourcevision/ output.
 *
 * Usage:
 *   sourcevision workspace [root]                — aggregate from config
 *   sourcevision workspace --add <dir> [root]    — add a member
 *   sourcevision workspace --remove <dir> [root] — remove a member
 *   sourcevision workspace --status [root]       — show member status
 *
 * The root is --root=<dir> or the one argument left once flag values are
 * consumed; it defaults to ".".
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
  getWorkspaceEdgeCounts,
  toPosix,
} from "../sourcevision-core.js";
import type {WorkspaceMember} from "../sourcevision-core.js";
// ── Flag parsing ────────────────────────────────────────────────────────────

interface WorkspaceFlags {
  add: string[];
  remove: string[];
  status: boolean;
  /** The --root value, when given. */
  root?: string;
  /** Arguments left once every flag and flag value is consumed. */
  positionals: string[];
}

const VALUE_FLAGS = ["--add", "--remove", "--root"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

function missingValue(flag: ValueFlag): CLIError {
  return new CLIError(`${flag} needs a directory.`, `Usage: sourcevision workspace ${flag} <dir>`);
}

/**
 * Parse the arguments after `workspace`. Flag values are consumed in both
 * spellings (`--add x`, `--add=x`) before positionals are collected, so a
 * space-separated value is never taken for the root.
 */
export function parseWorkspaceFlags(args: string[]): WorkspaceFlags {
  const flags: WorkspaceFlags = { add: [], remove: [], status: false, positionals: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const flag = VALUE_FLAGS.find((f) => arg === f || arg.startsWith(`${f}=`));

    if (!flag) {
      if (arg === "--status") flags.status = true;
      else if (!arg.startsWith("-")) flags.positionals.push(arg);
      continue;
    }

    let value: string;
    if (arg === flag) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) throw missingValue(flag);
      value = next;
      i++;
    } else {
      value = arg.slice(flag.length + 1);
    }
    if (value === "") throw missingValue(flag);

    if (flag === "--add") flags.add.push(value);
    else if (flag === "--remove") flags.remove.push(value);
    else if (flags.root !== undefined && resolve(flags.root) !== resolve(value)) {
      throw new CLIError(`--root given twice: "${flags.root}" and "${value}".`, "Pass --root once.");
    } else flags.root = value;
  }

  return flags;
}

/**
 * The workspace root: --root, else the one positional, else ".". Throws
 * before anything is written when two positionals remain or --root and the
 * positional name different directories.
 */
export function resolveWorkspaceRoot(flags: WorkspaceFlags): string {
  const { root, positionals } = flags;

  if (positionals.length > 1) {
    throw new CLIError(
      `More than one root directory given: ${positionals.map((p) => `"${p}"`).join(" and ")}.`,
      "Pass one root, as the last argument or with --root=<dir>, and give each member its own --add.",
    );
  }

  const positional = positionals[0];
  if (root !== undefined && positional !== undefined && resolve(root) !== resolve(positional)) {
    throw new CLIError(
      `--root "${root}" disagrees with the positional root "${positional}".`,
      "Pass the root once, as --root=<dir> or as the last argument.",
    );
  }

  return root ?? positional ?? ".";
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

  showEdgeCounts(rootDir);
}

/**
 * Edge counts from the last aggregation, broken down by what produced them.
 *
 * The breakdown is the point: a workspace whose repos only ever connect
 * through npm imports has a different shape from one connected over HTTP and a
 * shared queue, and a single total hides which.
 */
function showEdgeCounts(rootDir: string): void {
  const counts = getWorkspaceEdgeCounts(rootDir);

  info("");
  if (!counts) {
    info("Edges: not aggregated yet — run 'sourcevision workspace'.");
    return;
  }

  const total = counts.none + counts.npm + counts.http + counts.infra;
  info(`Edges: ${total} total`);
  info(`  intra-repo  ${counts.none}`);
  info(`  npm         ${counts.npm}`);
  info(`  http        ${counts.http}`);
  info(`  infra       ${counts.infra}`);
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
    const { none, npm, http, infra } = result.bySource;
    info(
      `Cross-zone crossings: ${result.crossingCount} ` +
      `(intra-repo ${none}, npm ${npm}, http ${http}, infra ${infra})`,
    );
  }

  // Near-misses are printed, never silently dropped: the usual cause is a
  // member with no declared baseUrl, which the operator can only fix if they
  // can see the edge it cost them.
  if (result.withheld.length > 0) {
    info("");
    info(`Withheld ${result.withheld.length} cross-repo edge(s) below the confidence threshold:`);
    for (const w of result.withheld) {
      const to = w.toMember ? ` → ${w.toMember}` : "";
      info(`  [${w.source}] ${w.fromMember}${to}: ${w.reason}`);
    }
  }

  info("");
  info("Done.");
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** @param args every argument after `workspace`. */
export function cmdWorkspace(args: string[]): void {
  const flags = parseWorkspaceFlags(args);
  const absDir = resolve(resolveWorkspaceRoot(flags));

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
