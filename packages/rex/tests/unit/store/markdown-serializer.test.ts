import { describe, it, expect } from "vitest";
import { serializeDocument } from "../../../src/store/markdown-serializer.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalDoc(items: PRDItem[] = []): PRDDocument {
  return { schema: "rex/v1", title: "Test", items };
}

function epic(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Epic",
    status: "pending",
    level: "epic",
    ...overrides,
  };
}

function task(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Task",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function frontMatterOf(out: string): string {
  const start = out.indexOf("---\n");
  const end = out.indexOf("\n---\n", start + 4);
  if (start !== 0 || end === -1) throw new Error("No front-matter");
  return out.slice(0, end + 5);
}

// ── Front-matter ──────────────────────────────────────────────────────────────

describe("serializeDocument: front-matter", () => {
  it("starts with schema and title", () => {
    const out = serializeDocument(minimalDoc());
    expect(out).toMatch(/^---\nschema: rex\/v1\ntitle: Test\n/);
  });

  it("emits 'items: []' for an empty items array", () => {
    const out = serializeDocument(minimalDoc());
    expect(frontMatterOf(out)).toContain("items: []");
  });

  it("emits items as a YAML sequence with required fields first", () => {
    const out = serializeDocument(minimalDoc([epic()]));
    expect(frontMatterOf(out)).toContain("items:");
    expect(frontMatterOf(out)).toContain('- id: "11111111-1111-1111-1111-111111111111"');
    expect(frontMatterOf(out)).toContain("level: epic");
    expect(frontMatterOf(out)).toContain("title: Epic");
    expect(frontMatterOf(out)).toContain("status: pending");
  });

  it("preserves extra document-level keys", () => {
    const doc = { ...minimalDoc(), customDocKey: "doc-value" };
    const out = serializeDocument(doc);
    expect(frontMatterOf(out)).toContain("customDocKey: doc-value");
  });

  it("emits child hierarchy via children sequences", () => {
    const out = serializeDocument(minimalDoc([
      epic({ children: [task()] }),
    ]));
    expect(frontMatterOf(out)).toContain("children:");
    expect(frontMatterOf(out)).toContain("level: task");
  });
});

// ── Field ordering ────────────────────────────────────────────────────────────

describe("serializeDocument: field ordering", () => {
  it("emits id, level, title, status, priority before alphabetical fields", () => {
    const out = serializeDocument(minimalDoc([
      epic({
        priority: "high",
        tags: ["a"],
        source: "smart-add",
        startedAt: "2026-01-01T10:00:00.000Z",
      }),
    ]));
    const fm = frontMatterOf(out);
    const idIdx = fm.indexOf("id:");
    const levelIdx = fm.indexOf("level:");
    const titleIdx = fm.indexOf("title: Epic");
    const statusIdx = fm.indexOf("status:");
    const priorityIdx = fm.indexOf("priority:");
    const sourceIdx = fm.indexOf("source:");
    const startedAtIdx = fm.indexOf("startedAt:");
    const tagsIdx = fm.indexOf("tags:");

    expect(idIdx).toBeLessThan(levelIdx);
    expect(levelIdx).toBeLessThan(titleIdx);
    expect(titleIdx).toBeLessThan(statusIdx);
    expect(statusIdx).toBeLessThan(priorityIdx);
    expect(priorityIdx).toBeLessThan(sourceIdx);
    expect(sourceIdx).toBeLessThan(startedAtIdx);
    expect(startedAtIdx).toBeLessThan(tagsIdx);
  });

  it("emits description after other fields, children last", () => {
    const out = serializeDocument(minimalDoc([
      epic({ description: "desc", priority: "high", children: [task()] }),
    ]));
    const fm = frontMatterOf(out);
    const priorityIdx = fm.indexOf("priority:");
    const descriptionIdx = fm.indexOf("description:");
    const childrenIdx = fm.indexOf("children:");
    expect(priorityIdx).toBeLessThan(descriptionIdx);
    expect(descriptionIdx).toBeLessThan(childrenIdx);
  });
});

// ── Description encoding ─────────────────────────────────────────────────────

