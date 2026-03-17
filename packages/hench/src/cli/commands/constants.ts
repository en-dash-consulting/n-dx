import { PROJECT_DIRS, formatUsage } from "../../prd/llm-gateway.js";
import { CLIError } from "../errors.js";

export const HENCH_DIR = PROJECT_DIRS.HENCH;
export const TOOL_VERSION = "0.1.0";

export function safeParseInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) {
    throw new CLIError(
      `Invalid --${name} value: "${value}"`,
      `Must be a positive integer.`,
    );
  }
  return n;
}

export function safeParseNonNegInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 0) {
    throw new CLIError(
      `Invalid --${name} value: "${value}"`,
      `Must be a non-negative integer (0 = unlimited).`,
    );
  }
  return n;
}

export function usage(): void {
  console.log(formatUsage({
    title: `hench v${TOOL_VERSION} — autonomous AI agent for Rex tasks`,
    usage: "hench <command> [options] [dir]",
    sections: [
      {
        title: "Commands",
        items: [
          { name: "init [dir]", description: "Create .hench/ with config.json and runs/" },
          { name: "run [dir]", description: "Execute one task from Rex PRD" },
          { name: "config [key] [value]", description: "View or edit workflow configuration" },
          { name: "template [subcommand]", description: "Manage workflow templates (list, show, apply, save, delete)" },
          { name: "status [dir]", description: "Show recent run history" },
          { name: "show <run-id> [dir]", description: "Show full details of a specific run" },
        ],
      },
    ],
    options: [
      { flag: "--help, -h", description: "Show this help" },
      { flag: "--quiet, -q", description: "Suppress informational output (for scripting)" },
      { flag: "--format=json", description: "Output as JSON (for status/show/config)" },
    ],
    footer: [
      "Run 'hench <command> --help' for detailed help on any command.",
    ],
  }));
}
