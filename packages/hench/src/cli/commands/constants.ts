export const HENCH_DIR = ".hench";
export const TOOL_VERSION = "0.1.0";

export function safeParseInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) {
    console.error(`Invalid --${name} value: ${value}`);
    process.exit(1);
  }
  return n;
}

export function usage(): void {
  console.log(`hench v${TOOL_VERSION} — autonomous AI agent for Rex tasks

Usage: hench <command> [options] [dir]

Commands:
  init [dir]              Create .hench/ with config.json and runs/
  run [dir]               Execute one task from Rex PRD
  status [dir]            Show recent run history
  show <run-id> [dir]     Show full details of a specific run

Options:
  --help, -h              Show this help
  --task=<id>             Target a specific Rex task ID (for run)
  --auto                  Skip interactive selection, autoselect by priority (for run)
  --iterations=<n>        Run multiple tasks sequentially (for run)
  --dry-run               Print brief without calling Claude API (for run)
  --max-turns=<n>         Override max turns (for run)
  --model=<m>             Override model (for run)
  --format=json           Output as JSON (for status/show)
  --last=<n>              Number of recent runs to show (for status)
`);
}
