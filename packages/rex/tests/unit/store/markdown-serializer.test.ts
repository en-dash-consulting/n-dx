import { describe, it, expect } from "vitest";
import { serializeDocument } from "../../../src/store/markdown-serializer.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalEpic(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "My Epic",
    status: "pending",
    level: "epic",
    ...overrides,
  };
}

function minimalDoc(items: PRDItem[] = []): PRDDocument {
  return { schema: "rex/v1", title: "Test Project", items };
}

// ── Front-matter and title ────────────────────────────────────────────────────

describe("serializeDocument: front-matter and title", () => {
  it("writes YAML front-matter with schema field", () => {
    const out = serializeDocument(minimalDoc());
    expect(out).toContain("---\nschema: rex/v1\n---\n");
  });

  it("writes H1 title after front-matter", () => {
    const out = serializeDocument(minimalDoc());
    expect(out).toContain("\n# Test Project\n");
  });

  it("preserves extra document-level fields in front-matter", () => {
    const doc = { ...minimalDoc(), extraKey: "extra-value", numKey: 42 } as PRDDocument;
    const out = serializeDocument(doc);
    expect(out).toMatch(/---\nschema: rex\/v1\nextraKey: extra-value\nnumKey: 42\n---/);
  });

  it("ends with exactly one newline", () => {
    const out = serializeDocument(minimalDoc());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

// ── Heading levels ────────────────────────────────────────────────────────────

describe("serializeDocument: heading levels", () => {
  it("writes epics as H2", () => {
    const out = serializeDocument(minimalDoc([minimalEpic()]));
    expect(out).toContain("## My Epic");
  });

  it("writes features as H3", () => {
    const epic = minimalEpic({
      children: [{
        id: "22222222-2222-2222-2222-222222222222",
        title: "My Feature",
        status: "pending",
        level: "feature",
      }],
    });
    const out = serializeDocument(minimalDoc([epic]));
    expect(out).toContain("### My Feature");
  });

  it("writes tasks as H4", () => {
    const task: PRDItem = {
      id: "33333333-3333-3333-3333-333333333333",
      title: "My Task",
      status: "pending",
      level: "task",
    };
    const feature: PRDItem = {
      id: "22222222-2222-2222-2222-222222222222",
      title: "My Feature",
      status: "pending",
      level: "feature",
      children: [task],
    };
    const out = serializeDocument(minimalDoc([minimalEpic({ children: [feature] })]));
    expect(out).toContain("#### My Task");
  });

  it("writes subtasks as H5", () => {
    const subtask: PRDItem = {
      id: "44444444-4444-4444-4444-444444444444",
      title: "My Subtask",
      status: "pending",
      level: "subtask",
    };
    const task: PRDItem = {
      id: "33333333-3333-3333-3333-333333333333",
      title: "My Task",
      status: "pending",
      level: "task",
      children: [subtask],
    };
    const feature: PRDItem = {
      id: "22222222-2222-2222-2222-222222222222",
      title: "My Feature",
      status: "pending",
      level: "feature",
      children: [task],
    };
    const out = serializeDocument(minimalDoc([minimalEpic({ children: [feature] })]));
    expect(out).toContain("##### My Subtask");
  });
});

// ── rex-meta block ────────────────────────────────────────────────────────────

describe("serializeDocument: rex-meta block", () => {
  it("writes rex-meta fenced block with id, level, status first", () => {
    const out = serializeDocument(minimalDoc([minimalEpic()]));
    expect(out).toContain("```rex-meta");
    expect(out).toContain("id: \"11111111-1111-1111-1111-111111111111\"");
    expect(out).toContain("level: epic");
    expect(out).toContain("status: pending");
    expect(out).toContain("```");
  });

  it("always quotes UUIDs in id field", () => {
    const out = serializeDocument(minimalDoc([minimalEpic()]));
    expect(out).toContain("id: \"11111111-1111-1111-1111-111111111111\"");
  });

  it("writes priority when present", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ priority: "high" })]));
    expect(out).toContain("priority: high");
  });

  it("omits priority when absent", () => {
    const out = serializeDocument(minimalDoc([minimalEpic()]));
    expect(out).not.toContain("priority:");
  });

  it("writes tags as YAML sequence", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ tags: ["backend", "auth"] })]));
    expect(out).toContain("tags:\n  - backend\n  - auth");
  });

  it("omits tags when empty array", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ tags: [] })]));
    expect(out).not.toContain("tags:");
  });

  it("omits tags when undefined", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ tags: undefined })]));
    expect(out).not.toContain("tags:");
  });

  it("writes source field unquoted when safe", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ source: "smart-add" })]));
    expect(out).toContain("source: smart-add");
  });

  it("writes blockedBy as UUID sequence (quoted)", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ blockedBy: ["22222222-2222-2222-2222-222222222222"] }),
    ]));
    expect(out).toContain("blockedBy:\n  - \"22222222-2222-2222-2222-222222222222\"");
  });

  it("omits blockedBy when empty", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ blockedBy: [] })]));
    expect(out).not.toContain("blockedBy:");
  });

  it("always quotes ISO timestamps", () => {
    const ts = "2026-01-01T10:00:00.000Z";
    const out = serializeDocument(minimalDoc([minimalEpic({ startedAt: ts })]));
    expect(out).toContain(`startedAt: "${ts}"`);
  });

  it("writes completedAt, endedAt when present", () => {
    const ts = "2026-01-02T10:00:00.000Z";
    const out = serializeDocument(minimalDoc([
      minimalEpic({ completedAt: ts, endedAt: ts }),
    ]));
    expect(out).toContain(`completedAt: "${ts}"`);
    expect(out).toContain(`endedAt: "${ts}"`);
  });

  it("writes activeIntervals sequence", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        activeIntervals: [
          { start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T17:00:00.000Z" },
        ],
      }),
    ]));
    expect(out).toContain("activeIntervals:");
    expect(out).toContain("- start: \"2026-01-01T09:00:00.000Z\"");
    expect(out).toContain("  end: \"2026-01-01T17:00:00.000Z\"");
  });

  it("writes open interval (no end) correctly", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        activeIntervals: [{ start: "2026-01-01T09:00:00.000Z" }],
      }),
    ]));
    expect(out).toContain("- start: \"2026-01-01T09:00:00.000Z\"");
    expect(out).not.toContain("end:");
  });

  it("writes acceptanceCriteria sequence", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ acceptanceCriteria: ["Criterion one", "Criterion two"] }),
    ]));
    expect(out).toContain("acceptanceCriteria:");
    expect(out).toContain("  - Criterion one");
    expect(out).toContain("  - Criterion two");
  });

  it("omits acceptanceCriteria when empty on item", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ acceptanceCriteria: [] })]));
    expect(out).not.toContain("acceptanceCriteria:");
  });

  it("writes loe as number (no quotes)", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ loe: 0.5 } as PRDItem)]));
    expect(out).toContain("loe: 0.5");
  });

  it("writes loeRationale and loeConfidence", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        loeRationale: "Simple task.",
        loeConfidence: "high",
      } as PRDItem),
    ]));
    expect(out).toContain("loeRationale: Simple task.");
    expect(out).toContain("loeConfidence: high");
  });

  it("writes tokenUsage object", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        tokenUsage: { input: 100, output: 50 },
      } as PRDItem),
    ]));
    expect(out).toContain("tokenUsage:");
    expect(out).toContain("  input: 100");
    expect(out).toContain("  output: 50");
  });

  it("writes tokenUsage with optional cache fields", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        tokenUsage: { input: 100, output: 50, cacheCreationInput: 20, cacheReadInput: 10 },
      } as PRDItem),
    ]));
    expect(out).toContain("  cacheCreationInput: 20");
    expect(out).toContain("  cacheReadInput: 10");
  });

  it("writes resolutionType and resolutionDetail", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        resolutionType: "code-change",
        resolutionDetail: "Fixed the bug.",
      }),
    ]));
    expect(out).toContain("resolutionType: code-change");
    expect(out).toContain("resolutionDetail: Fixed the bug.");
  });

  it("writes failureReason", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ status: "failing", failureReason: "Tests failed." }),
    ]));
    expect(out).toContain("failureReason: Tests failed.");
  });
});

