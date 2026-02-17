/**
 * Command-specific help content for the hench CLI.
 *
 * Each command has a dedicated help function that shows:
 *   - Synopsis / usage pattern
 *   - Relevant flags only
 *   - 2–3 practical examples
 *
 * @module hench/cli/help
 */

/** Map of command name → help renderer. */
const COMMAND_HELP: Record<string, () => void> = {
  init: helpInit,
  run: helpRun,
  status: helpStatus,
  show: helpShow,
  config: helpConfig,
  template: helpTemplate,
};

/**
 * Show command-specific help. Returns true if help was shown, false if
 * the command has no dedicated help.
 */
export function showCommandHelp(command: string): boolean {
  const fn = COMMAND_HELP[command];
  if (!fn) return false;
  fn();
  return true;
}

// ── Per-command help ──────────────────────────────────────────────────

function helpInit(): void {
  console.log(`hench init — create .hench/ with default configuration

Usage: hench init [dir]

Sets up .hench/ with config.json and a runs/ directory. If .hench/
already exists, reports it and skips.

Examples:
  hench init                       Initialize in current directory
  hench init ./my-project          Initialize in a specific directory
`);
}

function helpRun(): void {
  console.log(`hench run — execute a task from the Rex PRD

Usage: hench run [options] [dir]

Picks the next actionable task from the PRD (or a specific one via --task),
builds a brief, and runs an autonomous agent loop using Claude. The agent
can read/write files, run commands, and update task status.

Options:
  --task=<id>           Target a specific Rex task ID
  --epic=<id|title>     Only consider tasks within the specified epic
  --epic-by-epic        Process epics sequentially, advancing when done
  --auto                Skip interactive selection, autoselect by priority
  --iterations=<n>      Run multiple tasks sequentially (e.g. --iterations=5)
  --loop                Run continuously until all tasks complete or Ctrl+C
  --loop-pause=<ms>     Pause between loop iterations (default: config value)
  --dry-run             Print the task brief without calling Claude
  --review              Show proposed changes and prompt for approval
  --max-turns=<n>       Override max agent turns per task
  --token-budget=<n>    Cap total tokens per run (0 = unlimited)
  --model=<model>       Override the Claude model

Examples:
  hench run                        Run next task (interactive selection)
  hench run --task=abc123          Run a specific task
  hench run --epic="Auth" --auto   Auto-run tasks in the Auth epic
  hench run --loop --epic-by-epic  Continuously process epics in order
  hench run --dry-run .            Preview the brief without execution
`);
}

function helpStatus(): void {
  console.log(`hench status — show recent run history

Usage: hench status [options] [dir]

Lists recent agent runs with their task, status, duration, and token usage.

Options:
  --last=<n>            Number of recent runs to show (default: 10)
  --format=json         Output as JSON

Examples:
  hench status                     Show last 10 runs
  hench status --last=20           Show last 20 runs
  hench status --format=json .     Machine-readable output
`);
}

function helpShow(): void {
  console.log(`hench show — show full details of a specific run

Usage: hench show <run-id> [options] [dir]

Displays comprehensive details about a single agent run including task
info, model, timing, turns, token usage, and the outcome.

Options:
  --format=json         Output as JSON

Examples:
  hench show abc123                Show run details
  hench show abc123 --format=json  JSON output for scripting
`);
}

function helpConfig(): void {
  console.log(`hench config — view or edit workflow configuration

Usage:
  hench config [dir]                    Display all settings
  hench config <key> [dir]              Get a single value
  hench config <key> <value> [dir]      Set a single value
  hench config --interactive [dir]      Interactive configuration menu

Manages .hench/config.json settings including provider, model, max turns,
guard rules, retry behavior, and task selection preferences.

Options:
  --interactive         Launch interactive configuration menu
  --format=json         Output current config as JSON

Examples:
  hench config                     Display all current settings
  hench config model               Show current model
  hench config model claude-sonnet-4-20250514  Set the model
  hench config --interactive       Interactive menu for all settings
`);
}

function helpTemplate(): void {
  console.log(`hench template — manage workflow templates

Usage: hench template <subcommand> [id] [options] [dir]

Workflow templates are pre-configured sets of hench settings that can
be applied to quickly switch between different execution strategies.

Subcommands:
  list                  List all available templates (built-in and user)
  show <id>             Show template details and settings
  apply <id>            Apply a template to current config
  save <id>             Save current config as a user template
  delete <id>           Delete a user-defined template

Options:
  --name="..."          Template name (for save)
  --description="..."   Template description (for save)
  --format=json         Output as JSON (for list, show)

Examples:
  hench template list              List all templates
  hench template apply cautious    Apply the cautious template
  hench template save my-setup --name="My Setup" --description="Custom config"
`);
}
