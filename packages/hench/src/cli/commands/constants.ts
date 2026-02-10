import { PROJECT_DIRS } from "@n-dx/claude-client";
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
  console.log(`hench v${TOOL_VERSION} — autonomous AI agent for Rex tasks

Usage: hench <command> [options] [dir]

Commands:
  init [dir]              Create .hench/ with config.json and runs/
  run [dir]               Execute one task from Rex PRD
  config [key] [value]    View or edit workflow configuration
  status [dir]            Show recent run history
  show <run-id> [dir]     Show full details of a specific run

Options:
  --help, -h              Show this help
  --task=<id>             Target a specific Rex task ID (for run)
  --epic=<id|title>       Only consider tasks within the specified epic (for run)
  --epic-by-epic          Process epics sequentially, advancing when each completes (for run)
  --auto                  Skip interactive selection, autoselect by priority (for run)
  --iterations=<n>        Run multiple tasks sequentially (for run)
  --loop                  Run continuously until all tasks complete or Ctrl+C (for run)
  --loop-pause=<ms>       Pause between loop iterations in ms (default: config loopPauseMs)
  --dry-run               Print brief without calling Claude API (for run)
  --review                Show proposed changes and prompt for approval (for run)
  --max-turns=<n>         Override max turns (for run)
  --token-budget=<n>      Cap total tokens (input+output) per run; 0 = unlimited (for run)
  --model=<m>             Override model (for run)
  --interactive           Interactive configuration menu (for config)
  --format=json           Output as JSON (for status/show/config)
  --last=<n>              Number of recent runs to show (for status)
  --quiet, -q             Suppress informational output (for scripting)
`);
}
