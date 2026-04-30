#!/usr/bin/env node

import { resolve, extname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { usage } from "./commands/constants.js";
import { showCommandHelp } from "./help.js";
import { CLIError, handleCLIError, requireRexDir } from "./errors.js";
import { setQuiet } from "./output.js";
import { CLI_ERROR_CODES, formatTypoSuggestion, suppressKnownDeprecations } from "@n-dx/llm-client";
import { isItemLevel } from "../schema/index.js";
import { join } from "node:path";

suppressKnownDeprecations();

/** Post-write health warning — lazy-loaded to avoid startup cost. */
async function postWriteHealthWarning(dir: string, isJson: boolean): Promise<void> {
  try {
    const { warnOnStructureDegradation } = await import("./commands/health-warning.js");
    const { resolveStore } = await import("../store/index.js");
    const REX_DIR = ".rex";
    const store = await resolveStore(join(dir, REX_DIR));
    await warnOnStructureDegradation(store, isJson);
  } catch {
    // Non-fatal
  }
}

/**
 * Read all data from stdin when input is piped (not a TTY).
 * Returns trimmed text, or empty string if stdin is a terminal.
 */
function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8").trim()));
    process.stdin.on("error", reject);
  });
}

/** Keys that accept multiple values (accumulated into arrays). */
const MULTI_VALUE_KEYS = new Set(["file"]);
/** Keys that expect a following value when provided as `--key value`. */
const VALUE_KEYS = new Set([
  "model",
  "format",
  "parent",
  "title",
  "description",
  "status",
  "priority",
  "epic",
  "chunk",
  "chunk-size",
  "acknowledge",
  "adapter",
  "direction",
  "output",
  "host",
  "port",
  "group-by",
  "accept-llm",
  ...MULTI_VALUE_KEYS,
]);

function parseArgs(argv: string[]): {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
  multiFlags: Record<string, string[]>;
} {
  const flags: Record<string, string> = {};
  const multiFlags: Record<string, string[]> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        const val = arg.slice(eq + 1);
        if (MULTI_VALUE_KEYS.has(key)) {
          (multiFlags[key] ??= []).push(val);
        }
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (VALUE_KEYS.has(key) && next && !next.startsWith("-")) {
          if (MULTI_VALUE_KEYS.has(key)) {
            (multiFlags[key] ??= []).push(next);
          }
          flags[key] = next;
          i++; // consume the value token
        } else {
          flags[key] = "true";
        }
      }
    } else if (arg === "-h") {
      flags.help = "true";
    } else if (arg === "-q") {
      flags.quiet = "true";
    } else if (arg === "-y") {
      flags.yes = "true";
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags, multiFlags };
}

/** Resolve project directory from the last positional argument or cwd. */
function resolveDir(positional: string[]): string {
  const last = positional[positional.length - 1];
  if (last && !last.startsWith("-")) {
    return resolve(last);
  }
  return process.cwd();
}

/**
 * Resolve and dispatch the `add` command.
 *
 * The add command supports three modes with complex argument resolution:
 * 1. Manual mode: `rex add task --title="..." --parent=<id>`
 * 2. Smart mode:  `rex add "description" [dir]`
 * 3. File mode:   `rex add --file=ideas.txt [dir]`
 */
