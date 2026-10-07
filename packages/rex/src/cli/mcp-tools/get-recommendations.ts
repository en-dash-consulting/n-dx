import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetRecommendations(): Promise<McpResult> {
  return textResult(
    JSON.stringify({
      available: false,
      message: "SourceVision integration not yet configured. Use 'rex recommend' CLI command.",
    }),
  );
}

export const getRecommendationsTool = defineTool({
  name: "get_recommendations",
  description: "Get SourceVision-based recommendations for PRD items. Use alongside get_findings for data-driven planning.",
  schema: {},
  access: "read",
  run: () => handleGetRecommendations(),
});
