import { describe, it, expect } from "vitest";
import { parseDocument, MarkdownParseError } from "../../../src/store/markdown-parser.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a YAML body in `---` markers and append an empty body section. */
function fm(yamlBody: string): string {
  return `---\n${yamlBody}\n---\n\n# Title\n`;
}

const MINIMAL_EPIC_YAML = `\
schema: rex/v1
title: Test
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: My Epic
    status: pending`;

// ── Valid document parsing ────────────────────────────────────────────────────

describe("parseDocument: valid documents", () => {
  it("parses minimal empty document", () => {
    const result = parseDocument(fm("schema: rex/v1\ntitle: Empty\nitems: []"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schema).toBe("rex/v1");
    expect(result.data.title).toBe("Empty");
    expect(result.data.items).toEqual([]);
  });

  it("parses document with a single epic", () => {
    const result = parseDocument(fm(MINIMAL_EPIC_YAML));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(1);
    const epic = result.data.items[0];
    expect(epic.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(epic.title).toBe("My Epic");
    expect(epic.status).toBe("pending");
    expect(epic.level).toBe("epic");
  });

  it("preserves extra front-matter fields on the document", () => {
    const result = parseDocument(fm("schema: rex/v1\ntitle: T\nextraKey: extra-value"));
    if (!result.ok) throw result.error;
    expect(result.data["extraKey"]).toBe("extra-value");
  });

  it("ignores body content after the front-matter", () => {
    const md = fm(MINIMAL_EPIC_YAML) +
      "\n## Some heading without rex-meta\n\nProse with `## inline headings` is fine.\n";
    const result = parseDocument(md);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(1);
  });
});

// ── Tree structure ────────────────────────────────────────────────────────────

describe("parseDocument: tree structure", () => {
  it("encodes hierarchy via children sequences", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    children:
      - id: "22222222-2222-2222-2222-222222222222"
        level: feature
        title: F
        status: pending
        children:
          - id: "33333333-3333-3333-3333-333333333333"
            level: task
            title: T
            status: pending
            children:
              - id: "44444444-4444-4444-4444-444444444444"
                level: subtask
                title: S
                status: pending`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    const epic = result.data.items[0];
    expect(epic.level).toBe("epic");
    expect(epic.children?.[0].level).toBe("feature");
    expect(epic.children?.[0].children?.[0].level).toBe("task");
    expect(epic.children?.[0].children?.[0].children?.[0].level).toBe("subtask");
  });

  it("supports root-level items at any level (no marker required)", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: Root Epic
    status: pending
  - id: "22222222-2222-2222-2222-222222222222"
    level: task
    title: Root Task
    status: pending`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0].level).toBe("epic");
    expect(result.data.items[1].level).toBe("task");
  });
});

// ── Description and complex fields ───────────────────────────────────────────

describe("parseDocument: description", () => {
  it("parses single-line description", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    description: A short description.`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    expect(result.data.items[0].description).toBe("A short description.");
  });

  it("parses multi-line description from | block scalar", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    description: |-
      First paragraph.

      ## Heading inside description (markdown content)

      Third paragraph.`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    const desc = result.data.items[0].description;
    expect(desc).toContain("First paragraph.");
    expect(desc).toContain("## Heading inside description");
    expect(desc).toContain("Third paragraph.");
  });
});

describe("parseDocument: scalar type fidelity", () => {
  it("parses ISO timestamps as strings", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    startedAt: "2026-01-01T10:00:00.000Z"`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    expect(result.data.items[0].startedAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("parses numbers and booleans correctly", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    loe: 1.5
    customBool: true`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    const item = result.data.items[0] as Record<string, unknown>;
    expect(item.loe).toBe(1.5);
    expect(item.customBool).toBe(true);
  });
});

describe("parseDocument: complex fields", () => {
  it("parses acceptanceCriteria as string array", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    acceptanceCriteria:
      - "First criterion"
      - "Second criterion"`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    expect(result.data.items[0].acceptanceCriteria).toEqual(["First criterion", "Second criterion"]);
  });

  it("parses requirements with nested fields", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    requirements:
      - id: "req-uuid"
        title: "Latency"
        category: performance
        validationType: metric
        threshold: 200
        acceptanceCriteria:
          - "p95 < 200ms"`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    const reqs = result.data.items[0].requirements!;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].title).toBe("Latency");
    expect(reqs[0].threshold).toBe(200);
    expect(reqs[0].acceptanceCriteria).toEqual(["p95 < 200ms"]);
  });

  it("parses tokenUsage object", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    tokenUsage:
      input: 12345
      output: 678`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    expect(result.data.items[0].tokenUsage).toEqual({ input: 12345, output: 678 });
  });
});

describe("parseDocument: unknown fields preserved", () => {
  it("preserves unknown item fields directly (no _passthrough envelope)", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - id: "11111111-1111-1111-1111-111111111111"
    level: epic
    title: E
    status: pending
    customField: hello
    anotherField: 42`;
    const result = parseDocument(fm(yaml));
    if (!result.ok) throw result.error;
    const item = result.data.items[0] as Record<string, unknown>;
    expect(item.customField).toBe("hello");
    expect(item.anotherField).toBe(42);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("parseDocument: error cases", () => {
  it("returns ok:false for missing front-matter", () => {
    const result = parseDocument("# Title\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MarkdownParseError);
  });

  it("returns ok:false for unclosed front-matter", () => {
    const result = parseDocument("---\nschema: rex/v1\n");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for missing schema field", () => {
    const result = parseDocument("---\ntitle: T\nitems: []\n---\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("schema");
  });

  it("returns ok:false for missing title field", () => {
    const result = parseDocument("---\nschema: rex/v1\nitems: []\n---\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("title");
  });

  it("returns ok:false when items is not a sequence", () => {
    const result = parseDocument("---\nschema: rex/v1\ntitle: T\nitems: oops\n---\n");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when an item is missing id", () => {
    const yaml = `\
schema: rex/v1
title: T
items:
  - level: epic
    title: E
    status: pending`;
    const result = parseDocument(fm(yaml));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("id");
  });

  it("never throws — returns ok:false for arbitrary input", () => {
    expect(() => parseDocument("totally invalid input")).not.toThrow();
    const result = parseDocument("totally invalid input");
    expect(result.ok).toBe(false);
  });
});
