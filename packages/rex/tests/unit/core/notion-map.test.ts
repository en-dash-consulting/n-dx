import { describe, it, expect } from "vitest";
import {
  mapItemToNotion,
  mapNotionToItem,
  mapDocumentToNotion,
  mapNotionToDocument,
  resolveParentPage,
  NOTION_LEVEL_CONFIG,
} from "../../../src/core/notion-map.js";
import type { PRDItem, PRDDocument } from "../../../src/schema/index.js";

function makeItem(
  overrides: Partial<PRDItem> & { id: string; title: string },
): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("NOTION_LEVEL_CONFIG", () => {
  it("defines config for all four PRD levels", () => {
    expect(NOTION_LEVEL_CONFIG.epic).toBeDefined();
    expect(NOTION_LEVEL_CONFIG.feature).toBeDefined();
    expect(NOTION_LEVEL_CONFIG.task).toBeDefined();
    expect(NOTION_LEVEL_CONFIG.subtask).toBeDefined();
  });

  it("epics are top-level (no parent level)", () => {
    expect(NOTION_LEVEL_CONFIG.epic.parentLevel).toBeNull();
  });

  it("features nest under epics", () => {
    expect(NOTION_LEVEL_CONFIG.feature.parentLevel).toBe("epic");
  });

  it("tasks nest under features", () => {
    expect(NOTION_LEVEL_CONFIG.task.parentLevel).toBe("feature");
  });

  it("subtasks nest under tasks", () => {
    expect(NOTION_LEVEL_CONFIG.subtask.parentLevel).toBe("task");
  });

  it("maps status values for all levels", () => {
    for (const level of ["epic", "feature", "task", "subtask"] as const) {
      const config = NOTION_LEVEL_CONFIG[level];
      expect(config.statusMap.pending).toBeDefined();
      expect(config.statusMap.in_progress).toBeDefined();
      expect(config.statusMap.completed).toBeDefined();
      expect(config.statusMap.deferred).toBeDefined();
    }
  });
});

