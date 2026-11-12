/** Compare model-facing tool names without exposing arbitrary model output. */
export function checkSidecarCodexInventory(value: unknown, expected: readonly string[]) {
  if (!Array.isArray(value) || !value.every((name): name is string =>
    typeof name === "string" && name.length <= 256 && /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(name))) {
    return { matches: false, malformed: true };
  }
  const toolNames = [...value].sort();
  // vendor-session-driver.ts documents Codex's model spelling separately
  // from its raw MCP server field. Alias only this broker, never arbitrary
  // server/tool punctuation; keep duplicates so collisions fail comparison.
  const normalizedToolNames = toolNames.map((name) =>
    name.replace(/^mcp__ndx_sidecar__/, "mcp__ndx-sidecar__")).sort();
  const wanted = [...expected].sort();
  return {
    toolNames,
    normalizedToolNames,
    matches: normalizedToolNames.length === wanted.length
      && normalizedToolNames.every((name, index) => name === wanted[index]),
    malformed: false,
  };
}
