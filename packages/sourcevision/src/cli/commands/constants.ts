import { formatUsage } from "@n-dx/llm-client";
export { TOOL_VERSION, SV_DIR } from "../../constants.js";

export function usage(): void {
  console.log(formatUsage({
    title: "sourcevision — codebase analysis tool",
    usage: "sourcevision <command> [options] [dir]",
    sections: [
      {
        title: "Commands",
        items: [
          { name: "sourcevision init [dir]", description: "Set up .sourcevision/ in the current project" },
          { name: "sourcevision analyze [dir]", description: "Run analysis pipeline (default: .)" },
          { name: "sourcevision serve [dir]", description: "Start local viewer (default: .)" },
          { name: "sourcevision validate [dir]", description: "Validate .sourcevision/ output files" },
          { name: "sourcevision export-pdf [dir]", description: "Export analysis as a PDF report" },
          { name: "sourcevision pr-markdown [dir]", description: "Regenerate PR markdown at .sourcevision/pr-markdown.md" },
          { name: "sourcevision git-credential-helper", description: "Run interactive GitHub credential setup helper" },
          { name: "sourcevision reset [dir]", description: "Remove .sourcevision/ and start fresh" },
          { name: "sourcevision workspace [dir]", description: "Aggregate multiple analyzed repos into a unified view" },
          { name: "sourcevision mcp [dir]", description: "Start MCP server for AI tool integration" },
        ],
      },
    ],
    options: [
      { flag: "--help, -h", description: "Show this help" },
      { flag: "--quiet, -q", description: "Suppress informational output (for scripting)" },
    ],
    footer: [
      "Run 'sourcevision <command> --help' for detailed help on any command.",
      "Alias: 'sv' works in place of 'sourcevision'.",
    ],
  }));
}
