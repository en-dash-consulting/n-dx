#!/usr/bin/env node
/**
 * Hench CLI entry point.
 *
 * Package architecture — functional subzones:
 *
 *   cli/         CLI interface: arg parsing, command dispatch, output formatting
 *   agent/       Core agent logic: run loops, brief assembly, review & analysis
 *     lifecycle/ Agent execution loops and token tracking
 *     planning/  Task brief assembly and system prompt generation
 *     analysis/  Post-run review, summary, and stuck detection
 *   tools/       Tool integrations: shell exec, file ops, git, Rex, test runner
 *   guard/       Security: command allowlisting, path validation, shell blocking
 *   store/       Persistence: run records, config I/O
 *   schema/      Config schema and validation
 *   types/       Shared type definitions
 *   validation/  Completion validation rules
 *
 * @module hench/cli
 */

import { resolve } from "node:path";
import { usage } from "./commands/constants.js";
import { showCommandHelp } from "./help.js";
import { CLIError, handleCLIError, requireHenchDir } from "./errors.js";
import { setQuiet } from "./output.js";
import { formatTypoSuggestion } from "../prd/llm-gateway.js";

function parseArgs(argv: string[]): {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string>;
} {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
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

  return { command, positional, flags };
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

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

  // Resolve dir: last positional arg or cwd
  const resolveDir = (): string => {
    const last = positional[positional.length - 1];
    if (last && !last.startsWith("-")) {
      return resolve(last);
    }
    return process.cwd();
  };

  try {
    // Ensure .hench/ exists for all commands except init
    if (command !== "init") {
      requireHenchDir(resolveDir());
    }

    switch (command) {
      case "init": {
        const { cmdInit } = await import("./commands/init.js");
        await cmdInit(resolveDir(), flags);
        break;
      }
      case "run": {
        const { cmdRun } = await import("./commands/run.js");
        await cmdRun(resolveDir(), flags);
        break;
      }
      case "status": {
        const { cmdStatus } = await import("./commands/status.js");
        await cmdStatus(resolveDir(), flags);
        break;
      }
      case "show": {
        const runId = positional[0];
        if (!runId) {
          throw new CLIError(
            "Missing run ID.",
            "Usage: hench show <run-id> [dir]",
          );
        }
        const dir =
          positional.length > 1 ? resolve(positional[positional.length - 1]) : process.cwd();
        const { cmdShow } = await import("./commands/show.js");
        await cmdShow(dir, runId, flags);
        break;
      }
      case "config": {
        const { cmdConfig } = await import("./commands/config.js");
        await cmdConfig(resolveDir(), positional, flags);
        break;
      }
      case "template": {
        const { cmdTemplate } = await import("./commands/template.js");
        await cmdTemplate(resolveDir(), positional, flags);
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
          analyze: "ndx analyze",
        };
        if (command in NDX_ONLY_COMMANDS) {
          throw new CLIError(
            `"${command}" is an orchestrator command. Run: ${NDX_ONLY_COMMANDS[command]} .`,
          );
        }

        const HENCH_COMMANDS = ["init", "run", "status", "show", "config", "template"];
        const typoHint = formatTypoSuggestion(command, HENCH_COMMANDS, "hench ");
        throw new CLIError(
          `Unknown command: ${command}`,
          typoHint ?? "Run 'hench --help' to see available commands.",
        );
      }
    }
  } catch (err) {
    handleCLIError(err);
  }
}

main();
