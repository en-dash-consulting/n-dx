/**
 * Command-specific help content for the rex CLI.
 *
 * Each command has a dedicated help function that shows:
 *   - Synopsis / usage pattern
 *   - Relevant flags only (not the full global options list)
 *   - 2–3 practical examples
 *
 * @module rex/cli/help
 */

import { TOOL_VERSION } from "./commands/constants.js";

/** Map of command name → help renderer. */
const COMMAND_HELP: Record<string, () => void> = {
  init: helpInit,
  status: helpStatus,
  next: helpNext,
  add: helpAdd,
  update: helpUpdate,
  move: helpMove,
  reshape: helpReshape,
  prune: helpPrune,
  validate: helpValidate,
  fix: helpFix,
  sync: helpSync,
  usage: helpUsage,
  report: helpReport,
  verify: helpVerify,
  recommend: helpRecommend,
  analyze: helpAnalyze,
  import: helpAnalyze, // alias
  adapter: helpAdapter,
  mcp: helpMcp,
};

/**
 * Show command-specific help. Returns true if help was shown, false if
 * the command has no dedicated help (caller should fall back to general usage).
 */
export function showCommandHelp(command: string): boolean {
  const fn = COMMAND_HELP[command];
  if (!fn) return false;
  fn();
  return true;
}

// ── Per-command help ──────────────────────────────────────────────────

function helpInit(): void {
  console.log(`rex init — initialize a .rex/ directory

Usage: rex init [dir]

Sets up .rex/ with config.json, prd.json, and workflow.md in the target
directory (defaults to the current directory).

Options:
  --project=<name>    Project name for config (default: directory basename)
  --analyze           Also run SourceVision analysis after init

Examples:
  rex init                         Initialize in current directory
  rex init ./my-project            Initialize in a specific directory
  rex init --analyze .             Initialize and analyze codebase
`);
}

function helpStatus(): void {
  console.log(`rex status — show PRD tree with completion stats

Usage: rex status [options] [dir]

Displays the full PRD hierarchy with status icons, progress bars, and
optional token usage summary. Completed subtrees are hidden by default.

Options:
  --all               Show all items including completed ones
  --coverage          Show test coverage per task
  --tokens=false      Hide token usage summary (shown by default)
  --since=<ISO>       Filter token usage after this timestamp
  --until=<ISO>       Filter token usage before this timestamp
  --format=tree|json  Output format (default: tree)

Examples:
  rex status                       Show PRD tree (hides completed)
  rex status --all                 Show everything including completed items
  rex status --format=json .       Machine-readable JSON output
`);
}

function helpNext(): void {
  console.log(`rex next — print the next actionable task

Usage: rex next [options] [dir]

Finds the highest-priority task that is ready to work on (not blocked,
not deferred). Shows the task with its parent chain and explains why
it was selected.

Options:
  --format=json       Output as JSON

Examples:
  rex next                         Show next task to work on
  rex next --format=json .         Machine-readable output for scripting
`);
}

function helpAdd(): void {
  console.log(`rex add — add items to the PRD

Usage:
  rex add <level> --title="..." [options] [dir]    Manual mode
  rex add "<description>" ["<desc2>" ...] [dir]    Smart mode (LLM)
  rex add --file=<path> [dir]                      File import mode
  echo "description" | rex add [dir]               Piped input mode

Manual mode creates a single item at the specified level. Smart mode
uses an LLM to analyze your description(s) and generate a structured
PRD proposal with epics, features, tasks, and subtasks.

Levels: epic, feature, task, subtask

Options:
  --title="..."       Item title (required for manual mode)
  --level=<level>     Item level (alternative to positional level)
  --parent=<id>       Parent item ID to nest under
  --priority=<p>      Priority: critical, high, medium, low
  --description="..." Item description
  --file=<path>       Import from a freeform text file (repeatable)
  --accept            Auto-accept LLM proposals without review
  --model=<name>      Override LLM model for smart mode

Examples:
  rex add epic --title="User auth"                 Add an epic manually
  rex add task --title="Login form" --parent=abc   Add a task under a parent
  rex add "Add dark mode support"                  Smart add from description
  rex add --file=ideas.txt --file=notes.md .       Import from multiple files
`);
}

