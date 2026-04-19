#!/usr/bin/env node

/**
 * Sourcevision CLI
 *
 * Commands:
 *   init               - Initialize .sourcevision/ in current project
 *   analyze [dir]      - Run analysis pipeline
 *   serve [dir]        - Start local viewer server
 *   validate [dir]     - Validate .sourcevision/ output files
 *   export-pdf [dir]   - Export analysis as a PDF report
 *   pr-markdown [dir]  - Regenerate PR markdown in .sourcevision/
 *   git-credential-helper - Interactive GitHub credential setup helper
 *   mcp [dir]          - Start MCP server for AI tool integration
 */

import { resolve } from "node:path";
import { usage, showCommandHelp } from "./help.js";
import { cmdInit } from "./commands/init.js";
import { cmdReset } from "./commands/reset.js";
import { cmdAnalyze } from "./commands/analyze.js";
import { cmdValidate } from "./commands/validate.js";
import { cmdExportPdf } from "./commands/export-pdf.js";
import { cmdGitCredentialHelper } from "./commands/git-credential-helper.js";
import { cmdPrMarkdown } from "./commands/pr-markdown.js";
import { cmdWorkspace } from "./commands/workspace.js";
import { CLIError, handleCLIError, requireSvDir } from "./errors.js";
import { setQuiet } from "./output.js";
import { CLI_ERROR_CODES, formatTypoSuggestion, suppressKnownDeprecations } from "@n-dx/llm-client";

suppressKnownDeprecations();

const args = process.argv.slice(2);
const command = args[0];

// ── arg parsing & dispatch ──────────────────────────────────────────────────

let port = 3117;
let quiet = false;
let help = false;
let outputPath: string | undefined;
const passthrough: string[] = [];

for (const a of args.slice(1)) {
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10);
  } else if (a.startsWith("--output=") || a.startsWith("-o=")) {
    outputPath = a.split("=").slice(1).join("=");
  } else if (a === "--quiet" || a === "-q") {
    quiet = true;
  } else if (a === "--help" || a === "-h") {
    help = true;
  } else if (a.startsWith("--phase=") || a.startsWith("--only=") || a === "--fast" || a === "--full" || a === "--deep") {
    passthrough.push(a);
  }
}

setQuiet(quiet);

// First non-flag arg after command is the target dir
const targetArg = args.slice(1).find((a) => !a.startsWith("-"));

async function cmdServe(dir: string, port: number): Promise<void> {
  const absDir = resolve(dir);
  const { startServe } = await import("./serve.js");
  await startServe(absDir, port);
}

async function cmdMcp(dir: string): Promise<void> {
  const absDir = resolve(dir);
  const { startMcpServer } = await import("./mcp.js");
  await startMcpServer(absDir);
}

// Commands that require .sourcevision/ to exist
const NEEDS_SV_DIR = new Set(["serve", "validate", "reset", "pr-markdown", "mcp"]);

try {
  // Show help: per-command help when --help/-h is given with a command,
  // else top-level usage.
  if (help && command && command !== "--help" && command !== "-h") {
    if (!showCommandHelp(command)) {
      usage();
    }
    process.exit(0);
  }

  if (command && NEEDS_SV_DIR.has(command)) {
    requireSvDir(resolve(targetArg || "."));
  }

  switch (command) {
    case "init":
      cmdInit(targetArg || ".");
      break;
    case "analyze":
      await cmdAnalyze(targetArg || ".", passthrough);
      break;
    case "serve":
      await cmdServe(targetArg || ".", port);
      break;
    case "validate":
      cmdValidate(targetArg || ".");
      break;
    case "reset":
      cmdReset(targetArg || ".");
      break;
    case "export-pdf":
      await cmdExportPdf(targetArg || ".", { output: outputPath });
      break;
    case "pr-markdown":
      await cmdPrMarkdown(targetArg || ".");
      break;
    case "git-credential-helper":
      cmdGitCredentialHelper();
      break;
    case "workspace":
      cmdWorkspace(targetArg || ".", args.slice(1));
      break;
    case "mcp":
      await cmdMcp(targetArg || ".");
      break;
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default: {
      // Check if the user tried an ndx-only orchestration command
      const NDX_ONLY_COMMANDS: Record<string, string> = {
        plan: "ndx plan",
        work: "ndx work",
        "self-heal": "ndx self-heal",
        start: "ndx start",
        init: "ndx init",
        ci: "ndx ci",
        dev: "ndx dev",
        refresh: "ndx refresh",
        export: "ndx export",
        config: "ndx config",
      };
      if (command && command in NDX_ONLY_COMMANDS) {
        throw new CLIError(
          `"${command}" is an orchestrator command. Run: ${NDX_ONLY_COMMANDS[command]} .`,
        );
      }

      const SV_COMMANDS = ["init", "analyze", "serve", "validate", "reset", "export-pdf", "pr-markdown", "git-credential-helper", "mcp", "workspace"];
      const typoHint = formatTypoSuggestion(command, SV_COMMANDS, "sourcevision ");
      throw new CLIError(
        `Unknown command: ${command}`,
        typoHint ?? "Run 'sourcevision --help' to see available commands.",
        CLI_ERROR_CODES.UNKNOWN_COMMAND,
      );
    }
  }
} catch (err) {
  handleCLIError(err);
}