describe("mapItemToNotion", () => {
  it("maps a basic task to Notion page properties", () => {
    const item = makeItem({ id: "t1", title: "Implement feature" });
    const result = mapItemToNotion(item);

    expect(result.properties.Name).toEqual({
      title: [{ text: { content: "Implement feature" } }],
    });
    expect(result.properties.Status).toEqual({
      status: { name: "Not started" },
    });
    expect(result.properties.Level).toEqual({
      select: { name: "task" },
    });
    expect(result.properties["PRD ID"]).toEqual({
      rich_text: [{ text: { content: "t1" } }],
    });
  });

  it("maps all status values correctly", () => {
    const statuses = [
      { prd: "pending", notion: "Not started" },
      { prd: "in_progress", notion: "In progress" },
      { prd: "completed", notion: "Done" },
      { prd: "deferred", notion: "Deferred" },
    ] as const;

    for (const { prd, notion } of statuses) {
      const item = makeItem({ id: "t1", title: "Task", status: prd });
      const result = mapItemToNotion(item);
      expect(result.properties.Status).toEqual({
        status: { name: notion },
      });
    }
  });

  it("maps priority when present", () => {
    const item = makeItem({ id: "t1", title: "Task", priority: "high" });
    const result = mapItemToNotion(item);
    expect(result.properties.Priority).toEqual({
      select: { name: "High" },
    });
  });

  it("omits priority when not set", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const result = mapItemToNotion(item);
    expect(result.properties.Priority).toBeUndefined();
  });

  it("maps tags to multi-select", () => {
    const item = makeItem({ id: "t1", title: "Task", tags: ["api", "auth"] });
    const result = mapItemToNotion(item);
    expect(result.properties.Tags).toEqual({
      multi_select: [{ name: "api" }, { name: "auth" }],
    });
  });

  it("omits tags when not set", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const result = mapItemToNotion(item);
    expect(result.properties.Tags).toBeUndefined();
  });

  it("maps description to both property and body content blocks", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      description: "This is the description",
    });
    const result = mapItemToNotion(item);

    // Description property
    expect(result.properties.Description).toEqual({
      rich_text: [{ text: { content: "This is the description" } }],
    });

    // Body block
    expect(result.children).toHaveLength(1);
    expect(result.children![0]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ text: { content: "This is the description" } }],
      },
    });
  });

  it("omits description property when not set", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const result = mapItemToNotion(item);
    expect(result.properties.Description).toBeUndefined();
  });

  it("maps source to rich_text property", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      source: "rex-analyze",
    });
    const result = mapItemToNotion(item);
    expect(result.properties.Source).toEqual({
      rich_text: [{ text: { content: "rex-analyze" } }],
    });
  });

  it("omits source when not set", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const result = mapItemToNotion(item);
    expect(result.properties.Source).toBeUndefined();
  });

  it("maps blockedBy to comma-separated rich_text property", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      blockedBy: ["t2", "t3"],
    });
    const result = mapItemToNotion(item);
    expect(result.properties["Blocked By"]).toEqual({
      rich_text: [{ text: { content: "t2, t3" } }],
    });
  });

  it("omits blockedBy when not set", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const result = mapItemToNotion(item);
    expect(result.properties["Blocked By"]).toBeUndefined();
  });

  it("omits blockedBy when empty array", () => {
    const item = makeItem({ id: "t1", title: "Task", blockedBy: [] });
    const result = mapItemToNotion(item);
    expect(result.properties["Blocked By"]).toBeUndefined();
  });

  it("maps all PRD fields to Notion properties", () => {
    const item = makeItem({
      id: "t1",
      title: "Full Task",
      status: "in_progress",
      level: "task",
      description: "A complete task",
      priority: "critical",
      tags: ["backend", "urgent"],
      source: "manual",
      blockedBy: ["t0"],
      acceptanceCriteria: ["Tests pass", "Code reviewed"],
    });
    const result = mapItemToNotion(item);

    // All properties present
    expect(result.properties.Name.title[0].text.content).toBe("Full Task");
    expect(result.properties.Status.status.name).toBe("In progress");
    expect(result.properties.Level.select.name).toBe("task");
    expect(result.properties["PRD ID"].rich_text[0].text.content).toBe("t1");
    expect(result.properties.Description!.rich_text[0].text.content).toBe("A complete task");
    expect(result.properties.Priority!.select.name).toBe("Critical");
    expect(result.properties.Tags!.multi_select).toEqual([
      { name: "backend" },
      { name: "urgent" },
    ]);
    expect(result.properties.Source!.rich_text[0].text.content).toBe("manual");
    expect(result.properties["Blocked By"]!.rich_text[0].text.content).toBe("t0");

    // Body blocks: description paragraph + heading + 2 to_do
    expect(result.children).toHaveLength(4);
  });

  it("maps acceptance criteria to a checklist in body", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      acceptanceCriteria: ["AC1", "AC2"],
    });
    const result = mapItemToNotion(item);
    // heading + 2 to_do blocks
    expect(result.children).toHaveLength(3);
    expect(result.children![0]).toEqual({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ text: { content: "Acceptance Criteria" } }],
      },
    });
    expect(result.children![1]).toEqual({
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: [{ text: { content: "AC1" } }],
        checked: false,
      },
    });
    expect(result.children![2]).toEqual({
      object: "block",
      type: "to_do",
      to_do: {
        rich_text: [{ text: { content: "AC2" } }],
        checked: false,
      },
    });
  });

  it("includes both description and acceptance criteria", () => {
    const item = makeItem({
      id: "t1",
      title: "Task",
      description: "Description text",
      acceptanceCriteria: ["AC1"],
    });
    const result = mapItemToNotion(item);
    // paragraph + heading + 1 to_do
    expect(result.children).toHaveLength(3);
  });

  it("maps epic level correctly", () => {
    const item = makeItem({
      id: "e1",
      title: "Big Epic",
      level: "epic",
      status: "in_progress",
    });
    const result = mapItemToNotion(item);
    expect(result.properties.Level).toEqual({ select: { name: "epic" } });
    expect(result.properties.Status).toEqual({
      status: { name: "In progress" },
    });
  });
});

