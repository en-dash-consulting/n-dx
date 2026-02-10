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
 *   mcp [dir]          - Start MCP server for AI tool integration
 */

import { resolve } from "node:path";
import { usage } from "./commands/constants.js";
import { cmdInit } from "./commands/init.js";
import { cmdReset } from "./commands/reset.js";
import { cmdAnalyze } from "./commands/analyze.js";
import { cmdValidate } from "./commands/validate.js";
import { cmdExportPdf } from "./commands/export-pdf.js";
import { CLIError, handleCLIError, requireSvDir } from "./errors.js";
import { setQuiet } from "./output.js";

const args = process.argv.slice(2);
const command = args[0];

// ── arg parsing & dispatch ──────────────────────────────────────────────────

let port = 3117;
let quiet = false;
let outputPath: string | undefined;
const passthrough: string[] = [];

for (const a of args.slice(1)) {
  if (a.startsWith("--port=")) {
    port = parseInt(a.split("=")[1], 10);
  } else if (a.startsWith("--output=") || a.startsWith("-o=")) {
    outputPath = a.split("=").slice(1).join("=");
  } else if (a === "--quiet" || a === "-q") {
    quiet = true;
  } else if (a.startsWith("--phase=") || a.startsWith("--only=") || a === "--fast" || a === "--full") {
    passthrough.push(a);
  }
}

setQuiet(quiet);

// First non-flag arg after command is the target dir
const targetArg = args.slice(1).find((a) => !a.startsWith("-"));

async function cmdServe(dir: string, port: number): Promise<void> {
  const absDir = resolve(dir);
  const { startServe } = await import("./serve.js");
  startServe(absDir, port);
}

async function cmdMcp(dir: string): Promise<void> {
  const absDir = resolve(dir);
  const { startMcpServer } = await import("./mcp.js");
  await startMcpServer(absDir);
}

// Commands that require .sourcevision/ to exist
const NEEDS_SV_DIR = new Set(["serve", "validate", "reset", "mcp"]);

try {
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
    case "mcp":
      await cmdMcp(targetArg || ".");
      break;
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      throw new CLIError(
        `Unknown command: ${command}`,
        "Run 'sourcevision --help' to see available commands.",
      );
  }
} catch (err) {
  handleCLIError(err);
}
