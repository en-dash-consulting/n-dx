import { describe, it, expect } from "vitest";
import {
  mapItemToNotion,
  mapNotionToItem,
  mapDocumentToNotion,
  mapNotionToDocument,
  resolveParentPage,
  resolveStatusFromNotion,
  validateDatabaseSchema,
  buildStatusGroupMap,
  NOTION_LEVEL_CONFIG,
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  DATABASE_SCHEMA,
} from "../../../src/store/notion-map.js";
import type { PRDItem, PRDDocument } from "../../../src/schema/index.js";
import type { NotionStatusGroup } from "../../../src/store/notion-map.js";

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
      expect(config.statusMap.blocked).toBeDefined();
    }
  });

  it("maps all status values correctly", () => {
    for (const level of ["epic", "feature", "task", "subtask"] as const) {
      const config = NOTION_LEVEL_CONFIG[level];
      expect(config.statusMap.pending).toBe("Not started");
      expect(config.statusMap.in_progress).toBe("In progress");
      expect(config.statusMap.completed).toBe("Done");
      expect(config.statusMap.deferred).toBe("Deferred");
      expect(config.statusMap.blocked).toBe("Blocked");
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
      { prd: "blocked", notion: "Blocked" },
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
      startedAt: "2024-06-01T00:00:00Z",
      completedAt: "2024-06-02T12:00:00Z",
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
    expect(result.properties["Started At"]!.rich_text[0].text.content).toBe("2024-06-01T00:00:00Z");
    expect(result.properties["Completed At"]!.rich_text[0].text.content).toBe("2024-06-02T12:00:00Z");

    // Body blocks: description paragraph + heading + 2 to_do
    expect(result.children).toHaveLength(4);
  });

  it("omits startedAt and completedAt when not set", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const result = mapItemToNotion(item);
    expect(result.properties["Started At"]).toBeUndefined();
    expect(result.properties["Completed At"]).toBeUndefined();
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

  it("extracts startedAt from Started At property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "In progress" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        "Started At": { rich_text: [{ plain_text: "2024-06-01T00:00:00Z" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.startedAt).toBe("2024-06-01T00:00:00Z");
  });

  it("extracts completedAt from Completed At property", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "Done" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        "Completed At": { rich_text: [{ plain_text: "2024-06-02T12:00:00Z" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.completedAt).toBe("2024-06-02T12:00:00Z");
  });

  it("omits startedAt and completedAt when not present", () => {
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
    expect(item.startedAt).toBeUndefined();
    expect(item.completedAt).toBeUndefined();
  });

  it("handles text.content format for Started At and Completed At", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ text: { content: "Task" } }] },
        Status: { status: { name: "Done" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ text: { content: "t1" } }] },
        "Started At": { rich_text: [{ text: { content: "2024-06-01T00:00:00Z" } }] },
        "Completed At": { rich_text: [{ text: { content: "2024-06-02T12:00:00Z" } }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.startedAt).toBe("2024-06-01T00:00:00Z");
    expect(item.completedAt).toBe("2024-06-02T12:00:00Z");
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
      startedAt: "2024-06-01T00:00:00Z",
      completedAt: "2024-06-02T12:00:00Z",
    });

    const { properties, children } = mapItemToNotion(original);

    // Helper to convert rich_text to plain_text format (as Notion API returns)
    const toPlainText = (richText: Array<{ text: { content: string } }>) =>
      richText.map((rt) => ({ plain_text: rt.text.content }));

    // Build a Notion page object from the mapped properties
    const notionPage = {
      id: "notion-abc",
      properties: {
        Name: { title: toPlainText(properties.Name.title) },
        Status: properties.Status,
        Level: properties.Level,
        "PRD ID": { rich_text: toPlainText(properties["PRD ID"].rich_text) },
        Description: properties.Description
          ? { rich_text: toPlainText(properties.Description.rich_text) }
          : undefined,
        Priority: properties.Priority,
        Tags: properties.Tags,
        Source: properties.Source
          ? { rich_text: toPlainText(properties.Source.rich_text) }
          : undefined,
        "Blocked By": properties["Blocked By"]
          ? { rich_text: toPlainText(properties["Blocked By"].rich_text) }
          : undefined,
        "Started At": properties["Started At"]
          ? { rich_text: toPlainText(properties["Started At"].rich_text) }
          : undefined,
        "Completed At": properties["Completed At"]
          ? { rich_text: toPlainText(properties["Completed At"].rich_text) }
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
    expect(roundTripped.startedAt).toBe(original.startedAt);
    expect(roundTripped.completedAt).toBe(original.completedAt);
  });

  it("round-trips all status values", () => {
    const statuses = ["pending", "in_progress", "completed", "deferred", "blocked"] as const;

    for (const status of statuses) {
      const original = makeItem({ id: "t1", title: "Status Test", status });
      const { properties, children } = mapItemToNotion(original);

      const notionPage = buildMockNotionPage("notion-abc", properties, children);
      const roundTripped = mapNotionToItem(notionPage);

      expect(roundTripped.status).toBe(status);
    }
  });

  it("round-trips all level values", () => {
    const levels = ["epic", "feature", "task", "subtask"] as const;

    for (const level of levels) {
      const original = makeItem({ id: "item1", title: "Level Test", level });
      const { properties, children } = mapItemToNotion(original);

      const notionPage = buildMockNotionPage("notion-abc", properties, children);
      const roundTripped = mapNotionToItem(notionPage);

      expect(roundTripped.level).toBe(level);
    }
  });

  it("round-trips all priority values", () => {
    const priorities = ["critical", "high", "medium", "low"] as const;

    for (const priority of priorities) {
      const original = makeItem({ id: "t1", title: "Priority Test", priority });
      const { properties, children } = mapItemToNotion(original);

      const notionPage = buildMockNotionPage("notion-abc", properties, children);
      const roundTripped = mapNotionToItem(notionPage);

      expect(roundTripped.priority).toBe(priority);
    }
  });

  it("round-trips items with no optional fields", () => {
    const original = makeItem({ id: "t1", title: "Minimal Item" });
    const { properties, children } = mapItemToNotion(original);

    const notionPage = buildMockNotionPage("notion-abc", properties, children);
    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.title).toBe(original.title);
    expect(roundTripped.status).toBe(original.status);
    expect(roundTripped.level).toBe(original.level);
    expect(roundTripped.description).toBeUndefined();
    expect(roundTripped.priority).toBeUndefined();
    expect(roundTripped.tags).toBeUndefined();
    expect(roundTripped.source).toBeUndefined();
    expect(roundTripped.blockedBy).toBeUndefined();
    expect(roundTripped.acceptanceCriteria).toBeUndefined();
    expect(roundTripped.startedAt).toBeUndefined();
    expect(roundTripped.completedAt).toBeUndefined();
  });

  it("round-trips empty tags array (omits it)", () => {
    const original = makeItem({ id: "t1", title: "Empty Tags", tags: [] });
    const { properties, children } = mapItemToNotion(original);

    // Empty tags should be omitted
    expect(properties.Tags).toBeUndefined();

    const notionPage = buildMockNotionPage("notion-abc", properties, children);
    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.tags).toBeUndefined();
  });

  it("round-trips empty blockedBy array (omits it)", () => {
    const original = makeItem({ id: "t1", title: "No Blockers", blockedBy: [] });
    const { properties, children } = mapItemToNotion(original);

    // Empty blockedBy should be omitted
    expect(properties["Blocked By"]).toBeUndefined();

    const notionPage = buildMockNotionPage("notion-abc", properties, children);
    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.blockedBy).toBeUndefined();
  });

  it("round-trips empty acceptanceCriteria array (omits it)", () => {
    const original = makeItem({ id: "t1", title: "No Criteria", acceptanceCriteria: [] });
    const { properties, children } = mapItemToNotion(original);

    // Empty acceptanceCriteria should produce no children blocks (undefined)
    expect(children).toBeUndefined();

    const notionPage = buildMockNotionPage("notion-abc", properties, children);
    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.acceptanceCriteria).toBeUndefined();
  });

  it("round-trips single-element arrays", () => {
    const original = makeItem({
      id: "t1",
      title: "Single Elements",
      tags: ["solo-tag"],
      blockedBy: ["single-blocker"],
      acceptanceCriteria: ["one criterion"],
    });
    const { properties, children } = mapItemToNotion(original);

    const notionPage = buildMockNotionPage("notion-abc", properties, children);
    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.tags).toEqual(["solo-tag"]);
    expect(roundTripped.blockedBy).toEqual(["single-blocker"]);
    expect(roundTripped.acceptanceCriteria).toEqual(["one criterion"]);
  });

  it("round-trips description with description property and body block", () => {
    const original = makeItem({
      id: "t1",
      title: "With Description",
      description: "A detailed description",
    });
    const { properties, children } = mapItemToNotion(original);

    // Description should be in both property and body
    expect(properties.Description).toBeDefined();
    expect(children).toHaveLength(1);

    const notionPage = buildMockNotionPage("notion-abc", properties, children);
    const roundTripped = mapNotionToItem(notionPage);

    expect(roundTripped.description).toBe("A detailed description");
  });
});

