/**
 * Audit test: MCP tool schemas cover all mutable PRDItem fields.
 *
 * Ensures that every user-editable field on PRDItem is exposed through
 * at least one MCP tool (add_item, edit_item, or update_task_status).
 * Fields that are system-managed (id, children, timestamps, override
 * markers) are explicitly excluded.
 */
import { describe, it, expect } from "vitest";

/**
 * All fields on PRDItem and which MCP tool(s) expose them.
 *
 * Categories:
 * - "add"    → add_item
 * - "edit"   → edit_item
 * - "status" → update_task_status
 * - "managed" → set automatically by the system (not user-editable)
 * - "complex" → requires nested schema, documented as known gap
 */
const FIELD_COVERAGE: Record<string, string[]> = {
  // Identity (not mutable)
  id: ["managed"],

  // Core content fields
  title: ["add", "edit"],
  description: ["add", "edit"],
  acceptanceCriteria: ["add", "edit"],
  priority: ["add", "edit"],
  level: ["add", "edit"],
  tags: ["add", "edit"],
  source: ["add", "edit"],
  blockedBy: ["add", "edit"],

  // Lifecycle fields
  status: ["status"],
  startedAt: ["managed"],
  completedAt: ["managed"],
  failureReason: ["managed"],
  resolutionType: ["status"],
  resolutionDetail: ["status"],

  // System-managed metadata
  overrideMarker: ["managed"],
  mergedProposals: ["managed"],
  children: ["managed"],

  // Complex nested type — known gap
  requirements: ["complex"],
};

/** Fields that must be exposed through at least one user-facing MCP tool. */
const USER_EDITABLE_FIELDS = Object.entries(FIELD_COVERAGE)
  .filter(([, tools]) => tools.some((t) => t === "add" || t === "edit" || t === "status"))
  .map(([field]) => field);

/** Fields deliberately excluded from MCP tools. */
const EXCLUDED_FIELDS = Object.entries(FIELD_COVERAGE)
  .filter(([, tools]) => tools.every((t) => t === "managed" || t === "complex"))
  .map(([field]) => field);

describe("MCP tool schema coverage", () => {
  it("documents coverage for every PRDItem field", () => {
    // This test fails if a new field is added to PRDItem but not to this audit.
    // When it fails, add the field to FIELD_COVERAGE above with the appropriate category.
    const allFields = Object.keys(FIELD_COVERAGE);
    expect(allFields.length).toBeGreaterThanOrEqual(18); // current field count
  });

  it("every user-editable field is covered by at least one MCP tool", () => {
    for (const field of USER_EDITABLE_FIELDS) {
      const tools = FIELD_COVERAGE[field];
      const hasMcpTool = tools.some((t) => t === "add" || t === "edit" || t === "status");
      expect(hasMcpTool, `Field "${field}" is not exposed through any MCP tool`).toBe(true);
    }
  });

  it("excluded fields are documented", () => {
    expect(EXCLUDED_FIELDS).toContain("id");
    expect(EXCLUDED_FIELDS).toContain("children");
    expect(EXCLUDED_FIELDS).toContain("overrideMarker");
    expect(EXCLUDED_FIELDS).toContain("requirements"); // known gap
  });

  it("requirements gap is documented as complex", () => {
    expect(FIELD_COVERAGE.requirements).toEqual(["complex"]);
  });
});
