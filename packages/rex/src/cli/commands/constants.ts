export const REX_DIR = ".rex";
export const TOOL_VERSION = "0.1.0";

export function usage(): void {
  console.log(`rex v${TOOL_VERSION} — PRD management & implementation workflow

Usage: rex <command> [options] [dir]

Commands:
  init [dir]              Initialize .rex/ in directory (default: .)
  status [dir]            Show PRD tree with completion stats
  next [dir]              Print next actionable task
  add <level> [dir]       Add item manually (epic|feature|task|subtask)
  add "<desc>" ["<d2>"]   Smart add: LLM creates PRD structure from description(s)
  add --file=<path>       Import ideas from a freeform text file (repeatable)
  echo "desc" | add       Pipe text as description (combinable with other sources)
  update <id> [dir]       Update item status/priority
  move <id> [dir]         Move item to new parent (reparent)
  prune [dir]             Remove completed subtrees (archive to .rex/archive.json)
  validate [dir]          Check PRD integrity (DAG, schema)
  verify [dir]            Run tests for acceptance criteria
  recommend [dir]         Get SourceVision recommendations
  analyze [dir]           Build PRD from project analysis
  import [dir]            Alias for analyze (file import shorthand)
  adapter <sub> [name]    Manage store adapters (list|add|remove|show)
  mcp [dir]               Start MCP server

Options:
  --help, -h              Show this help
  --title="..."           Item title (for add)
  --parent=<id>           Parent item ID (for add, move)
  --status=<s>            Status (for update)
  --force                 Override status transition rules (for update)
  --priority=<p>          Priority (for update/add)
  --description="..."     Description (for add/update)
  --task=<id>             Target a specific task (for verify)
  --dry-run               Preview without making changes (for prune, verify)
  --format=tree|json      Output format (default: tree)
  --lite                  File-name-only scan (for analyze)
  --accept                Accept LLM proposals into PRD (for smart add, analyze)
  --file=<path>           Import from a document (repeatable, for add/analyze)
  --no-llm                Force algorithmic pipeline, skip LLM (for analyze)
  --model=<name>          Override LLM model (for analyze, smart add)
  --analyze               Run SourceVision analysis (for init)
  --quiet, -q             Suppress informational output (for scripting)
`);
}