/**
 * Helper to build a mock Notion page object from mapped properties and children.
 * Converts our output format to Notion's API response format.
 */
function buildMockNotionPage(
  notionId: string,
  properties: ReturnType<typeof mapItemToNotion>["properties"],
  children?: ReturnType<typeof mapItemToNotion>["children"],
) {
  return {
    id: notionId,
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
      "Started At": properties["Started At"]
        ? { rich_text: properties["Started At"].rich_text.map((rt) => ({ plain_text: rt.text.content })) }
        : undefined,
      "Completed At": properties["Completed At"]
        ? { rich_text: properties["Completed At"].rich_text.map((rt) => ({ plain_text: rt.text.content })) }
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
}

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

// ---------------------------------------------------------------------------
// Native Notion property types
// ---------------------------------------------------------------------------

describe("STATUS_OPTIONS", () => {
  it("defines options for all five PRD statuses", () => {
    expect(STATUS_OPTIONS.pending).toBeDefined();
    expect(STATUS_OPTIONS.in_progress).toBeDefined();
    expect(STATUS_OPTIONS.completed).toBeDefined();
    expect(STATUS_OPTIONS.deferred).toBeDefined();
    expect(STATUS_OPTIONS.blocked).toBeDefined();
  });

  it("assigns each status to a Notion status group", () => {
    expect(STATUS_OPTIONS.pending.group).toBe("To-do");
    expect(STATUS_OPTIONS.in_progress.group).toBe("In progress");
    expect(STATUS_OPTIONS.completed.group).toBe("Complete");
    expect(STATUS_OPTIONS.deferred.group).toBe("To-do");
    expect(STATUS_OPTIONS.blocked.group).toBe("In progress");
  });

  it("provides color for each option", () => {
    for (const opt of Object.values(STATUS_OPTIONS)) {
      expect(opt.color).toBeDefined();
      expect(typeof opt.color).toBe("string");
    }
  });

  it("maintains the canonical Notion status names", () => {
    expect(STATUS_OPTIONS.pending.name).toBe("Not started");
    expect(STATUS_OPTIONS.in_progress.name).toBe("In progress");
    expect(STATUS_OPTIONS.completed.name).toBe("Done");
    expect(STATUS_OPTIONS.deferred.name).toBe("Deferred");
    expect(STATUS_OPTIONS.blocked.name).toBe("Blocked");
  });
});

describe("PRIORITY_OPTIONS", () => {
  it("defines options for all four PRD priorities", () => {
    expect(PRIORITY_OPTIONS.critical).toBeDefined();
    expect(PRIORITY_OPTIONS.high).toBeDefined();
    expect(PRIORITY_OPTIONS.medium).toBeDefined();
    expect(PRIORITY_OPTIONS.low).toBeDefined();
  });

  it("uses title-cased names for Notion display", () => {
    expect(PRIORITY_OPTIONS.critical.name).toBe("Critical");
    expect(PRIORITY_OPTIONS.high.name).toBe("High");
    expect(PRIORITY_OPTIONS.medium.name).toBe("Medium");
    expect(PRIORITY_OPTIONS.low.name).toBe("Low");
  });

  it("provides color for each option", () => {
    for (const opt of Object.values(PRIORITY_OPTIONS)) {
      expect(opt.color).toBeDefined();
      expect(typeof opt.color).toBe("string");
    }
  });
});

describe("DATABASE_SCHEMA", () => {
  it("declares Status as native status type (not select)", () => {
    expect(DATABASE_SCHEMA.Status.type).toBe("status");
  });

  it("declares Priority as select type", () => {
    expect(DATABASE_SCHEMA.Priority.type).toBe("select");
  });

  it("declares Name as title type", () => {
    expect(DATABASE_SCHEMA.Name.type).toBe("title");
  });

  it("includes status groups with correct assignments", () => {
    const groups = DATABASE_SCHEMA.Status.groups!;
    expect(groups).toHaveLength(3);

    const todoGroup = groups.find((g) => g.name === "To-do");
    const inProgressGroup = groups.find((g) => g.name === "In progress");
    const completeGroup = groups.find((g) => g.name === "Complete");

    expect(todoGroup).toBeDefined();
    expect(inProgressGroup).toBeDefined();
    expect(completeGroup).toBeDefined();

    expect(todoGroup!.option_names).toContain("Not started");
    expect(todoGroup!.option_names).toContain("Deferred");
    expect(inProgressGroup!.option_names).toContain("In progress");
    expect(inProgressGroup!.option_names).toContain("Failing");
    expect(inProgressGroup!.option_names).toContain("Blocked");
    expect(completeGroup!.option_names).toContain("Done");
  });

  it("includes all status options", () => {
    const options = DATABASE_SCHEMA.Status.options!;
    expect(options).toHaveLength(7);
    const names = options.map((o) => o.name);
    expect(names).toContain("Not started");
    expect(names).toContain("In progress");
    expect(names).toContain("Done");
    expect(names).toContain("Failing");
    expect(names).toContain("Deferred");
    expect(names).toContain("Blocked");
    expect(names).toContain("Deleted");
  });

  it("includes all priority options", () => {
    const options = DATABASE_SCHEMA.Priority.options!;
    expect(options).toHaveLength(4);
    const names = options.map((o) => o.name);
    expect(names).toContain("Critical");
    expect(names).toContain("High");
    expect(names).toContain("Medium");
    expect(names).toContain("Low");
  });
});

describe("resolveStatusFromNotion", () => {
  it("resolves known status names by exact match", () => {
    expect(resolveStatusFromNotion("Not started")).toBe("pending");
    expect(resolveStatusFromNotion("In progress")).toBe("in_progress");
    expect(resolveStatusFromNotion("Done")).toBe("completed");
    expect(resolveStatusFromNotion("Deferred")).toBe("deferred");
    expect(resolveStatusFromNotion("Blocked")).toBe("blocked");
  });

  it("resolves unknown status name via group fallback", () => {
    // "Blocked" is now a known exact-match status, so use a different example
    expect(resolveStatusFromNotion("On Hold", "In progress")).toBe("in_progress");
    expect(resolveStatusFromNotion("Backlog", "To-do")).toBe("pending");
    expect(resolveStatusFromNotion("Archived", "Complete")).toBe("completed");
  });

  it("falls back to pending for completely unknown status without group", () => {
    expect(resolveStatusFromNotion("Something Random")).toBe("pending");
  });

  it("falls back to pending for unknown status with unknown group", () => {
    expect(resolveStatusFromNotion("Unknown", "Unknown Group" as NotionStatusGroup)).toBe("pending");
  });
});

describe("mapNotionToItem with statusGroupMap", () => {
  it("resolves custom status options via group map", () => {
    const statusGroupMap = new Map<string, NotionStatusGroup>([
      ["Blocked", "In progress"],
      ["Backlog", "To-do"],
      ["Won't do", "Complete"],
    ]);

    const blocked = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Blocked Task" }] },
        Status: { status: { name: "Blocked" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    expect(mapNotionToItem(blocked, statusGroupMap).status).toBe("blocked");

    const backlog = {
      id: "p2",
      properties: {
        Name: { title: [{ plain_text: "Backlog Task" }] },
        Status: { status: { name: "Backlog" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t2" }] },
      },
    };
    expect(mapNotionToItem(backlog, statusGroupMap).status).toBe("pending");

    const wontDo = {
      id: "p3",
      properties: {
        Name: { title: [{ plain_text: "Won't Do Task" }] },
        Status: { status: { name: "Won't do" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t3" }] },
      },
    };
    expect(mapNotionToItem(wontDo, statusGroupMap).status).toBe("completed");
  });

  it("still works without statusGroupMap (backward compatible)", () => {
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task" }] },
        Status: { status: { name: "In progress" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };
    const item = mapNotionToItem(notionPage);
    expect(item.status).toBe("in_progress");
  });
});

describe("validateDatabaseSchema", () => {
  it("validates a correct database schema", () => {
    const dbProps = {
      Name: { type: "title" },
      Status: { type: "status" },
      Level: { type: "select" },
      "PRD ID": { type: "rich_text" },
      Description: { type: "rich_text" },
      Priority: { type: "select" },
      Tags: { type: "multi_select" },
      Source: { type: "rich_text" },
      "Blocked By": { type: "rich_text" },
    };
    const result = validateDatabaseSchema(dbProps);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing required properties", () => {
    const result = validateDatabaseSchema({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required property: "Name"');
    expect(result.errors).toContain('Missing required property: "Status"');
    expect(result.errors).toContain('Missing required property: "Level"');
    expect(result.errors).toContain('Missing required property: "PRD ID"');
  });

  it("reports wrong property type for Status", () => {
    const dbProps = {
      Name: { type: "title" },
      Status: { type: "select" }, // should be "status"
      Level: { type: "select" },
      "PRD ID": { type: "rich_text" },
    };
    const result = validateDatabaseSchema(dbProps);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Property "Status" has type "select", expected "status"',
    );
  });

  it("allows missing optional properties", () => {
    const dbProps = {
      Name: { type: "title" },
      Status: { type: "status" },
      Level: { type: "select" },
      "PRD ID": { type: "rich_text" },
      // No Description, Priority, Tags, Source, Blocked By — all optional
    };
    const result = validateDatabaseSchema(dbProps);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("buildStatusGroupMap", () => {
  it("builds a map from database Status property groups", () => {
    const dbProps = {
      Status: {
        type: "status",
        status: {
          options: [
            { id: "opt-1", name: "Not started", color: "default" },
            { id: "opt-2", name: "In progress", color: "blue" },
            { id: "opt-3", name: "Done", color: "green" },
            { id: "opt-4", name: "Blocked", color: "red" },
          ],
          groups: [
            { name: "To-do", color: "gray", option_ids: ["opt-1"] },
            { name: "In progress", color: "blue", option_ids: ["opt-2", "opt-4"] },
            { name: "Complete", color: "green", option_ids: ["opt-3"] },
          ],
        },
      },
    };

    const map = buildStatusGroupMap(dbProps);
    expect(map.get("Not started")).toBe("To-do");
    expect(map.get("In progress")).toBe("In progress");
    expect(map.get("Done")).toBe("Complete");
    expect(map.get("Blocked")).toBe("In progress");
  });

  it("returns empty map for non-status property type", () => {
    const dbProps = {
      Status: { type: "select", select: { options: [] } },
    };
    const map = buildStatusGroupMap(dbProps);
    expect(map.size).toBe(0);
  });

  it("returns empty map when Status property is missing", () => {
    const map = buildStatusGroupMap({});
    expect(map.size).toBe(0);
  });

  it("integrates with mapNotionToItem for custom status options", () => {
    const dbProps = {
      Status: {
        type: "status",
        status: {
          options: [
            { id: "opt-1", name: "Not started", color: "default" },
            { id: "opt-2", name: "In review", color: "purple" },
            { id: "opt-3", name: "Done", color: "green" },
          ],
          groups: [
            { name: "To-do", color: "gray", option_ids: ["opt-1"] },
            { name: "In progress", color: "blue", option_ids: ["opt-2"] },
            { name: "Complete", color: "green", option_ids: ["opt-3"] },
          ],
        },
      },
    };

    const groupMap = buildStatusGroupMap(dbProps);
    const notionPage = {
      id: "p1",
      properties: {
        Name: { title: [{ plain_text: "Task in review" }] },
        Status: { status: { name: "In review" } },
        Level: { select: { name: "task" } },
        "PRD ID": { rich_text: [{ plain_text: "t1" }] },
      },
    };

    const item = mapNotionToItem(notionPage, groupMap);
    expect(item.status).toBe("in_progress");
  });
});

describe("mapNotionToDocument with statusGroupMap", () => {
  it("forwards statusGroupMap when reconstructing document tree", () => {
    const statusGroupMap = new Map<string, NotionStatusGroup>([
      ["In review", "In progress"],
    ]);

    const notionPages = [
      {
        id: "notion-t1",
        properties: {
          Name: { title: [{ plain_text: "Task" }] },
          Status: { status: { name: "In review" } },
          Level: { select: { name: "task" } },
          "PRD ID": { rich_text: [{ plain_text: "t1" }] },
        },
        parent: { database_id: "db-123" },
      },
    ];

    const doc = mapNotionToDocument(notionPages, "Test", statusGroupMap);
    expect(doc.items[0].status).toBe("in_progress");
  });
});