describe("mapNotionToItem", () => {
  it("maps a Notion page to a PRDItem", () => {
    const notionPage = {
      id: "notion-page-123",
      properties: {
        Name: { title: [{ plain_text: "My Task" }] },
        Status: { status: { name: "In progress" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        Priority: { select: { name: "High" } },
        Tags: { multi_select: [{ name: "api" }, { name: "auth" }] },
      },
    };

    const item = mapNotionToItem(notionPage);
    expect(item.id).toBe("t1");
    expect(item.title).toBe("My Task");
    expect(item.status).toBe("in_progress");
    expect(item.level).toBe("task");
    expect(item.priority).toBe("high");
    expect(item.tags).toEqual(["api", "auth"]);
    expect(item.remoteId).toBe("notion-page-123");
  });

  it("uses Notion page ID as item ID when no PRD ID present", () => {
    const notionPage = {
      id: "notion-page-456",
      properties: {
        Name: { title: [{ plain_text: "New Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [] },
      },
    };

    const item = mapNotionToItem(notionPage);
    expect(item.id).toBe("notion-page-456");
  });

  it("maps all Notion statuses back to PRD statuses", () => {
    const cases = [
      { notion: "Not started", prd: "pending" },
      { notion: "In progress", prd: "in_progress" },
      { notion: "Done", prd: "completed" },
      { notion: "Deferred", prd: "deferred" },
    ] as const;

    for (const { notion, prd } of cases) {
      const notionPage = {
        id: "p1",
        properties: {
          Name: { title: [{ plain_text: "Task" }] },
          Status: { status: { name: notion } },
          Level: { select: { name: "task" } },
          "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        },
      };
      const item = mapNotionToItem(notionPage);
      expect(item.status).toBe(prd);
    }
  });

  it("defaults to pending for unknown Notion status", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Unknown Status" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.status).toBe("pending");
  });

  it("omits priority and tags when not present in Notion", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.priority).toBeUndefined();
    expect(item.tags).toBeUndefined();
  });

  it("extracts description from Description property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        Description: { rich_text: [{ plain_text: "Task description" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.description).toBe("Task description");
  });

  it("extracts description from body blocks when no Description property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
      children: [
        {
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "From body blocks" }] },
        },
      ],
    };
    const item = mapNotionToItem(notionPage);
    expect(item.description).toBe("From body blocks");
  });

  it("prefers Description property over body blocks", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        Description: { rich_text: [{ plain_text: "From property" }] },
      },
      children: [
        {
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "From body" }] },
        },
      ],
    };
    const item = mapNotionToItem(notionPage);
    expect(item.description).toBe("From property");
  });

  it("extracts description from multiple paragraphs before heading", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
      children: [
        {
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "Line one" }] },
        },
        {
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "Line two" }] },
        },
        {
          type: "heading_2",
          heading_2: { rich_text: [{ plain_text: "Some Section" }] },
        },
        {
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "After heading" }] },
        },
      ],
    };
    const item = mapNotionToItem(notionPage);
    expect(item.description).toBe("Line one\n\nLine two");
  });

  it("extracts acceptance criteria from body blocks", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
      children: [
        {
          type: "heading_2",
          heading_2: { rich_text: [{ plain_text: "Acceptance Criteria" }] },
        },
        {
          type: "to_do",
          to_do: { rich_text: [{ plain_text: "Tests pass" }], checked: false },
        },
        {
          type: "to_do",
          to_do: { rich_text: [{ plain_text: "Code reviewed" }], checked: true },
        },
      ],
    };
    const item = mapNotionToItem(notionPage);
    expect(item.acceptanceCriteria).toEqual(["Tests pass", "Code reviewed"]);
  });

  it("ignores to_do blocks outside of Acceptance Criteria section", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
      children: [
        {
          type: "heading_2",
          heading_2: { rich_text: [{ plain_text: "Notes" }] },
        },
        {
          type: "to_do",
          to_do: { rich_text: [{ plain_text: "Not criteria" }], checked: false },
        },
        {
          type: "heading_2",
          heading_2: { rich_text: [{ plain_text: "Acceptance Criteria" }] },
        },
        {
          type: "to_do",
          to_do: { rich_text: [{ plain_text: "Real criteria" }], checked: false },
        },
      ],
    };
    const item = mapNotionToItem(notionPage);
    expect(item.acceptanceCriteria).toEqual(["Real criteria"]);
  });

  it("omits acceptanceCriteria when no body blocks", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.acceptanceCriteria).toBeUndefined();
  });

  it("extracts source from Source property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        Source: { rich_text: [{ plain_text: "rex-analyze" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.source).toBe("rex-analyze");
  });

  it("omits source when not present in Notion", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.source).toBeUndefined();
  });

  it("extracts blockedBy from Blocked By property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        "Blocked By": { rich_text: [{ plain_text: "t2, t3" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.blockedBy).toEqual(["t2", "t3"]);
  });

  it("handles single blockedBy value", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        "Blocked By": { rich_text: [{ plain_text: "t2" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.blockedBy).toEqual(["t2"]);
  });

  it("omits blockedBy when not present in Notion", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.blockedBy).toBeUndefined();
  });

  it("handles text.content format for Description property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ text: { content: "Task" } }] },
        Status: { status: { name: "Not started" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ text: { content: "t1" } }] },
        Description: { rich_text: [{ text: { content: "Desc via text.content" } }] },
        Source: { rich_text: [{ text: { content: "manual" } }] },
        "Blocked By": { rich_text: [{ text: { content: "t9" } }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.description).toBe("Desc via text.content");
    expect(item.source).toBe("manual");
    expect(item.blockedBy).toEqual(["t9"]);
  });

  it("round-trips all fields through mapItemToNotion and mapNotionToItem", () => {
    const original = makeItem({
      id: "t1",
      title: "Full Round Trip",
      status: "in_progress",
      level: "task",
      description: "Round trip description",
      priority: "high",
      tags: ["api", "core"],
      source: "analyze",
      blockedBy: ["t0", "t2"],
      acceptanceCriteria: ["AC1", "AC2"],
    });

    const { properties, children } = mapItemToNotion(original);

    // Build a Notion page object from the mapped properties
    const notionPage = {
      id: "notion-abc",
      properties: {
        Name: { title: properties.Name.title.map((rt) => ({ plain_text: rt.text.content })) },
        Status: properties.Status,
        Level: properties.Level,
        "PRD ID": { rich_text: properties["PRD ID"].rich_text.map((rt) => ({ plain_text: rt.text.content })) },
        Description: properties.Description
          ? { rich_text: properties.Description.rich_text.map((rt) => ({ plain_text: rt.text.content })) }
          : undefined,
        Priority: properties.Priority,
        Tags: properties.Tags,
        Source: properties.Source
          ? { rich_text: properties.Source.rich_text.map((rt) => ({ plain_text: rt.text.content })) }
          : undefined,
        "Blocked By": properties["Blocked By"]
          ? { rich_text: properties["Blocked By"].rich_text.map((rt) => ({ plain_text: rt.text.content })) }
          : undefined,
      },
      children: children?.map((block) => {
        const b = block as any;
        if (b.type === "paragraph") {
          return {
            type: "paragraph",
            paragraph: { rich_text: b.paragraph.rich_text.map((rt: any) => ({ plain_text: rt.text.content })) },
          };
        }
        if (b.type === "heading_2") {
          return {
            type: "heading_2",
            heading_2: { rich_text: b.heading_2.rich_text.map((rt: any) => ({ plain_text: rt.text.content })) },
          };
        }
        if (b.type === "to_do") {
          return {
            type: "to_do",
            to_do: {
              rich_text: b.to_do.rich_text.map((rt: any) => ({ plain_text: rt.text.content })),
              checked: b.to_do.checked,
            },
          };
        }
        return b;
      }),
    };

    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.title).toBe(original.title);
    expect(roundTripped.status).toBe(original.status);
    expect(roundTripped.level).toBe(original.level);
    expect(roundTripped.description).toBe(original.description);
    expect(roundTripped.priority).toBe(original.priority);
    expect(roundTripped.tags).toEqual(original.tags);
    expect(roundTripped.source).toBe(original.source);
    expect(roundTripped.blockedBy).toEqual(original.blockedBy);
    expect(roundTripped.acceptanceCriteria).toEqual(original.acceptanceCriteria);
  });
});

