import { describe, expect, it } from "vitest";
import { BROKER_SCOPE_TOOLS } from "../../../src/server/sidecar/broker-policy.js";
import { checkSidecarCodexInventory } from "../../helpers/sidecar-codex-inventory.js";

const tools = BROKER_SCOPE_TOOLS.worktree.map((name) => `mcp__ndx-sidecar__${name}`).sort();
const alias = (name: string) => name.replace(/^mcp__ndx-sidecar__/, "mcp__ndx_sidecar__");

describe("live Codex model-facing tool inventory", () => {
  it.each([
    ["event spelling", [...tools].reverse()],
    ["model spelling", tools.map(alias).reverse()],
    ["mixed spelling", tools.map((name, index) => index % 2 ? alias(name) : name)],
  ])("accepts the exact catalog with %s and preserves safe diagnostic names", (_label, names) => {
    const result = checkSidecarCodexInventory(names, tools);
    expect(result.matches).toBe(true);
    expect(result.toolNames).toEqual([...names].sort());
    expect(result.normalizedToolNames).toEqual(tools);
  });

  it.each([
    ["missing tool", tools.slice(1)],
    ["extra broker tool", [...tools, "mcp__ndx-sidecar__save_draft"]],
    ["extra foreign server", [...tools, "mcp__unwanted__ask_choice"]],
    ["duplicate tool", [...tools, tools[0]]],
    ["duplicate through alias", [...tools, alias(tools[0])]],
    ["duplicate replacing missing tool", [alias(tools[1]), ...tools.slice(1)]],
    ["foreign server replacing broker", tools.map((name) => name.replace("ndx-sidecar", "unwanted"))],
    ["server alias lookalike", tools.map((name) => name.replace("ndx-sidecar", "ndx_sidecar_extra"))],
    ["tool suffix change", tools.map((name) => name.replace("ask_choice", "ask-choice"))],
  ])("rejects %s without dropping or deduplicating names", (_label, names) => {
    const result = checkSidecarCodexInventory(names, tools);
    expect(result.matches).toBe(false);
    expect(result.toolNames).toEqual([...names].sort());
    expect(result.normalizedToolNames).toHaveLength(names.length);
  });

  it.each([null, {}, "mcp__ndx_sidecar__ask_choice", [1], ["ask_choice"], ["not a tool\nprivate output"]].map((value) => ({ value })))(
    "rejects malformed input without copying arbitrary output to diagnostics (%#)", ({ value }) => {
      expect(checkSidecarCodexInventory(value, tools)).toEqual({ matches: false, malformed: true });
    },
  );
});
