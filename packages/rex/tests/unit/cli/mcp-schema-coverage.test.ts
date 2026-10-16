/**
 * Guard: every mutable `PRDItem` field is writable through some operator
 * surface, or is explicitly exempt with a stated reason.
 *
 * ## Why this file was rewritten
 *
 * The previous version could not fail. It held a hand-written `FIELD_COVERAGE`
 * map, derived `USER_EDITABLE_FIELDS` from that map, and then asserted that
 * each of those fields had a tool — by consulting the same map it had just
 * been derived from. A field added to `PRDItem` and never added to the map was
 * invisible to it, and the only backstop was `allFields.length >= 18`, which
 * passes as long as nobody deletes an entry.
 *
 * `assignee` is what that cost. It reached the schema and was read by task
 * selection (`matchesAssignee`, `ndx work --mine`) while no CLI flag or MCP
 * parameter could write it, so hand-editing frontmatter was the only route —
 * the same wall #630 hit. The audit that was meant to prevent exactly this had
 * been marked complete.
 *
 * This version reads both sides from the real artifacts instead:
 *  - field names are parsed out of the `PRDItem` interface in `schema/v1.ts`;
 *  - tool parameters come from the live zod shapes on `REX_MCP_TOOLS`;
 *  - CLI flags come from the `flags.*` reads in `commands/update.ts`.
 *
 * So adding a field to `PRDItem` forces a deliberate choice: expose it, or
 * exempt it here with a reason. Neither happens by default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { REX_MCP_TOOLS } from "../../../src/cli/mcp-tools/index.js";

const SRC = join(fileURLToPath(new URL("../../../src/", import.meta.url)));

/** Member names of an interface, read from the TypeScript source. */
function interfaceFields(relPath: string, name: string): string[] {
  const path = join(SRC, relPath);
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) out.push(member.name.getText(sf));
      }
    }
  });
  if (out.length === 0) throw new Error(`No interface "${name}" with members in ${relPath}`);
  return out;
}

/** Parameter names a registered MCP tool accepts. */
function toolParams(toolName: string): string[] {
  const tool = REX_MCP_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`No MCP tool named "${toolName}"`);
  return Object.keys(tool.schema);
}

/** Flag names `rex update` reads, taken from its own source. */
function updateFlags(): string[] {
  const path = join(SRC, "cli/commands/update.ts");
  const src = readFileSync(path, "utf8");
  const names = new Set<string>();
  for (const m of src.matchAll(/\b(?:flags|multiFlags)\.([A-Za-z][A-Za-z0-9_]*)/g)) names.add(m[1]);
  return [...names];
}

/**
 * Fields no operator surface writes, and why.
 *
 * An entry here is a decision, not a backlog item. If a field belongs to the
 * operator, give it a parameter instead of a row.
 */
const EXEMPT: Record<string, string> = {
  id: "Identity. Assigned at creation and never rewritten.",
  children: "Structure, not content — reparenting goes through move_item.",

  // Lifecycle, derived from status transitions.
  startedAt: "Stamped by the first transition into in_progress.",
  completedAt: "Stamped by a transition into completed.",
  endedAt: "Stamped on leaving in_progress for a terminal state.",
  activeIntervals: "Append-only work log maintained by status transitions.",

  // Provenance and attribution, stamped on write.
  branch: "Provenance, stamped from the git branch on write.",
  sourceFile: "Provenance, stamped when an item is imported from a PRD file.",
  lastModified: "Attribution, stamped by the store on every mutation.",
  lastModifiedBy: "Attribution, stamped by the store on every mutation.",
  commits: "Collected from N-DX-Item commit trailers, not typed by an operator.",

  // Computed or internal.
  ready: "Recomputed by `rex ready`; writing it by hand would go stale.",
  overrideMarker: "Internal marker for proposal overrides.",
  mergedProposals: "Internal bookkeeping written by merge_items.",
  links: "Derived cross-references, not operator-authored.",

  // Known gap, deliberately carried.
  requirements: "Nested structure with no flat parameter form. Known gap.",
};

/**
 * Parameters that identify the item rather than write it. `id` appears in
 * every write tool's shape as the target selector, which is not the same as
 * being an editable field.
 */
const SELECTORS = new Set(["id"]);

/** Parameters that write a field under a different name. */
const ALIASES: Record<string, string[]> = {
  failureReason: ["reason"],
};

describe("every mutable PRDItem field has a write surface", () => {
  const fields = interfaceFields("schema/v1.ts", "PRDItem");

  /** Every name an operator can write today, across MCP and the CLI. */
  const writable = new Set<string>(
    [
      ...toolParams("add_item"),
      ...toolParams("edit_item"),
      ...toolParams("update_task_status"),
      ...updateFlags(),
    ].filter((name) => !SELECTORS.has(name)),
  );

  function isCovered(field: string): boolean {
    if (writable.has(field)) return true;
    return (ALIASES[field] ?? []).some((alias) => writable.has(alias));
  }

  it("reads a plausible field list from the PRDItem interface", () => {
    // Guards the parser itself: a rename or refactor that silently returned
    // nothing would make every assertion below vacuous.
    expect(fields).toContain("title");
    expect(fields).toContain("status");
    expect(fields.length).toBeGreaterThan(20);
  });

  it("covers or exempts every field", () => {
    const unaccounted = fields.filter((f) => !isCovered(f) && !(f in EXEMPT));
    expect(
      unaccounted,
      `These PRDItem fields can be read but not written. Either add a parameter to ` +
        `add_item/edit_item/update_task_status or a 'rex update' flag, or add the field ` +
        `to EXEMPT in this file with the reason it is not operator-writable:\n  ` +
        unaccounted.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a field that no longer exists hides the next gap.
    const stale = Object.keys(EXEMPT).filter((f) => !fields.includes(f));
    expect(stale, `EXEMPT names fields that are no longer on PRDItem: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("does not exempt a field that is in fact writable", () => {
    // A field with both a parameter and an exemption means the reason is wrong.
    const contradictory = Object.keys(EXEMPT).filter((f) => writable.has(f));
    expect(
      contradictory,
      `These fields are exempt but also writable, so their stated reason is wrong: ${contradictory.join(", ")}`,
    ).toEqual([]);
  });

  it("catches the regression that motivated this guard", () => {
    // assignee is the field that slipped through the previous audit.
    expect(toolParams("add_item")).toContain("assignee");
    expect(toolParams("edit_item")).toContain("assignee");
    expect(updateFlags()).toContain("assignee");
  });
});
