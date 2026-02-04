#!/usr/bin/env node

import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { usage } from "./commands/constants.js";
import { CLIError, handleCLIError, requireRexDir } from "./errors.js";
import { setQuiet } from "./output.js";

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

  for (const arg of argv) {
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
        flags[arg.slice(2)] = "true";
      }
    } else if (arg === "-h") {
      flags.help = "true";
    } else if (arg === "-q") {
      flags.quiet = "true";
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags, multiFlags };
}

async function main(): Promise<void> {
  const { command, positional, flags, multiFlags } = parseArgs(process.argv.slice(2));

  // Show top-level help if no command, or --help without a command that
  // handles its own help (e.g. adapter has subcommand-level help).
  const SELF_HELP_COMMANDS = new Set(["adapter"]);
  if (!command || (flags.help && !SELF_HELP_COMMANDS.has(command))) {
    usage();
    process.exit(0);
  }

  setQuiet(flags.quiet === "true");

  // Resolve dir: last positional arg or cwd
  const resolveDir = (): string => {
    const last = positional[positional.length - 1];
    if (last && !last.startsWith("-")) {
      return resolve(last);
    }
    return process.cwd();
  };

  try {
    // Ensure .rex/ exists for commands that need it.
    // init creates it; analyze handles its own graceful fallback.
    // Commands whose first positional arg is an ID (not a dir) must handle
    // their own dir resolution and requireRexDir check inside the case block.
    const SKIP_DIR_CHECK = new Set(["init", "analyze", "update", "move"]);
    if (!SKIP_DIR_CHECK.has(command)) {
      requireRexDir(resolveDir());
    }

    switch (command) {
      case "init": {
        const { cmdInit } = await import("./commands/init.js");
        await cmdInit(resolveDir(), flags);
        break;
      }
      case "status": {
        const { cmdStatus } = await import("./commands/status.js");
        await cmdStatus(resolveDir(), flags);
        break;
      }
      case "next": {
        const { cmdNext } = await import("./commands/next.js");
        await cmdNext(resolveDir(), flags);
        break;
      }
      case "add": {
        const VALID_LEVELS = new Set(["epic", "feature", "task", "subtask"]);
        const firstArg = positional[0];
        const hasFileFlag = !!(multiFlags.file?.length || flags.file);

        // Read piped stdin if available (non-blocking for TTY)
        const stdinText = await readStdin();

        // Manual mode detection:
        //   1. Positional level:  rex add task --title="..." --parent=<id>
        //   2. --level flag:      rex add --level=task --title="..." --parent=<id>
        //   3. --title flag only: rex add --title="..." (defaults to epic)
        const positionalLevel = firstArg && VALID_LEVELS.has(firstArg);
        const flagLevel = flags.level && VALID_LEVELS.has(flags.level);
        const isManualMode = positionalLevel || flagLevel || flags.title;

        if (isManualMode) {
          // Manual mode: bypass LLM processing entirely
          const level = positionalLevel
            ? firstArg
            : flags.level;
          const dir =
            positional.length > (positionalLevel ? 1 : 0)
              ? resolve(positional[positional.length - 1])
              : process.cwd();
          const { cmdAdd } = await import("./commands/add.js");
          await cmdAdd(dir, level, flags);
        } else if (firstArg || flags.description || hasFileFlag || stdinText) {
          // Smart mode: rex add "desc1" "desc2" ... [dir]
          //   or file mode: rex add --file=ideas.txt [dir]
          //   or piped:     echo "desc" | rex add [dir]
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

          // Collect descriptions: positional args + --description flag + piped stdin
          const descriptions: string[] = [...descParts];
          if (flags.description) {
            descriptions.push(flags.description);
          }
          if (stdinText) {
            descriptions.push(stdinText);
          }

          if (descriptions.length === 0 && !hasFileFlag) {
            throw new CLIError(
              "Missing description or --file flag.",
              'Usage: rex add <level> --title="..." or rex add "<description>" ["<desc2>" ...] or rex add --file=ideas.txt or echo "desc" | rex add',
            );
          }
          const { cmdSmartAdd } = await import("./commands/smart-add.js");
          await cmdSmartAdd(dir, descriptions, flags, multiFlags);
        } else {
          throw new CLIError(
            "Missing level, description, or --file flag.",
            'Usage: rex add <level> --title="..." or rex add "<description>" ["<desc2>" ...] or rex add --file=ideas.txt or echo "desc" | rex add',
          );
        }
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
      case "validate": {
        const { cmdValidate } = await import("./commands/validate.js");
        await cmdValidate(resolveDir(), flags);
        break;
      }
      case "recommend": {
        const { cmdRecommend } = await import("./commands/recommend.js");
        await cmdRecommend(resolveDir(), flags);
        break;
      }
      case "analyze": {
        const { cmdAnalyze } = await import("./commands/analyze.js");
        await cmdAnalyze(resolveDir(), flags, multiFlags);
        break;
      }
      case "adapter": {
        // Adapter uses subcommands — strip the trailing dir from positional args
        // so cmdAdapter only sees [subcommand, name?, ...].
        const dir = resolveDir();
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
        const { cmdAdapter } = await import("./commands/adapter.js");
        await cmdAdapter(dir, adapterPositional, flags);
        break;
      }
      case "mcp": {
        const { startMcpServer } = await import("./mcp.js");
        await startMcpServer(resolveDir());
        break;
      }
      default:
        throw new CLIError(
          `Unknown command: ${command}`,
          "Run 'rex --help' to see available commands.",
        );
    }
  } catch (err) {
    handleCLIError(err);
  }
}

main();