function helpUpdate(): void {
  console.log(`rex update — update an existing PRD item

Usage: rex update <id> [options] [dir]

Modify the status, priority, title, or description of a PRD item.
Status transitions are validated (e.g. completed → pending requires --force).

Options:
  --status=<s>        New status: pending, in_progress, completed, failing,
                      deferred, blocked, deleted
  --priority=<p>      New priority: critical, high, medium, low
  --title="..."       New title
  --description="..." New description
  --reason="..."      Failure reason (when setting status to failing)
  --force             Override status transition rules

Examples:
  rex update abc123 --status=completed             Mark a task as done
  rex update abc123 --status=in_progress           Start working on a task
  rex update abc123 --priority=critical --title="Urgent fix"
`);
}

function helpMove(): void {
  console.log(`rex move — reparent an item in the PRD tree

Usage: rex move <id> [options] [dir]

Moves an item to a new parent, changing its position in the PRD hierarchy.
Validates that the move doesn't create cycles or violate level constraints.

Options:
  --parent=<id>       New parent ID (omit to move to root)

Examples:
  rex move abc123 --parent=def456  Move item under a new parent
  rex move abc123                  Move item to root level
`);
}

function helpReshape(): void {
  console.log(`rex reshape — LLM-powered PRD restructuring

Usage: rex reshape [options] [dir]

Uses an LLM to analyze the current PRD and propose structural changes:
merges, splits, reparenting, title updates, and description improvements.

Options:
  --dry-run           Preview proposals without applying
  --accept            Auto-accept proposals without review
  --model=<name>      Override LLM model

Examples:
  rex reshape                      Interactive review of proposals
  rex reshape --dry-run            Preview what would change
  rex reshape --accept .           Apply all proposals automatically
`);
}

function helpPrune(): void {
  console.log(`rex prune — remove completed subtrees

Usage: rex prune [options] [dir]

Removes fully-completed branches from the PRD tree and archives them
to .rex/archive.json. Optionally runs a consolidation pass to clean
up remaining items.

Options:
  --dry-run           Preview what would be pruned
  --smart             Use LLM-assisted consolidation after pruning
  --accept            Auto-accept all changes without review
  --yes, -y           Skip confirmation prompt
  --no-consolidate    Skip the post-prune consolidation pass

Examples:
  rex prune                        Interactive prune with confirmation
  rex prune --dry-run              Preview pruneable items
  rex prune --smart --yes .        Smart prune without prompts
`);
}

function helpValidate(): void {
  console.log(`rex validate — check PRD integrity

Usage: rex validate [options] [dir]

Runs schema validation, DAG cycle detection, and structural checks
against .rex/prd.json and config.json.

Options:
  --format=json       Machine-readable output

Examples:
  rex validate                     Check PRD health
  rex validate --format=json .     JSON output for CI integration
`);
}

function helpFix(): void {
  console.log(`rex fix — auto-fix common PRD issues

Usage: rex fix [options] [dir]

Detects and repairs common validation issues such as missing timestamps,
broken parent references, and inconsistent status values.

Options:
  --dry-run           Preview fixes without applying
  --format=json       Machine-readable output

Examples:
  rex fix                          Fix all detected issues
  rex fix --dry-run                Preview what would be fixed
  rex fix --format=json .          JSON output for scripting
`);
}

function helpSync(): void {
  console.log(`rex sync — synchronize PRD with a remote adapter

Usage: rex sync [options] [dir]

Bidirectional sync between the local .rex/prd.json and a remote service
(e.g. Notion). By default performs a full sync; use --push or --pull
for one-way operations.

Options:
  --push              Push local changes to remote only
  --pull              Pull remote changes to local only
  --adapter=<name>    Adapter name (default: notion)
  --dry-run           Preview sync without writing
  --format=json       Machine-readable output

Examples:
  rex sync                         Full bidirectional sync
  rex sync --push                  Push local changes to Notion
  rex sync --pull --adapter=notion Pull remote changes down
`);
}

