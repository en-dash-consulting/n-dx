/**
 * The product-layer delta `rex tree-diff` reports beside the change list, and
 * the host-neutral Markdown comment it renders.
 */

import { describe, it, expect } from "vitest";
import { diffProductLayer } from "../../../src/core/map-diff.js";
import { diffTrees } from "../../../src/core/tree-diff.js";
import { renderTreeDiffMarkdown, MAX_LISTED } from "../../../src/core/tree-diff-markdown.js";
import type { RuleNode } from "../../../src/schema/v2-rules.js";

const AREA = "a0000000-0000-4000-8000-000000000001";
const KEEP = "a0000000-0000-4000-8000-000000000002";
const EDIT = "a0000000-0000-4000-8000-000000000003";
const GOES = "a0000000-0000-4000-8000-000000000004";
const NEW = "a0000000-0000-4000-8000-000000000005";

function capability(id: string, title: string, extra: Record<string, unknown> = {}): RuleNode {
  return {
    id,
    type: "capability",
    title,
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    statement: `${title} works.`,
    criteria: [{ id: "c1", text: "It works" }],
    ...extra,
  } as RuleNode;
}

function area(children: RuleNode[]): RuleNode {
  return { id: AREA, type: "area", title: "Checkout", slug: "checkout", children } as RuleNode;
}

const before = [area([capability(KEEP, "Keep"), capability(EDIT, "Edit"), capability(GOES, "Goes")])];

describe("diffProductLayer", () => {
  it("reports added, modified and retired capabilities with their area", () => {
    const after = [
      area([
        capability(KEEP, "Keep"),
        capability(EDIT, "Edit", {
          statement: "Edit works better.",
          criteria: [{ id: "c1", text: "It works well" }, { id: "c2", text: "It is fast" }],
        }),
        capability(GOES, "Goes", { status: "deleted" }),
        capability(NEW, "New"),
      ]),
    ];

    const map = diffProductLayer(before, after);

    expect(map.counts).toEqual({ added: 1, modified: 1, retired: 1 });
    expect(map.added[0]).toMatchObject({ id: NEW, type: "capability", ancestors: ["Checkout"] });
    expect(map.retired[0]).toMatchObject({ id: GOES, title: "Goes" });
    expect(map.modified[0].fields).toEqual([
      { field: "statement", from: "Edit works.", to: "Edit works better." },
    ]);
    expect(map.modified[0].criteria).toEqual({
      added: [{ id: "c2", text: "It is fast" }],
      removed: [],
      changed: [{ id: "c1", from: "It works", to: "It works well" }],
    });
  });

  it("treats a missing baseline product layer (a v1 tree) as empty", () => {
    const map = diffProductLayer([], before);
    expect(map.counts).toEqual({ added: 3, modified: 0, retired: 0 });
  });

  it("is identical when nothing in the product layer moved", () => {
    expect(diffProductLayer(before, before).identical).toBe(true);
  });

  it("counts a capability under a deleted area as retired", () => {
    const after = [{ ...area(before[0].children ?? []), status: "deleted" } as RuleNode];
    expect(diffProductLayer(before, after).counts.retired).toBe(3);
  });
});

describe("renderTreeDiffMarkdown", () => {
  const diff = diffTrees([], []);

  it("puts a product map section beside the change list", () => {
    const map = diffProductLayer(before, [area([capability(KEEP, "Keep"), capability(NEW, "New")])]);
    const md = renderTreeDiffMarkdown({ fromLabel: "main", toLabel: "working tree", diff, map });

    expect(md).toContain("### Product map");
    expect(md).toContain("#### Capabilities added (1)");
    expect(md).toContain("#### Capabilities retired (2)");
    expect(md).toContain("### Changes");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("has no product map section without a v2 side", () => {
    const md = renderTreeDiffMarkdown({ fromLabel: "main", toLabel: "HEAD", diff });
    expect(md).not.toContain("Product map");
    expect(md).toContain("No differences.");
  });

  it("is host-neutral: no HTML, tables or task lists, and titles cannot inject Markdown", () => {
    const hostile = capability(NEW, "<b>x</b> | [link](http://e) `code` - [ ] *em*");
    const md = renderTreeDiffMarkdown({
      fromLabel: "main",
      toLabel: "HEAD",
      diff,
      map: diffProductLayer([], [area([hostile])]),
    });

    expect(md).not.toMatch(/(^|[^\\])<[a-z/]/im);
    expect(md).not.toMatch(/^\s*\|/m);
    expect(md).not.toMatch(/^\s*- \[[ x]\]/m);
    expect(md).toContain("\\<b\\>x\\</b\\> \\| \\[link\\](http://e) \\`code\\`");
  });

  it("breaks @mentions in titles so posting the comment pings no user or team", () => {
    const md = renderTreeDiffMarkdown({
      fromLabel: "main",
      toLabel: "HEAD",
      diff,
      map: diffProductLayer([], [area([capability(NEW, "Notify @infra/oncall and @alice")])]),
    });

    expect(md).not.toMatch(/@[A-Za-z0-9]/);
    expect(md).toContain("@‍infra/oncall");
    expect(md).toContain("@‍alice");
  });

  it("caps each section and says how many it left out", () => {
    const many = Array.from({ length: MAX_LISTED + 3 }, (_, i) =>
      capability(`b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Cap ${i}`),
    );
    const md = renderTreeDiffMarkdown({ fromLabel: "a", toLabel: "b", diff, map: diffProductLayer([], many) });
    expect(md).toContain("- …and 3 more");
  });
});
