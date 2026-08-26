/**
 * Three-way PRD markdown merge — one describe per field class.
 *
 * @see packages/rex/src/core/merge-driver.ts
 */

import { describe, it, expect } from "vitest";
import { mergePrdMarkdown } from "../../../src/core/merge-driver.js";

interface Doc {
  status?: string;
  priority?: string;
  tags?: string[];
  lastModified?: string;
  description?: string;
  body?: string;
}

/** Render a minimal PRD markdown file in the serializer's style. */
function doc(overrides: Doc = {}): string {
  const lines = [
    "---",
    'id: "aaaa1111-0000-0000-0000-000000000000"',
    'level: "task"',
    'title: "Sample Task"',
    `status: ${JSON.stringify(overrides.status ?? "pending")}`,
  ];
  if (overrides.priority) lines.push(`priority: ${JSON.stringify(overrides.priority)}`);
  if (overrides.description !== undefined) lines.push(`description: ${JSON.stringify(overrides.description)}`);
  if (overrides.tags) {
    lines.push("tags:");
    for (const t of overrides.tags) lines.push(`  - ${JSON.stringify(t)}`);
  }
  if (overrides.lastModified) lines.push(`lastModified: ${JSON.stringify(overrides.lastModified)}`);
  lines.push("---", "");
  if (overrides.body !== undefined) lines.push(overrides.body);
  return lines.join("\n");
}

describe("set-merge fields (tags/blockedBy)", () => {
  it("unions additions from both sides without conflict", () => {
    const base = doc({ tags: ["core"] });
    const ours = doc({ tags: ["core", "from-ours"] });
    const theirs = doc({ tags: ["core", "from-theirs"] });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain('- "core"');
    expect(merged).toContain('- "from-ours"');
    expect(merged).toContain('- "from-theirs"');
  });

  it("a removal on one side sticks even when the other side kept the value", () => {
    const base = doc({ tags: ["core", "doomed"] });
    const ours = doc({ tags: ["core"] }); // removed "doomed"
    const theirs = doc({ tags: ["core", "doomed", "new"] });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).not.toContain('"doomed"');
    expect(merged).toContain('- "new"');
  });
});

describe("latest-lastModified-wins fields (status/priority)", () => {
  it("takes the side whose lastModified is later when both changed", () => {
    const base = doc({ status: "pending", lastModified: "2026-08-01T00:00:00Z" });
    const ours = doc({ status: "in_progress", lastModified: "2026-08-10T00:00:00Z" });
    const theirs = doc({ status: "completed", lastModified: "2026-08-20T00:00:00Z" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain('status: "completed"');
    expect(merged).not.toContain("<<<<<<<");
    // lastModified itself resolves to the later stamp.
    expect(merged).toContain('lastModified: "2026-08-20T00:00:00Z"');
  });

  it("falls back to a real conflict when no timestamps distinguish the sides", () => {
    const base = doc({ status: "pending" });
    const ours = doc({ status: "in_progress" });
    const theirs = doc({ status: "completed" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual(["status"]);
    expect(merged).toContain("<<<<<<< ours");
    expect(merged).toContain('status: "in_progress"');
    expect(merged).toContain("=======");
    expect(merged).toContain('status: "completed"');
    expect(merged).toContain(">>>>>>> theirs");
  });

  it("one-sided change needs no timestamps at all", () => {
    const base = doc({ status: "pending" });
    const ours = doc({ status: "completed" });
    const theirs = doc({ status: "pending" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain('status: "completed"');
  });
});

describe("textual fields (description, body)", () => {
  it("a change on one side wins", () => {
    const base = doc({ description: "old words" });
    const ours = doc({ description: "old words" });
    const theirs = doc({ description: "new words" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain('description: "new words"');
  });

  it("divergent descriptions are a genuine conflict with standard markers", () => {
    const base = doc({ description: "old" });
    const ours = doc({ description: "ours version" });
    const theirs = doc({ description: "theirs version" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual(["description"]);
    expect(merged).toContain("<<<<<<< ours");
    expect(merged).toContain('description: "ours version"');
    expect(merged).toContain('description: "theirs version"');
    expect(merged).toContain(">>>>>>> theirs");
  });

  it("merges the body below the frontmatter three-way", () => {
    const base = doc({ body: "## Children\n\nshared" });
    const ours = doc({ body: "## Children\n\nshared" });
    const theirs = doc({ body: "## Children\n\nrewritten" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain("rewritten");
  });

  it("divergent bodies conflict without poisoning mergeable fields", () => {
    const base = doc({ tags: ["core"], body: "original" });
    const ours = doc({ tags: ["core", "ours-tag"], body: "ours body" });
    const theirs = doc({ tags: ["core", "theirs-tag"], body: "theirs body" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual(["body"]);
    // The tag union still merged cleanly around the body conflict.
    expect(merged).toContain('- "ours-tag"');
    expect(merged).toContain('- "theirs-tag"');
    expect(merged).toContain("<<<<<<< ours");
  });
});

describe("generic fields and structure", () => {
  it("identical changes on both sides collapse", () => {
    const base = doc({ priority: "low" });
    const ours = doc({ priority: "high" });
    const theirs = doc({ priority: "high" });

    const { conflicts, merged } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain('priority: "high"');
  });

  it("a field added on one side survives", () => {
    const base = doc();
    const ours = doc();
    const theirs = doc({ priority: "high" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).toContain('priority: "high"');
  });

  it("a field deleted on one side and untouched on the other stays deleted", () => {
    const base = doc({ priority: "low" });
    const ours = doc(); // deleted
    const theirs = doc({ priority: "low" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged).not.toContain("priority:");
  });

  it("the merged output is still a well-formed frontmatter document", () => {
    const base = doc({ tags: ["a"] });
    const ours = doc({ tags: ["a", "b"] });
    const theirs = doc({ status: "completed", tags: ["a"], lastModified: "2026-08-20T00:00:00Z" });

    const { merged, conflicts } = mergePrdMarkdown(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(merged.startsWith("---\n")).toBe(true);
    expect(merged.split("\n").filter((l) => l.trim() === "---").length).toBe(2);
    expect(merged).toContain('id: "aaaa1111-0000-0000-0000-000000000000"');
  });
});
