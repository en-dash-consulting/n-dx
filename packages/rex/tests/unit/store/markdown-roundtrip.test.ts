/**
 * Round-trip fidelity tests for the markdown serializer + parser.
 *
 * The primary invariant tested here:
 *   serialize(parse(serialize(tree))) deep-equals serialize(tree)
 *
 * This ensures any valid PRD tree can be safely written to markdown
 * and read back without loss or mutation of the serialized form.
 */
import { describe, it, expect } from "vitest";
import { serializeDocument } from "../../../src/store/markdown-serializer.js";
import { parseDocument } from "../../../src/store/markdown-parser.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundTrip(doc: PRDDocument): string {
  const firstPass = serializeDocument(doc);
  const parsed = parseDocument(firstPass);
  if (!parsed.ok) throw new Error(`Parse failed: ${parsed.error.message}`);
  return serializeDocument(parsed.data);
}

function assertRoundTrip(doc: PRDDocument): void {
  const firstPass = serializeDocument(doc);
  const secondPass = roundTrip(doc);
  expect(secondPass).toBe(firstPass);
}

function minimalDoc(items: PRDItem[] = []): PRDDocument {
  return { schema: "rex/v1", title: "Test Project", items };
}

function epic(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "My Epic",
    status: "pending",
    level: "epic",
    ...overrides,
  };
}

function feature(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    title: "My Feature",
    status: "pending",
    level: "feature",
    ...overrides,
  };
}

function task(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    title: "My Task",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function subtask(overrides: Partial<PRDItem> = {}): PRDItem {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    title: "My Subtask",
    status: "pending",
    level: "subtask",
    ...overrides,
  };
}

// ── Basic round-trip ──────────────────────────────────────────────────────────

describe("round-trip: basic documents", () => {
  it("empty document round-trips correctly", () => {
    assertRoundTrip(minimalDoc());
  });

  it("minimal single epic round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic()]));
  });

  it("document title is preserved", () => {
    const doc = minimalDoc();
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data.title).toBe("Test Project");
    assertRoundTrip(doc);
  });

  it("schema field is preserved", () => {
    const doc = minimalDoc();
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data.schema).toBe("rex/v1");
    assertRoundTrip(doc);
  });
});

// ── All item levels ───────────────────────────────────────────────────────────

describe("round-trip: item levels", () => {
  it("all four levels round-trip correctly", () => {
    const doc = minimalDoc([
      epic({
        children: [
          feature({
            children: [
              task({
                children: [subtask()],
              }),
            ],
          }),
        ],
      }),
    ]);
    assertRoundTrip(doc);
  });

  it("multiple sibling epics round-trip correctly", () => {
    const doc = minimalDoc([
      epic({ id: "11111111-1111-1111-1111-111111111111", title: "Epic A" }),
      epic({ id: "22222222-2222-2222-2222-222222222222", title: "Epic B" }),
      epic({ id: "33333333-3333-3333-3333-333333333333", title: "Epic C" }),
    ]);
    assertRoundTrip(doc);
  });
});

// ── All status values ─────────────────────────────────────────────────────────

describe("round-trip: status values", () => {
  const statuses = ["pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted"] as const;
  for (const status of statuses) {
    it(`status "${status}" round-trips correctly`, () => {
      assertRoundTrip(minimalDoc([epic({ status })]));
    });
  }
});

// ── All priority values ───────────────────────────────────────────────────────

describe("round-trip: priority values", () => {
  const priorities = ["critical", "high", "medium", "low"] as const;
  for (const priority of priorities) {
    it(`priority "${priority}" round-trips correctly`, () => {
      assertRoundTrip(minimalDoc([epic({ priority })]));
    });
  }
});

// ── String fields ─────────────────────────────────────────────────────────────

describe("round-trip: string fields", () => {
  it("description round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({ description: "Simple description." })]));
  });

  it("multi-paragraph description round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({ description: "Para 1.\n\nPara 2.\n\nPara 3." })]));
  });

  it("source field round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({ source: "smart-add" })]));
  });

  it("resolutionType and resolutionDetail round-trip correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      status: "completed",
      resolutionType: "code-change",
      resolutionDetail: "Implemented the feature.",
    })]));
  });

  it("failureReason round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      status: "failing",
      failureReason: "Tests failed with exit code 1.",
    })]));
  });

  it("strings containing ': ' round-trip correctly (must be quoted)", () => {
    assertRoundTrip(minimalDoc([epic({
      resolutionDetail: "Fixed auth: returns correct token",
    })]));
  });

  it("loeRationale string round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      loeRationale: "Straightforward implementation.",
      loeConfidence: "high",
    } as PRDItem)]));
  });
});

// ── Numeric fields ────────────────────────────────────────────────────────────

