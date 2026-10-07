/** The response shape every rex MCP tool handler returns. */

/** Standard MCP text response. */
export type McpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  warning?: string; // One-time warning (e.g., for migration notifications)
};

export function textResult(text: string, isError = false, warning?: string): McpResult {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
    ...(warning ? { warning } : {}),
  };
}