// ── Requirements ─────────────────────────────────────────────────────────────

describe("serializeDocument: requirements", () => {
  it("writes requirements sequence with all fields", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        requirements: [{
          id: "00000000-aaaa-4aaa-aaaa-000000000001",
          title: "Rate limiting",
          category: "security",
          validationType: "automated",
          acceptanceCriteria: ["Max 5 per minute"],
          validationCommand: "pnpm test",
          priority: "high",
        }],
      }),
    ]));
    expect(out).toContain("requirements:");
    expect(out).toContain("- id: \"00000000-aaaa-4aaa-aaaa-000000000001\"");
    expect(out).toContain("  title: Rate limiting");
    expect(out).toContain("  category: security");
    expect(out).toContain("  validationType: automated");
    expect(out).toContain("  validationCommand: pnpm test");
    expect(out).toContain("  priority: high");
    expect(out).toContain("  acceptanceCriteria:");
    expect(out).toContain("    - Max 5 per minute");
  });

  it("always writes acceptanceCriteria on Requirement even when empty", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        requirements: [{
          id: "00000000-aaaa-4aaa-aaaa-000000000001",
          title: "Something",
          category: "technical",
          validationType: "manual",
          acceptanceCriteria: [],
        }],
      }),
    ]));
    expect(out).toContain("acceptanceCriteria: []");
  });

  it("writes threshold as a number", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        requirements: [{
          id: "req-00000000-0000-0000-0000-000000000001",
          title: "Perf",
          category: "performance",
          validationType: "metric",
          acceptanceCriteria: [],
          threshold: 200,
        }],
      }),
    ]));
    expect(out).toContain("  threshold: 200");
  });
});

