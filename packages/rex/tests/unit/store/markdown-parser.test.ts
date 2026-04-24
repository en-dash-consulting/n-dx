import { describe, it, expect } from "vitest";
import { parseDocument, MarkdownParseError } from "../../../src/store/markdown-parser.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function md(body: string): string {
  return `---\nschema: rex/v1\n---\n\n# Test Project\n\n${body}`;
}

const BASIC_EPIC = md(`\
## My Epic

\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`
`);

// ── Valid document parsing ────────────────────────────────────────────────────

describe("parseDocument: valid documents", () => {
  it("parses minimal document with no items", () => {
    const result = parseDocument("---\nschema: rex/v1\n---\n\n# Empty Project\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schema).toBe("rex/v1");
    expect(result.data.title).toBe("Empty Project");
    expect(result.data.items).toEqual([]);
  });

  it("parses document with a single epic", () => {
    const result = parseDocument(BASIC_EPIC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(1);
    const epic = result.data.items[0];
    expect(epic.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(epic.title).toBe("My Epic");
    expect(epic.status).toBe("pending");
    expect(epic.level).toBe("epic");
  });

  it("parses schema from front-matter", () => {
    const result = parseDocument(BASIC_EPIC);
    if (!result.ok) throw result.error;
    expect(result.data.schema).toBe("rex/v1");
  });

  it("preserves extra front-matter fields", () => {
    const input = "---\nschema: rex/v1\nextraKey: extra-value\n---\n\n# Title\n";
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data["extraKey"]).toBe("extra-value");
  });

  it("parses heading levels to item levels", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
level: epic
status: pending
\`\`\`

### Feature
\`\`\`rex-meta
id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
level: feature
status: pending
\`\`\`

#### Task
\`\`\`rex-meta
id: "cccccccc-cccc-cccc-cccc-cccccccccccc"
level: task
status: pending
\`\`\`

##### Subtask
\`\`\`rex-meta
id: "dddddddd-dddd-dddd-dddd-dddddddddddd"
level: subtask
status: pending
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const epic = result.data.items[0];
    expect(epic.level).toBe("epic");
    expect(epic.children?.[0].level).toBe("feature");
    expect(epic.children?.[0].children?.[0].level).toBe("task");
    expect(epic.children?.[0].children?.[0].children?.[0].level).toBe("subtask");
  });
});

// ── Tree structure ────────────────────────────────────────────────────────────

describe("parseDocument: tree structure", () => {
  it("builds parent-child relationships from heading depth", () => {
    const input = md(`\
## Epic A
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`

### Feature A.1
\`\`\`rex-meta
id: "22222222-2222-2222-2222-222222222222"
level: feature
status: pending
\`\`\`

### Feature A.2
\`\`\`rex-meta
id: "33333333-3333-3333-3333-333333333333"
level: feature
status: pending
\`\`\`

## Epic B
\`\`\`rex-meta
id: "44444444-4444-4444-4444-444444444444"
level: epic
status: pending
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items).toHaveLength(2);
    const epicA = result.data.items[0];
    expect(epicA.children).toHaveLength(2);
    expect(epicA.children?.[0].id).toBe("22222222-2222-2222-2222-222222222222");
    expect(epicA.children?.[1].id).toBe("33333333-3333-3333-3333-333333333333");
    expect(result.data.items[1].id).toBe("44444444-4444-4444-4444-444444444444");
  });

  it("handles deeply nested items", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`

### Feature
\`\`\`rex-meta
id: "22222222-2222-2222-2222-222222222222"
level: feature
status: pending
\`\`\`

#### Task
\`\`\`rex-meta
id: "33333333-3333-3333-3333-333333333333"
level: task
status: pending
\`\`\`

##### Subtask
\`\`\`rex-meta
id: "44444444-4444-4444-4444-444444444444"
level: subtask
status: pending
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const task = result.data.items[0].children?.[0].children?.[0];
    expect(task?.children).toHaveLength(1);
    expect(task?.children?.[0].level).toBe("subtask");
  });

  it("places items with no children as leaves", () => {
    const result = parseDocument(BASIC_EPIC);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].children).toBeUndefined();
  });
});

// ── Description parsing ───────────────────────────────────────────────────────

describe("parseDocument: description", () => {
  it("captures prose after rex-meta as description", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`

This is the description.
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].description).toBe("This is the description.");
  });

  it("strips leading and trailing blank lines from description", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`




Description text.


`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].description).toBe("Description text.");
  });

  it("returns undefined description when no prose", () => {
    const result = parseDocument(BASIC_EPIC);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].description).toBeUndefined();
  });

  it("handles multi-paragraph descriptions", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`

First paragraph.

Second paragraph.
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].description).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("description stops at next heading", () => {
    const input = md(`\
## Epic A
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
\`\`\`

Epic A description.

## Epic B
\`\`\`rex-meta
id: "22222222-2222-2222-2222-222222222222"
level: epic
status: pending
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].description).toBe("Epic A description.");
    expect(result.data.items[1].description).toBeUndefined();
  });
});

// ── Scalar types ──────────────────────────────────────────────────────────────

describe("parseDocument: scalar type fidelity", () => {
  it("parses quoted UUIDs as strings", () => {
    const result = parseDocument(BASIC_EPIC);
    if (!result.ok) throw result.error;
    expect(typeof result.data.items[0].id).toBe("string");
  });

  it("parses unquoted enum values as strings", () => {
    const result = parseDocument(BASIC_EPIC);
    if (!result.ok) throw result.error;
    expect(typeof result.data.items[0].status).toBe("string");
    expect(typeof result.data.items[0].level).toBe("string");
  });

  it("parses integers as numbers", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
tokenUsage:
  input: 100
  output: 50
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const tu = result.data.items[0]["tokenUsage"] as { input: number; output: number };
    expect(typeof tu.input).toBe("number");
    expect(tu.input).toBe(100);
  });

  it("parses floats as numbers", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
loe: 0.5
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(typeof result.data.items[0]["loe"]).toBe("number");
    expect(result.data.items[0]["loe"]).toBe(0.5);
  });

  it("parses quoted ISO timestamps as strings", () => {
    const ts = "2026-01-01T10:00:00.000Z";
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
startedAt: "${ts}"
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].startedAt).toBe(ts);
    expect(typeof result.data.items[0].startedAt).toBe("string");
  });

  it("parses string arrays as arrays", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
tags:
  - backend
  - auth
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(Array.isArray(result.data.items[0].tags)).toBe(true);
    expect(result.data.items[0].tags).toEqual(["backend", "auth"]);
  });
});

// ── Complex field parsing ─────────────────────────────────────────────────────

describe("parseDocument: complex fields", () => {
  it("parses activeIntervals correctly", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: in_progress
activeIntervals:
  - start: "2026-01-01T09:00:00.000Z"
    end: "2026-01-01T17:00:00.000Z"
  - start: "2026-01-02T09:00:00.000Z"
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const intervals = result.data.items[0].activeIntervals!;
    expect(intervals).toHaveLength(2);
    expect(intervals[0].start).toBe("2026-01-01T09:00:00.000Z");
    expect(intervals[0].end).toBe("2026-01-01T17:00:00.000Z");
    expect(intervals[1].start).toBe("2026-01-02T09:00:00.000Z");
    expect(intervals[1].end).toBeUndefined();
  });

  it("parses requirements with nested acceptanceCriteria", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
requirements:
  - id: "00000000-aaaa-4aaa-aaaa-000000000001"
    title: Rate limiting
    category: security
    validationType: automated
    acceptanceCriteria:
      - Max 5 per minute
      - Block after 5 failures
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const reqs = result.data.items[0].requirements!;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].title).toBe("Rate limiting");
    expect(reqs[0].category).toBe("security");
    expect(reqs[0].acceptanceCriteria).toEqual(["Max 5 per minute", "Block after 5 failures"]);
  });

  it("parses requirements with empty acceptanceCriteria array", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
requirements:
  - id: "00000000-aaaa-4aaa-aaaa-000000000001"
    title: Something
    category: technical
    validationType: manual
    acceptanceCriteria: []
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    expect(result.data.items[0].requirements![0].acceptanceCriteria).toEqual([]);
  });

  it("parses overrideMarker object", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
overrideMarker:
  type: duplicate_guard_override
  reason: exact_title
  reasonRef: exact_title:abc
  matchedItemId: abc
  matchedItemTitle: Existing
  matchedItemLevel: task
  matchedItemStatus: completed
  createdAt: "2026-01-10T09:00:00.000Z"
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const marker = result.data.items[0].overrideMarker!;
    expect(marker.type).toBe("duplicate_guard_override");
    expect(marker.reason).toBe("exact_title");
    expect(marker.createdAt).toBe("2026-01-10T09:00:00.000Z");
  });

  it("parses mergedProposals sequence", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
mergedProposals:
  - proposalNodeKey: p0:task:0:1
    proposalTitle: Original
    proposalKind: task
    reason: semantic_title
    score: 0.85
    mergedAt: "2026-01-10T09:00:00.000Z"
    source: smart-add
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const proposals = result.data.items[0].mergedProposals!;
    expect(proposals).toHaveLength(1);
    expect(proposals[0].score).toBe(0.85);
    expect(typeof proposals[0].score).toBe("number");
    expect(proposals[0].mergedAt).toBe("2026-01-10T09:00:00.000Z");
  });

  it("preserves duration when activeIntervals is present", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
activeIntervals:
  - start: "2026-01-01T09:00:00.000Z"
    end: "2026-01-01T17:00:00.000Z"
duration:
  totalMs: 28800000
  runningMs: 0
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const dur = result.data.items[0]["duration"] as { totalMs: number };
    expect(dur.totalMs).toBe(28800000);
  });
});

// ── Passthrough ───────────────────────────────────────────────────────────────

describe("parseDocument: passthrough", () => {
  it("unpacks _passthrough into top-level item fields", () => {
    const input = md(`\
## Epic
\`\`\`rex-meta
id: "11111111-1111-1111-1111-111111111111"
level: epic
status: pending
_passthrough:
  customField: hello
  anotherField: 42
\`\`\`
`);
    const result = parseDocument(input);
    if (!result.ok) throw result.error;
    const item = result.data.items[0];
    expect(item["customField"]).toBe("hello");
    expect(item["anotherField"]).toBe(42);
    // _passthrough itself should not be on the item
    expect(item["_passthrough"]).toBeUndefined();
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("parseDocument: error cases", () => {
  it("returns ParseResult with ok:false for missing front-matter", () => {
    const result = parseDocument("# Title\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(MarkdownParseError);
  });

  it("returns ParseResult with ok:false for unclosed front-matter", () => {
    const result = parseDocument("---\nschema: rex/v1\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.name).toBe("MarkdownParseError");
  });

  it("returns ParseResult with ok:false for missing H1 title", () => {
    const result = parseDocument("---\nschema: rex/v1\n---\n\n## Epic\n```rex-meta\nid: x\nlevel: epic\nstatus: pending\n```\n");
    expect(result.ok).toBe(false);
  });

  it("returns ParseResult with ok:false for missing rex-meta block", () => {
    const result = parseDocument("---\nschema: rex/v1\n---\n\n# Title\n\n## Epic without meta\n\nSome prose.\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("rex-meta");
  });

  it("returns ParseResult with ok:false for unclosed rex-meta block", () => {
    const result = parseDocument("---\nschema: rex/v1\n---\n\n# Title\n\n## Epic\n```rex-meta\nid: x\nlevel: epic\nstatus: pending\n");
    expect(result.ok).toBe(false);
  });

  it("never throws — returns ok:false instead", () => {
    expect(() => parseDocument("totally invalid input")).not.toThrow();
    const result = parseDocument("totally invalid input");
    expect(result.ok).toBe(false);
  });

  it("error type is MarkdownParseError", () => {
    const result = parseDocument("---\nschema: rex/v1\n");
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(MarkdownParseError);
    expect(result.error.name).toBe("MarkdownParseError");
  });
});
