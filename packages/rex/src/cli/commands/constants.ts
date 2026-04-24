import { PROJECT_DIRS, formatUsage } from "@n-dx/llm-client";

export const REX_DIR = PROJECT_DIRS.REX;
export const TOOL_VERSION = "0.1.0";

export function usage(): void {
  console.log(formatUsage({
    title: `rex v${TOOL_VERSION} — PRD management & implementation workflow`,
    usage: "rex <command> [options] [dir]",
    sections: [
      {
        title: "Commands",
        items: [
          { name: "init [dir]", description: "Initialize .rex/ in directory (default: .)" },
          { name: "status [dir]", description: "Show PRD tree (hides completed items by default)" },
          { name: "next [dir]", description: "Print next actionable task" },
          { name: "add <level> [dir]", description: "Add item manually (epic|feature|task|subtask)" },
          { name: "add \"<desc>\" [\"<d2>\"]", description: "Smart add: LLM creates PRD from descriptions" },
          { name: "add --file=<path>", description: "Import ideas from a freeform text file (repeatable)" },
          { name: "echo \"desc\" | add", description: "Pipe text as description (combinable with other sources)" },
          { name: "update <id> [dir]", description: "Update item status/priority" },
          { name: "remove <epic|task> <id>", description: "Remove an epic or task and all descendants" },
          { name: "move <id> [dir]", description: "Move item to new parent (reparent)" },
          { name: "reshape [dir]", description: "LLM-powered PRD restructuring (merge, update, reparent, split)" },
          { name: "prune [dir]", description: "Remove completed subtrees and consolidate remaining items" },
          { name: "usage [dir]", description: "Detailed token usage analytics and cost estimation" },
          { name: "validate [dir]", description: "Check PRD integrity (DAG, schema)" },
          { name: "fix [dir]", description: "Auto-fix common validation issues (timestamps, refs, status)" },
          { name: "report [dir]", description: "Generate JSON health report for CI dashboards" },
          { name: "verify [dir]", description: "Run tests for acceptance criteria" },
          { name: "recommend [dir]", description: "Get SourceVision recommendations" },
          { name: "analyze [dir]", description: "Build PRD from project analysis" },
          { name: "import [dir]", description: "Alias for analyze (file import shorthand)" },
          { name: "reorganize [dir]", description: "Detect and fix structural issues in the PRD" },
          { name: "health [dir]", description: "Show structure health score (depth, balance, completeness)" },
          { name: "sync [dir]", description: "Sync local PRD with remote adapter" },
          { name: "migrate-to-md [dir]", description: "Create .rex/prd.md from .rex/prd.json without modifying JSON" },
          { name: "adapter <sub> [name]", description: "Manage store adapters (list|add|remove|show)" },
          { name: "mcp [dir]", description: "Start MCP server" },
        ],
      },
    ],
    options: [
      { flag: "--help, -h", description: "Show this help" },
      { flag: "--quiet, -q", description: "Suppress informational output (for scripting)" },
      { flag: "--format=tree|json", description: "Output format (default: tree)" },
    ],
    footer: [
      "Run 'rex <command> --help' for detailed help on any command.",
    ],
  }));
}