// ── Provenance fields ─────────────────────────────────────────────────────────

describe("serializeDocument: provenance fields", () => {
  it("writes overrideMarker object", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        overrideMarker: {
          type: "duplicate_guard_override",
          reason: "exact_title",
          reasonRef: "exact_title:abc",
          matchedItemId: "abc",
          matchedItemTitle: "Existing",
          matchedItemLevel: "task",
          matchedItemStatus: "completed",
          createdAt: "2026-01-10T09:00:00.000Z",
        },
      }),
    ]));
    expect(out).toContain("overrideMarker:");
    expect(out).toContain("  type: duplicate_guard_override");
    expect(out).toContain("  reason: exact_title");
    expect(out).toContain("  matchedItemId: abc");
  });

  it("writes mergedProposals sequence", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({
        mergedProposals: [{
          proposalNodeKey: "p0:task:0:1",
          proposalTitle: "Original",
          proposalKind: "task",
          reason: "semantic_title",
          score: 0.85,
          mergedAt: "2026-01-10T09:00:00.000Z",
          source: "smart-add",
        }],
      }),
    ]));
    expect(out).toContain("mergedProposals:");
    expect(out).toContain("- proposalNodeKey: p0:task:0:1");
    expect(out).toContain("  proposalTitle: Original");
    expect(out).toContain("  score: 0.85");
  });
});

// ── Passthrough fields ────────────────────────────────────────────────────────

describe("serializeDocument: passthrough fields", () => {
  it("collects unknown fields into _passthrough", () => {
    const item = { ...minimalEpic(), customField: "hello", anotherField: 42 } as PRDItem;
    const out = serializeDocument(minimalDoc([item]));
    expect(out).toContain("_passthrough:");
    expect(out).toContain("  customField: hello");
    expect(out).toContain("  anotherField: 42");
  });

  it("does not emit _passthrough when no unknown fields", () => {
    const out = serializeDocument(minimalDoc([minimalEpic()]));
    expect(out).not.toContain("_passthrough");
  });
});

// ── Field ordering ────────────────────────────────────────────────────────────

describe("serializeDocument: field ordering", () => {
  it("puts id, level, status, priority first in rex-meta", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ priority: "high", tags: ["x"], source: "s" }),
    ]));
    const metaStart = out.indexOf("```rex-meta");
    const idPos = out.indexOf("id:", metaStart);
    const levelPos = out.indexOf("level:", metaStart);
    const statusPos = out.indexOf("status:", metaStart);
    const priorityPos = out.indexOf("priority:", metaStart);
    const tagsPos = out.indexOf("tags:", metaStart);
    const sourcePos = out.indexOf("source:", metaStart);

    expect(idPos).toBeLessThan(levelPos);
    expect(levelPos).toBeLessThan(statusPos);
    expect(statusPos).toBeLessThan(priorityPos);
    // After the first four, remaining fields are alphabetical: source (s) < tags (t)
    expect(priorityPos).toBeLessThan(sourcePos);
    expect(sourcePos).toBeLessThan(tagsPos);
  });
});