describe("resolveParentPage", () => {
  it("returns database ID for epics (top-level)", () => {
    const item = makeItem({ id: "e1", title: "Epic", level: "epic" });
    const result = resolveParentPage(item, "db-123", new Map());
    expect(result).toEqual({ database_id: "db-123" });
  });

  it("returns parent page ID for features under epics", () => {
    const item = makeItem({ id: "f1", title: "Feature", level: "feature" });
    const idMap = new Map([["e1", "notion-epic-page"]]);
    const result = resolveParentPage(item, "db-123", idMap, "e1");
    expect(result).toEqual({ page_id: "notion-epic-page" });
  });

  it("returns parent page ID for tasks under features", () => {
    const item = makeItem({ id: "t1", title: "Task", level: "task" });
    const idMap = new Map([["f1", "notion-feature-page"]]);
    const result = resolveParentPage(item, "db-123", idMap, "f1");
    expect(result).toEqual({ page_id: "notion-feature-page" });
  });

  it("returns parent page ID for subtasks under tasks", () => {
    const item = makeItem({ id: "s1", title: "Subtask", level: "subtask" });
    const idMap = new Map([["t1", "notion-task-page"]]);
    const result = resolveParentPage(item, "db-123", idMap, "t1");
    expect(result).toEqual({ page_id: "notion-task-page" });
  });

  it("falls back to database when parent not found in idMap", () => {
    const item = makeItem({ id: "f1", title: "Feature", level: "feature" });
    const result = resolveParentPage(item, "db-123", new Map(), "e1");
    expect(result).toEqual({ database_id: "db-123" });
  });

  it("falls back to database when no parentId provided for non-epic", () => {
    const item = makeItem({ id: "f1", title: "Feature", level: "feature" });
    const result = resolveParentPage(item, "db-123", new Map());
    expect(result).toEqual({ database_id: "db-123" });
  });
});

