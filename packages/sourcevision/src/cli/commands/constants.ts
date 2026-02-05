export const TOOL_VERSION = "0.1.0";
export const SV_DIR = ".sourcevision";

export function usage(): void {
  console.log(`sourcevision — codebase analysis tool

Usage:
  sourcevision init              Set up .sourcevision/ in the current project
  sourcevision analyze [dir]     Run analysis pipeline (default: .)
  sourcevision serve [dir]       Start local viewer (default: .)
  sourcevision validate [dir]    Validate .sourcevision/ output files
  sourcevision reset [dir]       Remove .sourcevision/ and start fresh
  sourcevision mcp [dir]         Start MCP server for AI tool integration

Options:
  --port=N       Server port for serve (default: 3117)
  --phase=N      Run only phase N of analyze (1=inventory, 2=imports, 3=zones, 4=components)
  --only=MODULE  Run only named module (inventory, imports, zones, components)
  --fast         Skip AI zone-name enrichment (use algorithmic names)
  --full         Run all 4 enrichment passes in sequence
  --per-zone     Use per-zone enrichment (smaller context, incremental, parallelizable)
  --quiet, -q    Suppress informational output (for scripting)
  --help         Show this help`);
}
