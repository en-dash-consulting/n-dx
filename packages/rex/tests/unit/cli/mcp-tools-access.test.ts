/**
 * Pins each rex MCP tool's access kind.
 *
 * `withWorkspace` refuses `write` tools when the client's MCP root cannot be
 * served (#499), so a write tool that drifts to `read` lands in the launch
 * checkout's PRD. Access is not in the `tools/list` response, so neither the
 * snapshot nor a typecheck sees it. This table is hand-written on purpose:
 * a new tool must add a row.
 */
import { describe, it, expect } from "vitest";
import { REX_MCP_TOOLS } from "../../../src/cli/mcp-tools/registry.js";

type Access = "read" | "write";

/** Fixed kind, or the kind for each argument-dependent branch. */
const EXPECTED: Record<string, Access | { args: unknown; access: Access }[]> = {
  add_item: "write",
  edit_item: "write",
  update_task_status: "write",
  move_item: "write",
  append_log: "write",
  claim_task: "write",
  release_task: "write",
  merge_items: [
    { args: { preview: true }, access: "read" },
    { args: { preview: false }, access: "write" },
    { args: {}, access: "write" },
  ],
  reorganize: [
    // `accept` is a string in the schema; cover each form the handler applies.
    { args: { accept: "low-risk" }, access: "write" },
    { args: { accept: "all" }, access: "write" },
    { args: { accept: "1,3" }, access: "write" },
    { args: {}, access: "read" },
  ],
  get_prd_status: "read",
  get_next_task: "read",
  get_item: "read",
  get_recommendations: "read",
  verify_criteria: "read",
  health: "read",
  facets: "read",
  get_token_usage: "read",
  get_capabilities: "read",
};

describe("rex MCP tool access kinds", () => {
  it("has an expected-access row for every registered tool, and no extras", () => {
    expect(REX_MCP_TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const tool of REX_MCP_TOOLS) {
    const expected = EXPECTED[tool.name];
    if (!expected) continue; // reported by the coverage test above

    if (typeof expected === "string") {
      it(`${tool.name} is always ${expected}`, () => {
        expect(typeof tool.access === "function" ? "dynamic" : tool.access).toBe(expected);
      });
    } else {
      for (const { args, access } of expected) {
        it(`${tool.name} is ${access} for ${JSON.stringify(args)}`, () => {
          expect(typeof tool.access).toBe("function");
          const kind = typeof tool.access === "function" ? tool.access(args) : tool.access;
          expect(kind).toBe(access);
        });
      }
    }
  }
});