function helpUsage(): void {
  console.log(`rex usage — token usage analytics and cost estimation

Usage: rex usage [options] [dir]

Shows detailed token consumption across all LLM operations, grouped
by command or time period, with cost estimates.

Options:
  --group=day|week|month  Group usage by time period
  --since=<ISO>           Filter usage after this timestamp
  --until=<ISO>           Filter usage before this timestamp
  --format=tree|json      Output format (default: tree)

Examples:
  rex usage                        Show total token usage
  rex usage --group=week           Usage grouped by week
  rex usage --since=2025-01-01 --format=json
`);
}

function helpReport(): void {
  console.log(`rex report — generate JSON health report

Usage: rex report [options] [dir]

Produces a structured health report including validation results,
level breakdowns, and completion stats. Designed for CI dashboards.

Options:
  --fail-on-error     Exit 1 if validation errors are found
  --format=json       Always outputs JSON (this flag is implicit)

Examples:
  rex report                       Generate health report
  rex report --fail-on-error .     Fail CI on validation errors
`);
}

function helpVerify(): void {
  console.log(`rex verify — run tests for acceptance criteria

Usage: rex verify [options] [dir]

Maps acceptance criteria to test files and optionally executes tests
to validate task completion.

Options:
  --task=<id>         Verify a specific task only
  --dry-run           Map criteria to tests without running them
  --format=json       Machine-readable output

Examples:
  rex verify                       Verify all tasks
  rex verify --task=abc123         Verify a specific task
  rex verify --dry-run .           Preview test mapping without execution
`);
}

function helpRecommend(): void {
  console.log(`rex recommend — get SourceVision-based recommendations

Usage: rex recommend [options] [dir]

Reads SourceVision analysis findings and suggests new PRD items based on
code quality issues, architectural anti-patterns, and missing tests.
Requires .sourcevision/ to exist (run 'sourcevision analyze' first).

Options:
  --format=json       Machine-readable output

Examples:
  rex recommend                    Show recommendations interactively
  rex recommend --format=json .    JSON output for automation
`);
}

function helpAnalyze(): void {
  console.log(`rex analyze — build PRD from project analysis

Usage: rex analyze [options] [dir]

Scans the codebase (tests, docs, SourceVision output, package.json) and
uses an LLM to generate PRD proposals. Proposals are reviewed interactively
unless --accept is passed.

Also available as: rex import

Options:
  --accept              Accept all proposals without review
  --lite                File-name-only scan (faster, less detail)
  --guided              Interactive spec builder for new projects
  --no-llm              Force algorithmic pipeline, skip LLM
  --model=<name>        Override LLM model
  --file=<path>         Import from a document (repeatable)
  --chunk-size=<n>      Proposals per page in interactive review

Examples:
  rex analyze                      Scan and review proposals interactively
  rex analyze --accept .           Auto-accept all proposals
  rex analyze --file=spec.md       Generate PRD from a spec document
  rex analyze --guided             Guided setup for a new project
`);
}

function helpAdapter(): void {
  console.log(`rex adapter — manage store adapters

Usage: rex adapter <subcommand> [name] [options] [dir]

Subcommands:
  list                List registered adapters and their status
  add <name>          Configure an adapter (e.g. notion)
  remove <name>       Remove adapter configuration
  show <name>         Show adapter configuration details

Options:
  --key=<value>       Set adapter config values (for add)
  --format=json       Machine-readable output (for list, show)

Examples:
  rex adapter list                               Show all adapters
  rex adapter add notion --token=secret_xxx      Configure Notion adapter
  rex adapter show notion                        Show Notion config
`);
}

function helpMcp(): void {
  console.log(`rex mcp — start MCP server for AI tool integration

Usage: rex mcp [dir]

Starts a Model Context Protocol (MCP) server over stdio for integration
with AI coding assistants like Claude Code. Exposes tools for PRD
management: status, next task, add, update, validate, analyze, recommend.

Examples:
  rex mcp                          Start MCP server in current directory
  rex mcp /path/to/project         Start MCP server for a specific project
`);
}