describe("round-trip: numeric fields", () => {
  it("loe (float) round-trips as a number", () => {
    const doc = minimalDoc([epic({ loe: 0.5 } as PRDItem)]);
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    expect(typeof parsed.data.items[0]["loe"]).toBe("number");
    expect(parsed.data.items[0]["loe"]).toBe(0.5);
    assertRoundTrip(doc);
  });

  it("tokenUsage numbers round-trip as numbers", () => {
    const doc = minimalDoc([epic({
      tokenUsage: { input: 12345, output: 678, cacheCreationInput: 100, cacheReadInput: 50 },
    } as PRDItem)]);
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    const tu = parsed.data.items[0]["tokenUsage"] as { input: number; output: number };
    expect(typeof tu.input).toBe("number");
    expect(typeof tu.output).toBe("number");
    assertRoundTrip(doc);
  });

  it("requirement threshold (number) round-trips as a number", () => {
    const doc = minimalDoc([epic({
      requirements: [{
        id: "00000000-aaaa-4aaa-aaaa-000000000001",
        title: "Perf req",
        category: "performance",
        validationType: "metric",
        acceptanceCriteria: [],
        threshold: 200,
      }],
    })]);
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    const req = parsed.data.items[0].requirements![0];
    expect(typeof req.threshold).toBe("number");
    expect(req.threshold).toBe(200);
    assertRoundTrip(doc);
  });
});

// ── Array fields ──────────────────────────────────────────────────────────────

describe("round-trip: array fields", () => {
  it("tags array round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({ tags: ["backend", "auth", "security"] })]));
  });

  it("blockedBy array round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      blockedBy: ["22222222-2222-2222-2222-222222222222"],
    })]));
  });

  it("acceptanceCriteria array round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      acceptanceCriteria: ["Criterion one.", "Criterion two."],
    })]));
  });

  it("acceptanceCriteria with special chars round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      acceptanceCriteria: ["Response time ≤ 200ms", "Status code: 200 on success"],
    })]));
  });
});

// ── Timestamp fields ──────────────────────────────────────────────────────────

describe("round-trip: timestamp fields", () => {
  it("startedAt, completedAt, endedAt round-trip as strings", () => {
    const ts = "2026-01-01T10:00:00.000Z";
    const doc = minimalDoc([epic({ startedAt: ts, completedAt: ts, endedAt: ts })]);
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data.items[0].startedAt).toBe(ts);
    expect(typeof parsed.data.items[0].startedAt).toBe("string");
    assertRoundTrip(doc);
  });

  it("activeIntervals round-trip correctly", () => {
    const doc = minimalDoc([epic({
      activeIntervals: [
        { start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T17:00:00.000Z" },
        { start: "2026-01-02T09:00:00.000Z" }, // open interval
      ],
    })]);
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    const intervals = parsed.data.items[0].activeIntervals!;
    expect(intervals).toHaveLength(2);
    expect(intervals[0].end).toBe("2026-01-01T17:00:00.000Z");
    expect(intervals[1].end).toBeUndefined(); // open interval
    assertRoundTrip(doc);
  });
});

// ── Complex nested structures ─────────────────────────────────────────────────