describe("serializeDocument: description", () => {
  it("emits single-line description as plain string", () => {
    const out = serializeDocument(minimalDoc([
      epic({ description: "Single line." }),
    ]));
    expect(frontMatterOf(out)).toContain("description: Single line.");
  });

  it("emits multi-line description as | block scalar", () => {
    const out = serializeDocument(minimalDoc([
      epic({ description: "Line 1\n\nLine 2" }),
    ]));
    const fm = frontMatterOf(out);
    expect(fm).toContain("description: |-");
    expect(fm).toContain("Line 1");
    expect(fm).toContain("Line 2");
  });
});

// ── Quoting and special values ───────────────────────────────────────────────

describe("serializeDocument: quoting", () => {
  it("quotes UUIDs", () => {
    const out = serializeDocument(minimalDoc([epic()]));
    expect(frontMatterOf(out)).toContain('id: "11111111-1111-1111-1111-111111111111"');
  });

  it("quotes ISO timestamps", () => {
    const out = serializeDocument(minimalDoc([
      epic({ startedAt: "2026-01-01T10:00:00.000Z" }),
    ]));
    expect(frontMatterOf(out)).toContain('startedAt: "2026-01-01T10:00:00.000Z"');
  });

  it("omits null/undefined fields", () => {
    const out = serializeDocument(minimalDoc([
      epic({ priority: undefined, description: undefined }),
    ]));
    expect(frontMatterOf(out)).not.toContain("priority:");
    expect(frontMatterOf(out)).not.toContain("description:");
  });

  it("omits empty arrays", () => {
    const out = serializeDocument(minimalDoc([
      epic({ tags: [] }),
    ]));
    expect(frontMatterOf(out)).not.toContain("tags:");
  });
});

// ── Requirements ─────────────────────────────────────────────────────────────

describe("serializeDocument: requirements", () => {
  it("writes Requirement.acceptanceCriteria: [] when empty (required field)", () => {
    const out = serializeDocument(minimalDoc([
      epic({
        requirements: [
          {
            id: "req-1",
            title: "Has CI",
            category: "quality",
            validationType: "automated",
            acceptanceCriteria: [],
          },
        ],
      }),
    ]));
    expect(frontMatterOf(out)).toContain("acceptanceCriteria: []");
  });
});

// ── Unknown fields ───────────────────────────────────────────────────────────

describe("serializeDocument: unknown fields", () => {
  it("emits unknown item fields directly (no _passthrough envelope)", () => {
    const out = serializeDocument(minimalDoc([
      epic({ customField: "hello", anotherField: 42 } as PRDItem),
    ]));
    const fm = frontMatterOf(out);
    expect(fm).toContain("customField: hello");
    expect(fm).toContain("anotherField: 42");
    expect(fm).not.toContain("_passthrough");
  });
});

// ── Body section ─────────────────────────────────────────────────────────────

describe("serializeDocument: body", () => {
  it("emits the auto-generated comment marker", () => {
    const out = serializeDocument(minimalDoc());
    expect(out).toContain("<!-- Auto-generated by rex.");
  });

  it("emits the document title as H1", () => {
    const out = serializeDocument(minimalDoc());
    expect(out).toContain("# Test\n");
  });

  it("renders each item with heading and meta line", () => {
    const out = serializeDocument(minimalDoc([
      epic({ priority: "high", tags: ["a", "b"] }),
    ]));
    expect(out).toContain("## Epic\n");
    expect(out).toContain("*epic · pending · priority: high · tags: a, b*");
  });

  it("renders children with deeper heading levels", () => {
    const out = serializeDocument(minimalDoc([
      epic({ children: [task()] }),
    ]));
    expect(out).toContain("## Epic\n");
    expect(out).toContain("#### Task\n");
  });

  it("ends with exactly one trailing newline", () => {
    const out = serializeDocument(minimalDoc([epic()]));
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

// ── Deleted items ────────────────────────────────────────────────────────────

describe("serializeDocument: deleted items", () => {
  it("includes deleted items in front-matter", () => {
    const out = serializeDocument(minimalDoc([
      epic({ status: "deleted" }),
    ]));
    expect(frontMatterOf(out)).toContain("status: deleted");
  });
});