describe("mapDocumentToNotion", () => {
  it("flattens a PRD tree into Notion page descriptors with parent refs", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Test PRD",
      items: [
        makeItem({
          id: "e1",
          title: "Epic One",
          level: "epic",
          children: [
            makeItem({
              id: "f1",
              title: "Feature One",
              level: "feature",
              children: [
                makeItem({ id: "t1", title: "Task One", level: "task" }),
              ],
            }),
          ],
        }),
      ],
    };

    const pages = mapDocumentToNotion(doc, "db-123");

    expect(pages).toHaveLength(3);

    // Epic — top-level
    expect(pages[0].item.id).toBe("e1");
    expect(pages[0].parent).toEqual({ database_id: "db-123" });
    expect(pages[0].parentItemId).toBeUndefined();

    // Feature — under epic
    expect(pages[1].item.id).toBe("f1");
    expect(pages[1].parentItemId).toBe("e1");

    // Task — under feature
    expect(pages[2].item.id).toBe("t1");
    expect(pages[2].parentItemId).toBe("f1");
  });

  it("handles multiple epics at root", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Multi-epic PRD",
      items: [
        makeItem({ id: "e1", title: "Epic A", level: "epic" }),
        makeItem({ id: "e2", title: "Epic B", level: "epic" }),
      ],
    };

    const pages = mapDocumentToNotion(doc, "db-123");
    expect(pages).toHaveLength(2);
    expect(pages[0].parent).toEqual({ database_id: "db-123" });
    expect(pages[1].parent).toEqual({ database_id: "db-123" });
  });

  it("preserves full depth: epic > feature > task > subtask", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Deep PRD",
      items: [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({
              id: "f1",
              title: "Feature",
              level: "feature",
              children: [
                makeItem({
                  id: "t1",
                  title: "Task",
                  level: "task",
                  children: [
                    makeItem({
                      id: "s1",
                      title: "Subtask",
                      level: "subtask",
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    };

    const pages = mapDocumentToNotion(doc, "db-123");
    expect(pages).toHaveLength(4);
    expect(pages.map((p) => p.item.level)).toEqual([
      "epic",
      "feature",
      "task",
      "subtask",
    ]);
    expect(pages[0].parentItemId).toBeUndefined();
    expect(pages[1].parentItemId).toBe("e1");
    expect(pages[2].parentItemId).toBe("f1");
    expect(pages[3].parentItemId).toBe("t1");
  });

  it("returns empty array for empty document", () => {
    const doc: PRDDocument = {
      schema: "rex/v1",
      title: "Empty",
      items: [],
    };
    const pages = mapDocumentToNotion(doc, "db-123");
    expect(pages).toEqual([]);
  });
});

describe("mapNotionToDocument", () => {
  it("reconstructs PRD tree from flat Notion pages", () => {
    const notionPages = [
      {
        id: "notion-e1",
        properties: {
          Name: { title: [{ plain_text: "Epic One" }] },
          Status: { status: { name: "In progress" } },
          Level: { select: { name: "epic" } },
          "PRD ID": { rich_text: [{ plain_text: "e1" }] },
        },
        parent: { database_id: "db-123" },
      },
      {
        id: "notion-f1",
        properties: {
          Name: { title: [{ plain_text: "Feature One" }] },
          Status: { status: { name: "Not started" } },
          Level: { select: { name: "feature" } },
          "PRD ID": { rich_text: [{ plain_text: "f1" }] },
        },
        parent: { page_id: "notion-e1" },
      },
      {
        id: "notion-t1",
        properties: {
          Name: { title: [{ plain_text: "Task One" }] },
          Status: { status: { name: "Done" } },
          Level: { select: { name: "task" } },
          "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        },
        parent: { page_id: "notion-f1" },
      },
    ];

    const doc = mapNotionToDocument(notionPages, "Test Project");

    expect(doc.title).toBe("Test Project");
    expect(doc.schema).toBe("rex/v1");
    expect(doc.items).toHaveLength(1); // 1 root epic

    const epic = doc.items[0];
    expect(epic.id).toBe("e1");
    expect(epic.level).toBe("epic");
    expect(epic.children).toHaveLength(1);

    const feature = epic.children![0];
    expect(feature.id).toBe("f1");
    expect(feature.level).toBe("feature");
    expect(feature.children).toHaveLength(1);

    const task = feature.children![0];
    expect(task.id).toBe("t1");
    expect(task.level).toBe("task");
    expect(task.status).toBe("completed");
  });

  it("places orphaned items at root level", () => {
    const notionPages = [
      {
        id: "notion-t1",
        properties: {
          Name: { title: [{ plain_text: "Orphan Task" }] },
          Status: { status: { name: "Not started" } },
          Level: { select: { name: "task" } },
          "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        },
        parent: { page_id: "notion-missing-parent" },
      },
    ];

    const doc = mapNotionToDocument(notionPages, "Test");
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].id).toBe("t1");
  });

  it("handles multiple root items", () => {
    const notionPages = [
      {
        id: "notion-e1",
        properties: {
          Name: { title: [{ plain_text: "Epic A" }] },
          Status: { status: { name: "Not started" } },
          Level: { select: { name: "epic" } },
          "PRD ID": { rich_text: [{ plain_text: "e1" }] },
        },
        parent: { database_id: "db-123" },
      },
      {
        id: "notion-e2",
        properties: {
          Name: { title: [{ plain_text: "Epic B" }] },
          Status: { status: { name: "Done" } },
          Level: { select: { name: "epic" } },
          "PRD ID": { rich_text: [{ plain_text: "e2" }] },
        },
        parent: { database_id: "db-123" },
      },
    ];

    const doc = mapNotionToDocument(notionPages, "Test");
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0].id).toBe("e1");
    expect(doc.items[1].id).toBe("e2");
  });
});