async function dispatchAdd(
  positional: string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]>,
): Promise<void> {
  const firstArg = positional[0];
  const hasFileFlag = !!(multiFlags.file?.length || flags.file);

  // Read piped stdin if available (non-blocking for TTY)
  const stdinText = await readStdin();

  // Manual mode detection:
  //   1. Positional level:  rex add task --title="..." --parent=<id>
  //   2. --level flag:      rex add --level=task --title="..." --parent=<id>
  //   3. --title flag only: rex add --title="..." (defaults to epic)
  const positionalLevel = firstArg && isItemLevel(firstArg);
  const flagLevel = flags.level && isItemLevel(flags.level);
  const isManualMode = positionalLevel || flagLevel || flags.title;

  if (isManualMode) {
    const level = positionalLevel ? firstArg : flags.level;
    const dir =
      positional.length > (positionalLevel ? 1 : 0)
        ? resolve(positional[positional.length - 1])
        : process.cwd();
    const { cmdAdd } = await import("./commands/add.js");
    await cmdAdd(dir, level, flags);
    return;
  }

  if (firstArg || flags.description || hasFileFlag || stdinText) {
    const { dir, descriptions } = resolveSmartAddArgs(positional, flags, multiFlags, stdinText);

    const hasDetectedFiles = (multiFlags.file?.length ?? 0) > (hasFileFlag ? 1 : 0);
    if (descriptions.length === 0 && !hasFileFlag && !hasDetectedFiles) {
      throw new CLIError(
        "Missing description or --file flag.",
        'Usage: rex add <level> --title="..." or rex add "<description>" ["<desc2>" ...] or rex add --file=ideas.txt or echo "desc" | rex add',
      );
    }
    const { cmdSmartAdd } = await import("./commands/smart-add.js");
    await cmdSmartAdd(dir, descriptions, flags, multiFlags);
    return;
  }

  throw new CLIError(
    "Missing level, description, or --file flag.",
    'Usage: rex add <level> --title="..." or rex add "<description>" ["<desc2>" ...] or rex add --file=ideas.txt or echo "desc" | rex add',
  );
}

/**
 * Resolve smart-add arguments: separate directory from descriptions,
 * auto-detect file paths in positional args, and collect all description sources.
 */
function resolveSmartAddArgs(
  positional: string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]>,
  stdinText: string,
): { dir: string; descriptions: string[] } {
  // Last positional may be a dir path — check if it's an existing directory
  let descParts = [...positional];
  let dir = process.cwd();
  const last = descParts[descParts.length - 1];
  if (last) {
    try {
      if (existsSync(last) && statSync(last).isDirectory()) {
        dir = resolve(last);
        descParts = descParts.slice(0, -1);
      }
    } catch {
      // Not a valid path — include in descriptions
    }
  }

  // Auto-detect file paths in positional arguments:
  // If a positional arg has a supported extension and the file exists,
  // treat it as a file import (as if --file was used).
  const FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text", ".json", ".yaml", ".yml"]);
  const detectedFiles: string[] = [];
  const remainingDescs: string[] = [];
  for (const part of descParts) {
    const ext = extname(part).toLowerCase();
    if (FILE_EXTENSIONS.has(ext) && existsSync(part)) {
      detectedFiles.push(part);
    } else {
      remainingDescs.push(part);
    }
  }

  // Merge detected files into the --file multiFlags
  if (detectedFiles.length > 0) {
    const existingFiles = multiFlags.file ?? (flags.file ? [flags.file] : []);
    multiFlags.file = [...existingFiles, ...detectedFiles];
  }

  // Collect descriptions: remaining positional args + --description flag + piped stdin
  const descriptions: string[] = [...remainingDescs];
  if (flags.description) {
    descriptions.push(flags.description);
  }
  if (stdinText) {
    descriptions.push(stdinText);
  }

  return { dir, descriptions };
}

/**
 * Resolve and dispatch the `remove` command.
 *
 * Supports both `rex remove <id>` (auto-detect level) and
 * `rex remove <level> <id>` (explicit level).
 */
async function dispatchRemove(
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const REMOVABLE_LEVELS = new Set(["epic", "feature", "task"]);
  const firstArg = positional[0];
  let removeLevel: string | undefined;
  let removeId: string;

  if (firstArg && REMOVABLE_LEVELS.has(firstArg)) {
    removeLevel = firstArg;
    removeId = positional[1];
    if (!removeId) {
      throw new CLIError(
        `Missing ${removeLevel} ID.`,
        `Usage: rex remove ${removeLevel} <id>`,
      );
    }
  } else if (firstArg) {
    removeId = firstArg;
  } else {
    throw new CLIError(
      "Missing item ID.",
      "Usage: rex remove <epic|feature|task> <id> or rex remove <id>",
    );
  }

  const removeDir =
    positional.length > (removeLevel ? 2 : 1)
      ? resolve(positional[positional.length - 1])
      : process.cwd();
  requireRexDir(removeDir);

  const { cmdRemove } = await import("./commands/remove.js");
  await cmdRemove(removeDir, removeId, removeLevel, flags);
}

