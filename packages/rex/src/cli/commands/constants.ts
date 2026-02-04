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
  add "<description>"     Smart add: LLM creates PRD structure from description
  update <id> [dir]       Update item status/priority
  validate [dir]          Check PRD integrity (DAG, schema)
  recommend [dir]         Get SourceVision recommendations
  analyze [dir]           Build PRD from project analysis
  mcp [dir]               Start MCP server

Options:
  --help, -h              Show this help
  --title="..."           Item title (for add)
  --parent=<id>           Parent item ID (for add)
  --status=<s>            Status (for update)
  --priority=<p>          Priority (for update/add)
  --description="..."     Description (for add/update)
  --format=tree|json      Output format (default: tree)
  --lite                  File-name-only scan (for analyze)
  --accept                Accept LLM proposals into PRD (for smart add, analyze)
  --file=<path>           Import PRD from a document (repeatable, for analyze)
  --no-llm                Force algorithmic pipeline, skip LLM (for analyze)
  --model=<name>          Override LLM model (for analyze, smart add)
  --analyze               Run SourceVision analysis (for init)
`);
}