describe("round-trip: complex structures", () => {
  it("requirements with full field set round-trip correctly", () => {
    const doc = minimalDoc([epic({
      requirements: [{
        id: "00000000-aaaa-4aaa-aaaa-000000000001",
        title: "Rate limiting",
        description: "Max 5 attempts per minute.",
        category: "security",
        validationType: "automated",
        acceptanceCriteria: ["p95 latency ≤ 200ms", "p99 latency ≤ 500ms"],
        validationCommand: "pnpm test -- auth/rate-limit",
        threshold: 5,
        priority: "high",
      }],
    })]);
    assertRoundTrip(doc);
  });

  it("overrideMarker round-trips correctly", () => {
    const doc = minimalDoc([epic({
      overrideMarker: {
        type: "duplicate_guard_override",
        reason: "exact_title",
        reasonRef: "exact_title:abc",
        matchedItemId: "abc",
        matchedItemTitle: "Existing item",
        matchedItemLevel: "task",
        matchedItemStatus: "completed",
        createdAt: "2026-01-10T09:00:00.000Z",
      },
    })]);
    assertRoundTrip(doc);
  });

  it("mergedProposals round-trip correctly", () => {
    const doc = minimalDoc([epic({
      mergedProposals: [{
        proposalNodeKey: "p0:task:0:1",
        proposalTitle: "Original proposal",
        proposalKind: "task",
        reason: "semantic_title",
        score: 0.85,
        mergedAt: "2026-01-10T09:00:00.000Z",
        source: "smart-add",
      }],
    })]);
    assertRoundTrip(doc);
  });

  it("passthrough fields round-trip correctly", () => {
    const doc = minimalDoc([{
      ...epic(),
      customField: "hello",
      anotherField: 42,
    } as PRDItem]);
    const firstPass = serializeDocument(doc);
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data.items[0]["customField"]).toBe("hello");
    expect(parsed.data.items[0]["anotherField"]).toBe(42);
    assertRoundTrip(doc);
  });

  it("full PRD document (schema spec example) round-trips correctly", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "My Project",
      items: [
        {
          id: "epic-uuid-0001",
          title: "Authentication",
          status: "in_progress",
          level: "epic",
          priority: "critical",
          tags: ["security", "auth"],
          source: "smart-add",
          startedAt: "2026-01-01T10:00:00.000Z",
          description: "Covers all user authentication and session management features.",
          children: [
            {
              id: "feature-uuid-0001",
              title: "Login Flow",
              status: "in_progress",
              level: "feature",
              priority: "high",
              startedAt: "2026-01-02T09:00:00.000Z",
              description: "Email/password login with rate limiting and brute-force protection.",
              children: [
                {
                  id: "task-uuid-0001",
                  title: "Implement login endpoint",
                  status: "completed",
                  level: "task",
                  priority: "high",
                  tags: ["backend"],
                  acceptanceCriteria: [
                    "POST /auth/login returns 200 with JWT on valid credentials",
                    "POST /auth/login returns 401 on invalid credentials",
                    "Rate limiting enforced: max 5 attempts per IP per minute",
                  ],
                  loe: 0.5,
                  loeRationale: "Straightforward CRUD with existing auth library.",
                  loeConfidence: "high",
                  startedAt: "2026-01-02T09:00:00.000Z",
                  completedAt: "2026-01-03T16:30:00.000Z",
                  endedAt: "2026-01-03T16:30:00.000Z",
                  activeIntervals: [
                    { start: "2026-01-02T09:00:00.000Z", end: "2026-01-03T16:30:00.000Z" },
                  ],
                  resolutionType: "code-change",
                  resolutionDetail: "Implemented POST /auth/login with bcrypt comparison and JWT signing.",
                  requirements: [{
                    id: "req-uuid-0001",
                    title: "Login rate limiting",
                    category: "security",
                    validationType: "automated",
                    validationCommand: "pnpm test -- auth/rate-limit",
                    acceptanceCriteria: ["Max 5 attempts per IP per minute"],
                  }],
                  description: "Implements `POST /auth/login`. Accepts `{ email, password }` and returns `{ token }` on success.",
                  children: [
                    {
                      id: "subtask-uuid-0001",
                      title: "Add integration test for rate limiting",
                      status: "completed",
                      level: "subtask",
                      priority: "medium",
                      startedAt: "2026-01-03T14:00:00.000Z",
                      completedAt: "2026-01-03T15:45:00.000Z",
                      activeIntervals: [
                        { start: "2026-01-03T14:00:00.000Z", end: "2026-01-03T15:45:00.000Z" },
                      ],
                      resolutionType: "code-change",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: "epic-uuid-0002",
          title: "Dashboard",
          status: "pending",
          level: "epic",
          priority: "medium",
        },
      ],
    };
    assertRoundTrip(doc);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("round-trip: edge cases", () => {
  it("item with all optional fields absent round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic()]));
  });

  it("unicode in titles and descriptions round-trips correctly", () => {
    assertRoundTrip(minimalDoc([epic({
      title: "Épique avec accents — «guillemets»",
      description: "Description with emoji 🚀 and CJK: 日本語",
    })]));
  });

  it("deleted items are included in output and round-trip correctly", () => {
    const doc = minimalDoc([epic({ status: "deleted" })]);
    const firstPass = serializeDocument(doc);
    expect(firstPass).toContain("status: deleted");
    assertRoundTrip(doc);
  });

  it("item with all statuses represented in a tree round-trips correctly", () => {
    const doc = minimalDoc([
      epic({ id: "e1", title: "E1", status: "in_progress", children: [
        feature({ id: "f1", title: "F1", status: "completed" }),
        feature({ id: "f2", title: "F2", status: "failing" }),
        feature({ id: "f3", title: "F3", status: "deferred" }),
        feature({ id: "f4", title: "F4", status: "blocked" }),
        feature({ id: "f5", title: "F5", status: "deleted" }),
      ]}),
    ]);
    assertRoundTrip(doc);
  });

  it("backticks in description are preserved", () => {
    const desc = "Use `POST /api/login` with JSON body.";
    assertRoundTrip(minimalDoc([epic({ description: desc })]));
    const firstPass = serializeDocument(minimalDoc([epic({ description: desc })]));
    const parsed = parseDocument(firstPass);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data.items[0].description).toBe(desc);
  });

  it("multiple requirements on one item round-trip correctly", () => {
    const doc = minimalDoc([epic({
      requirements: [
        {
          id: "00000000-aaaa-4aaa-aaaa-000000000001",
          title: "Req 1",
          category: "security",
          validationType: "automated",
          acceptanceCriteria: ["A", "B"],
        },
        {
          id: "00000000-aaaa-4aaa-aaaa-000000000002",
          title: "Req 2",
          category: "performance",
          validationType: "metric",
          acceptanceCriteria: [],
          threshold: 100,
        },
      ],
    })]);
    assertRoundTrip(doc);
  });

  it("re-opened task (multiple intervals, no completedAt) round-trips correctly", () => {
    const doc = minimalDoc([task({
      id: "33333333-3333-3333-3333-333333333333",
      level: "task",
      status: "in_progress",
      startedAt: "2026-01-01T09:00:00.000Z",
      activeIntervals: [
        { start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T17:00:00.000Z" },
        { start: "2026-01-02T09:00:00.000Z" }, // re-opened, currently open
      ],
    })]);
    assertRoundTrip(doc);
  });
});
