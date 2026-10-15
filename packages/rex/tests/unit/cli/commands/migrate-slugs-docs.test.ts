/**
 * The pin that keeps `rex migrate-slugs`' operator-facing descriptions tied to
 * the rule they describe.
 *
 * Both of them drifted. The `rex --help` summary and the JSDoc above
 * `cmdMigrateSlugs` went on saying "id-qualified slugs" — the unconditional
 * `-{id6}` rule that slug rule 2 replaced — long after the module header three
 * lines above had been corrected to the title-only rule. Nothing tied either
 * string to behaviour, so nothing failed.
 *
 * It cost a real misdiagnosis on 2026-10-14: `prd-slug-conformance` failed on
 * one path whose title had been edited without its file being renamed, its
 * message sent the reader to `rex migrate-slugs`, and that command's own help
 * described a whole-tree migration to a *different* rule. The right command
 * read as the wrong one and the tree was edited by hand instead.
 *
 * So the strings are derived from {@link SLUG_RULE_SUMMARY}, which lives beside
 * `SLUG_RULE_VERSION`, and the cases below hold that one string to what the
 * serializer actually does. A rule change now breaks this file as well as
 * `slug-rule-version.test.ts`, and the fix is to restate the summary.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { usage } from "../../../../src/cli/commands/constants.js";
import { getCommandHelp } from "../../../../src/cli/help.js";
import {
  SLUG_RULE_SUMMARY,
  resolveSiblingSlugs,
  slugifyTitle,
} from "../../../../src/store/folder-tree-serializer.js";
import type { PRDItem } from "../../../../src/schema/index.js";

const MIGRATE_SLUGS_SOURCE = join(
  import.meta.dirname,
  "../../../../src/cli/commands/migrate-slugs.ts",
);

/** Wording that only describes the superseded rule, in any of these surfaces. */
const SUPERSEDED_RULE_WORDING = [/id-qualified/i, /every slug/i];

function item(id: string, title: string): PRDItem {
  return { id, title, status: "pending", level: "task" } as PRDItem;
}

describe("SLUG_RULE_SUMMARY describes what the serializer does", () => {
  it("'title-only' holds: a sibling whose title is unique takes no suffix", () => {
    const slugs = resolveSiblingSlugs([
      item("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Unique Title"),
      item("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Another Title"),
    ]);

    expect(slugs.get("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(slugifyTitle("Unique Title"));
    expect(slugs.get("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(slugifyTitle("Another Title"));
    expect(SLUG_RULE_SUMMARY).toContain("title-only");
  });

  it("'only where siblings collide' holds: a collision suffixes, and nothing else does", () => {
    const slugs = resolveSiblingSlugs([
      item("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Unique Title"),
      item("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Shared Title"),
      item("33333333-cccc-4ccc-8ccc-cccccccccccc", "Shared Title"),
    ]);

    // The colliding pair takes the `-{id6}` suffix the summary names...
    expect(slugs.get("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe("shared-title-222222");
    expect(slugs.get("33333333-cccc-4ccc-8ccc-cccccccccccc")).toBe("shared-title-333333");
    // ...and the sibling beside them, sharing the same parent, does not. This
    // is the half the superseded rule got wrong and the stale strings still
    // described: it suffixed unconditionally.
    expect(slugs.get("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("unique-title");

    expect(SLUG_RULE_SUMMARY).toContain("-{id6}");
    expect(SLUG_RULE_SUMMARY).toContain("only where siblings collide");
  });
});

describe("rex migrate-slugs' descriptions are derived from that summary", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  /** The one-line summary `rex --help` prints — what a reader meets first. */
  function commandSummaryLine(): string {
    usage();
    const output = logSpy.mock.calls[0][0] as string;
    const line = output.split("\n").find((l) => l.includes("migrate-slugs"));
    expect(line, "rex --help lists no migrate-slugs command").toBeDefined();
    return line as string;
  }

  it("the rex --help summary quotes the rule summary rather than paraphrasing it", () => {
    // `formatUsage` may wrap, so compare on collapsed whitespace.
    const collapsed = commandSummaryLine().replace(/\s+/g, " ");
    expect(collapsed).toContain(SLUG_RULE_SUMMARY);
  });

  it("the rex --help summary no longer describes the rule version 2 replaced", () => {
    const line = commandSummaryLine();
    for (const stale of SUPERSEDED_RULE_WORDING) {
      expect(line).not.toMatch(stale);
    }
  });

  it("rex migrate-slugs --help quotes the rule summary", () => {
    const help = getCommandHelp("migrate-slugs");
    expect(help, "migrate-slugs has no dedicated help").not.toBeNull();
    expect((help as string).replace(/\s+/g, " ")).toContain(SLUG_RULE_SUMMARY);
  });

  it("rex migrate-slugs --help says it re-serialises at the current rule and encodes none of its own", () => {
    // The two facts a reader needs to tell this command follows the serializer
    // — and so is the right tool for one drifted path as well as a whole tree.
    const help = (getCommandHelp("migrate-slugs") as string).replace(/\s+/g, " ");

    expect(help).toMatch(/re-serialise[sd]? the PRD tree at the current slug rule/i);
    expect(help).toMatch(/encodes no rule of its own/i);
    expect(help).toMatch(/idempotent/i);
  });

  it("rex migrate-slugs --help no longer describes the rule version 2 replaced", () => {
    const help = getCommandHelp("migrate-slugs") as string;
    for (const stale of SUPERSEDED_RULE_WORDING) {
      expect(help).not.toMatch(stale);
    }
  });

  it("the JSDoc on cmdMigrateSlugs agrees with the module header above it", () => {
    // Prose, so it cannot be derived — but it sat four lines below a correct
    // module header and contradicted it, which is the shape this guards.
    const source = readFileSync(MIGRATE_SLUGS_SOURCE, "utf-8");
    const jsdoc = source.slice(
      source.indexOf("/**", source.indexOf("import { join }")),
      source.indexOf("export async function cmdMigrateSlugs"),
    );

    expect(jsdoc).toContain("rex migrate-slugs");
    expect(jsdoc).toMatch(/title-only/i);
    expect(jsdoc).toMatch(/encodes no rule of its own/i);
    for (const stale of SUPERSEDED_RULE_WORDING) {
      expect(jsdoc).not.toMatch(stale);
    }
  });
});