// ── Description ───────────────────────────────────────────────────────────────

describe("serializeDocument: description", () => {
  it("writes description prose after rex-meta block", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ description: "This is the description." }),
    ]));
    // Closing fence is followed by blank line, then description
    expect(out).toContain("```\n\nThis is the description.\n");
  });

  it("omits description when undefined", () => {
    const out = serializeDocument(minimalDoc([minimalEpic()]));
    // After the closing fence there should be nothing but optional whitespace
    const lastFenceIdx = out.lastIndexOf("\n```\n");
    const afterFence = lastFenceIdx >= 0 ? out.slice(lastFenceIdx + 5) : "";
    expect(afterFence.trim()).toBe("");
  });

  it("handles multi-paragraph descriptions", () => {
    const desc = "First paragraph.\n\nSecond paragraph.";
    const out = serializeDocument(minimalDoc([minimalEpic({ description: desc })]));
    expect(out).toContain("First paragraph.\n\nSecond paragraph.");
  });
});

// ── DFS pre-order traversal ───────────────────────────────────────────────────

describe("serializeDocument: DFS pre-order traversal", () => {
  it("writes items in DFS pre-order", () => {
    const child: PRDItem = {
      id: "22222222-2222-2222-2222-222222222222",
      title: "Child Feature",
      status: "pending",
      level: "feature",
    };
    const epic = minimalEpic({ title: "Parent Epic", children: [child] });
    const out = serializeDocument(minimalDoc([epic]));
    const parentPos = out.indexOf("## Parent Epic");
    const childPos = out.indexOf("### Child Feature");
    expect(parentPos).toBeLessThan(childPos);
  });

  it("writes siblings after their subtrees", () => {
    const child: PRDItem = {
      id: "22222222-2222-2222-2222-222222222222",
      title: "Feature A.1",
      status: "pending",
      level: "feature",
    };
    const sibling: PRDItem = {
      id: "33333333-3333-3333-3333-333333333333",
      title: "Feature A.2",
      status: "pending",
      level: "feature",
    };
    const epic = minimalEpic({ title: "Epic A", children: [child, sibling] });
    const out = serializeDocument(minimalDoc([epic]));
    const a1Pos = out.indexOf("### Feature A.1");
    const a2Pos = out.indexOf("### Feature A.2");
    expect(a1Pos).toBeLessThan(a2Pos);
  });
});

// ── String quoting edge cases ─────────────────────────────────────────────────

describe("serializeDocument: string quoting", () => {
  it("quotes strings containing ': '", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ resolutionDetail: "Fixed auth: returns correct token" }),
    ]));
    expect(out).toContain("resolutionDetail: \"Fixed auth: returns correct token\"");
  });

  it("quotes empty string", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ source: "" } as PRDItem),
    ]));
    expect(out).toContain('source: ""');
  });

  it("does not quote safe plain strings", () => {
    const out = serializeDocument(minimalDoc([minimalEpic({ source: "smart-add" })]));
    expect(out).toContain("source: smart-add");
    // No surrounding quotes
    expect(out).not.toContain("source: \"smart-add\"");
  });

  it("quotes strings that look like numbers", () => {
    const out = serializeDocument(minimalDoc([
      { ...minimalEpic(), customField: "42" } as PRDItem,
    ]));
    // "42" as a string should be quoted so it round-trips as string, not number
    // (It goes into _passthrough)
    expect(out).toContain("\"42\"");
  });

  it("escapes backslashes and internal quotes in double-quoted strings", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ resolutionDetail: 'She said "hello" and used \\' }),
    ]));
    expect(out).toContain('\\"hello\\"');
    expect(out).toContain("\\\\");
  });
});

// ── Deleted items ─────────────────────────────────────────────────────────────

describe("serializeDocument: deleted items", () => {
  it("includes deleted items in output", () => {
    const out = serializeDocument(minimalDoc([
      minimalEpic({ status: "deleted" }),
    ]));
    expect(out).toContain("status: deleted");
  });
});