/**
 * Strip trailing directory argument from positional args for the adapter command.
 */
function resolveAdapterPositional(positional: string[]): string[] {
  const adapterPositional = [...positional];
  if (adapterPositional.length > 0) {
    const last = adapterPositional[adapterPositional.length - 1];
    try {
      if (existsSync(last) && statSync(last).isDirectory()) {
        adapterPositional.pop();
      }
    } catch {
      // Not a directory — keep it
    }
  }
  return adapterPositional;
}

/** Dispatch a parsed CLI command to its handler. */
async function dispatchCommand(
  command: string,
  positional: string[],
  flags: Record<string, string>,
  multiFlags: Record<string, string[]>,
): Promise<void> {
  // Ensure .rex/ exists for commands that need it.
  // init creates it; analyze handles its own graceful fallback.
  // Commands whose first positional arg is an ID (not a dir) must handle
  // their own dir resolution and requireRexDir check inside the case block.
  const SKIP_DIR_CHECK = new Set([
    "init", "analyze", "import", "update", "move", "add", "reshape", "remove",
    "parse-md",
  ]);
  if (!SKIP_DIR_CHECK.has(command)) {
    requireRexDir(resolveDir(positional));
  }

  switch (command) {
    case "init": {
      const { cmdInit } = await import("./commands/init.js");
      await cmdInit(resolveDir(positional), flags);
      break;
    }
    case "status": {
      const { cmdStatus } = await import("./commands/status.js");
      await cmdStatus(resolveDir(positional), flags);
      break;
    }
    case "next": {
      const { cmdNext } = await import("./commands/next.js");
      await cmdNext(resolveDir(positional), flags);
      break;
    }
    case "add": {
      await dispatchAdd(positional, flags, multiFlags);
      await postWriteHealthWarning(resolveDir(positional), flags.format === "json");
      break;
    }
    case "update": {
      const id = positional[0];
      if (!id) {
        throw new CLIError(
          "Missing item ID.",
          "Usage: rex update <id> --status=<s> --priority=<p> --title=<t>",
        );
      }
      const dir =
        positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
      const { cmdUpdate } = await import("./commands/update.js");
      await cmdUpdate(dir, id, flags);
      break;
    }
    case "move": {
      const id = positional[0];
      if (!id) {
        throw new CLIError(
          "Missing item ID.",
          "Usage: rex move <id> --parent=<new-parent-id>",
        );
      }
      const dir =
        positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
      const { cmdMove } = await import("./commands/move.js");
      await cmdMove(dir, id, flags);
      break;
    }
    case "remove": {
      await dispatchRemove(positional, flags);
      break;
    }
    case "reshape": {
      const { cmdReshape } = await import("./commands/reshape.js");
      await cmdReshape(resolveDir(positional), flags);
      break;
    }
    case "prune": {
      const { cmdPrune } = await import("./commands/prune.js");
      await cmdPrune(resolveDir(positional), flags);
      break;
    }
    case "validate": {
      const { cmdValidate } = await import("./commands/validate.js");
      await cmdValidate(resolveDir(positional), flags);
      break;
    }
    case "fix": {
      const { cmdFix } = await import("./commands/fix.js");
      await cmdFix(resolveDir(positional), flags);
      break;
    }
    case "sync": {
      const { cmdSync } = await import("./commands/sync.js");
      await cmdSync(resolveDir(positional), flags);
      break;
    }
    case "usage": {
      const { cmdUsage } = await import("./commands/usage.js");
      await cmdUsage(resolveDir(positional), flags);
      break;
    }
    case "report": {
      const { cmdReport } = await import("./commands/report.js");
      await cmdReport(resolveDir(positional), flags);
      break;
    }
    case "verify": {
      const { cmdVerify } = await import("./commands/verify.js");
      await cmdVerify(resolveDir(positional), flags);
      break;
    }
    case "recommend": {
      const { cmdRecommend } = await import("./commands/recommend.js");
      await cmdRecommend(resolveDir(positional), flags);
      break;
    }
    case "import":
    case "analyze": {
      const { cmdAnalyze } = await import("./commands/analyze.js");
      await cmdAnalyze(resolveDir(positional), flags, multiFlags);
      await postWriteHealthWarning(resolveDir(positional), flags.format === "json");
      break;
    }
    case "adapter": {
      const dir = resolveDir(positional);
      const { cmdAdapter } = await import("./commands/adapter.js");
      await cmdAdapter(dir, resolveAdapterPositional(positional), flags);
      break;
    }
    case "reorganize": {
      const { cmdReorganize } = await import("./commands/reorganize.js");
      await cmdReorganize(resolveDir(positional), flags);
      break;
    }
    case "health": {
      const { cmdHealth } = await import("./commands/health.js");
      await cmdHealth(resolveDir(positional), flags);
      break;
    }
    case "mcp": {
      const { startMcpServer } = await import("./mcp.js");
      await startMcpServer(resolveDir(positional));
      break;
    }
    case "migrate-to-md": {
      const { cmdMigrateToMd } = await import("./commands/migrate-to-md.js");
      await cmdMigrateToMd(resolveDir(positional));
      break;
    }
    case "migrate-to-folder-tree": {
      const { cmdMigrateToFolderTree } = await import("./commands/migrate-to-folder-tree.js");
      await cmdMigrateToFolderTree(resolveDir(positional), flags);
      break;
    }
    case "migrate-folder-tree-filenames": {
      const { cmdMigrateFolderTreeFilenames } = await import("./commands/migrate-folder-tree-filenames.js");
      await cmdMigrateFolderTreeFilenames(resolveDir(positional), flags);
      break;
    }
    case "parse-md": {
      const { cmdParseMd } = await import("./commands/parse-md.js");
      const stdinInput = flags.stdin === "true" ? await readStdin() : "";
      await cmdParseMd(resolveDir(positional), flags, stdinInput);
      break;
    }
    case "backfill-commit-attribution": {
      const { cmdBackfillCommitAttribution } = await import("./commands/backfill-commit-attribution.js");
      await cmdBackfillCommitAttribution(resolveDir(positional), flags);
      break;
    }
    default: {
      // Check if the user tried an ndx-only orchestration command
      const NDX_ONLY_COMMANDS: Record<string, string> = {
        plan: "ndx plan",
        work: "ndx work",
        "self-heal": "ndx self-heal",
        start: "ndx start",
        ci: "ndx ci",
        dev: "ndx dev",
        refresh: "ndx refresh",
        export: "ndx export",
        config: "ndx config",
      };
      if (command in NDX_ONLY_COMMANDS) {
        throw new CLIError(
          `"${command}" is an orchestrator command. Run: ${NDX_ONLY_COMMANDS[command]} .`,
        );
      }

      const REX_COMMANDS = [
        "init", "status", "next", "add", "update", "move", "remove", "reshape",
        "prune", "validate", "fix", "sync", "usage", "report", "verify",
        "recommend", "analyze", "import", "adapter", "reorganize", "health", "mcp",
        "migrate-to-md", "migrate-to-folder-tree", "migrate-folder-tree-filenames", "parse-md",
        "backfill-commit-attribution",
      ];
      const typoHint = formatTypoSuggestion(command, REX_COMMANDS, "rex ");
      throw new CLIError(
        `Unknown command: ${command}`,
        typoHint ?? "Run 'rex --help' to see available commands.",
        CLI_ERROR_CODES.UNKNOWN_COMMAND,
      );
    }
  }
}

async function main(): Promise<void> {
  const { command, positional, flags, multiFlags } = parseArgs(process.argv.slice(2));

  // Show help: per-command help when a command is given, else top-level usage.
  if (!command) {
    usage();
    process.exit(0);
  }
  if (flags.help) {
    if (!showCommandHelp(command)) {
      usage();
    }
    process.exit(0);
  }

  setQuiet(flags.quiet === "true");

  try {
    await dispatchCommand(command, positional, flags, multiFlags);
  } catch (err) {
    handleCLIError(err);
  }
}

main();
