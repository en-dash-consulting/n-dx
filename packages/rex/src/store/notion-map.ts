/**
 * Maps PRD hierarchy to Notion database structure.
 *
 * Notion model:
 * - Epics are top-level pages in the database
 * - Features, tasks, and subtasks are sub-pages nested under their parents
 * - Status uses Notion's **native status property type** (not a select)
 *   with three built-in groups: To-do, In progress, Complete
 * - Priority uses a **select** property (Notion has no native priority type)
 * - Other fields use title, rich_text, multi_select as appropriate
 *
 * This module handles bidirectional conversion between PRDItem trees
 * and Notion's flat page + parent reference model.
 */

import type {
  ItemLevel,
  ItemStatus,
  PRDItem,
  PRDDocument,
  Priority,
} from "../schema/index.js";
import { SCHEMA_VERSION, isRootLevel } from "../schema/index.js";
import { walkTree } from "../core/tree.js";

// ---------------------------------------------------------------------------
// Notion property shapes (minimal types for the API subset we use)
// ---------------------------------------------------------------------------

export interface NotionRichText {
  text: { content: string };
}

export interface NotionPageProperties {
  Name: { title: NotionRichText[] };
  /** Notion native status property (not a select). */
  Status: { status: { name: string } };
  Level: { select: { name: string } };
  "PRD ID": { rich_text: NotionRichText[] };
  Description?: { rich_text: NotionRichText[] };
  /** Select property — Notion has no native priority type. */
  Priority?: { select: { name: string } };
  Tags?: { multi_select: Array<{ name: string }> };
  Source?: { rich_text: NotionRichText[] };
  "Blocked By"?: { rich_text: NotionRichText[] };
  /** ISO 8601 timestamp of when work started. Stored as rich_text. */
  "Started At"?: { rich_text: NotionRichText[] };
  /** ISO 8601 timestamp of when item was completed. Stored as rich_text. */
  "Completed At"?: { rich_text: NotionRichText[] };
}

// ---------------------------------------------------------------------------
// Notion native status groups — the three immutable groups every status
// property has. Custom status options belong to exactly one group.
// ---------------------------------------------------------------------------

/**
 * Notion's three built-in status groups. Every Status property has exactly
 * these three groups; options are assigned to one of them.
 */
export type NotionStatusGroup = "To-do" | "In progress" | "Complete";

export interface NotionStatusOption {
  name: string;
  color: string;
  group: NotionStatusGroup;
}

/**
 * Map from each PRD ItemStatus to its Notion status option name and group.
 * The group assignment tells Notion which column/category the status belongs to,
 * which is the key differentiator of the native status type vs a plain select.
 */
export const STATUS_OPTIONS: Record<ItemStatus, NotionStatusOption> = {
  pending:     { name: "Not started",  color: "default", group: "To-do" },
  in_progress: { name: "In progress",  color: "blue",    group: "In progress" },
  completed:   { name: "Done",         color: "green",   group: "Complete" },
  failing:     { name: "Failing",      color: "red",     group: "In progress" },
  deferred:    { name: "Deferred",     color: "yellow",  group: "To-do" },
  blocked:     { name: "Blocked",      color: "red",     group: "In progress" },
  deleted:     { name: "Deleted",     color: "default", group: "Complete" },
};

/**
 * Priority options for the select property. Title-cased for Notion display.
 */
export interface NotionSelectOption {
  name: string;
  color: string;
}

export const PRIORITY_OPTIONS: Record<Priority, NotionSelectOption> = {
  critical: { name: "Critical", color: "red" },
  high:     { name: "High",     color: "orange" },
  medium:   { name: "Medium",   color: "yellow" },
  low:      { name: "Low",      color: "gray" },
};

// ---------------------------------------------------------------------------
// Database schema definition — describes the expected Notion database
// configuration. Status properties cannot be created via the API and must
// be configured in the Notion UI; this schema serves as documentation and
// validation reference.
// ---------------------------------------------------------------------------

export interface NotionPropertySchema {
  type: "title" | "status" | "select" | "multi_select" | "rich_text";
  /** For status/select types: the expected options. */
  options?: Array<{ name: string; color: string }>;
  /** For status type: which group each option belongs to. */
  groups?: Array<{
    name: NotionStatusGroup;
    color: string;
    option_names: string[];
  }>;
}

/**
 * Expected database property schema for a rex-managed Notion database.
 * Use this to validate that a database is correctly configured or to
 * document what manual setup is required (since the Status property type
 * cannot be created via the Notion API).
 */
export const DATABASE_SCHEMA: Record<string, NotionPropertySchema> = {
  Name: { type: "title" },
  Status: {
    type: "status",
    options: Object.values(STATUS_OPTIONS).map(({ name, color }) => ({ name, color })),
    groups: [
      {
        name: "To-do",
        color: "gray",
        option_names: [STATUS_OPTIONS.pending.name, STATUS_OPTIONS.deferred.name],
      },
      {
        name: "In progress",
        color: "blue",
        option_names: [STATUS_OPTIONS.in_progress.name, STATUS_OPTIONS.failing.name, STATUS_OPTIONS.blocked.name],
      },
      {
        name: "Complete",
        color: "green",
        option_names: [STATUS_OPTIONS.completed.name],
      },
    ],
  },
  Level: {
    type: "select",
    options: [
      { name: "epic", color: "purple" },
      { name: "feature", color: "blue" },
      { name: "task", color: "green" },
      { name: "subtask", color: "gray" },
    ],
  },
  "PRD ID": { type: "rich_text" },
  Description: { type: "rich_text" },
  Priority: {
    type: "select",
    options: Object.values(PRIORITY_OPTIONS).map(({ name, color }) => ({ name, color })),
  },
  Tags: { type: "multi_select" },
  Source: { type: "rich_text" },
  "Blocked By": { type: "rich_text" },
  "Started At": { type: "rich_text" },
  "Completed At": { type: "rich_text" },
};

export interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

export interface NotionParent {
  database_id?: string;
  page_id?: string;
}

export interface NotionPageDescriptor {
  item: PRDItem;
  parent: NotionParent;
  parentItemId?: string;
  properties: NotionPageProperties;
  children?: NotionBlock[];
}

// ---------------------------------------------------------------------------
// Level configuration — defines hierarchy + status mapping per level
// ---------------------------------------------------------------------------

export interface LevelConfig {
  parentLevel: ItemLevel | null;
  statusMap: Record<ItemStatus, string>;
}

/** Notion status names derived from the centralized STATUS_OPTIONS. */
const STATUS_TO_NOTION: Record<ItemStatus, string> = Object.fromEntries(
  Object.entries(STATUS_OPTIONS).map(([k, v]) => [k, v.name]),
) as Record<ItemStatus, string>;

/** Reverse lookup: Notion status name → PRD ItemStatus. */
const NOTION_TO_STATUS: Record<string, ItemStatus> = Object.fromEntries(
  Object.entries(STATUS_OPTIONS).map(([k, v]) => [v.name, k as ItemStatus]),
) as Record<string, ItemStatus>;

/** Priority mapping derived from PRIORITY_OPTIONS. */
const PRIORITY_TO_NOTION: Record<Priority, string> = Object.fromEntries(
  Object.entries(PRIORITY_OPTIONS).map(([k, v]) => [k, v.name]),
) as Record<Priority, string>;

/** Reverse lookup: Notion priority → PRD Priority. */
const NOTION_TO_PRIORITY: Record<string, Priority> = Object.fromEntries(
  Object.entries(PRIORITY_OPTIONS).map(([k, v]) => [v.name, k as Priority]),
) as Record<string, Priority>;

export const NOTION_LEVEL_CONFIG: Record<ItemLevel, LevelConfig> = {
  epic: { parentLevel: null, statusMap: { ...STATUS_TO_NOTION } },
  feature: { parentLevel: "epic", statusMap: { ...STATUS_TO_NOTION } },
  task: { parentLevel: "feature", statusMap: { ...STATUS_TO_NOTION } },
  subtask: { parentLevel: "task", statusMap: { ...STATUS_TO_NOTION } },
};

// ---------------------------------------------------------------------------
// PRDItem → Notion
// ---------------------------------------------------------------------------

/**
 * Convert a single PRDItem into Notion page properties + body blocks.
 * Does not set the `parent` field — use `resolveParentPage` for that.
 */
export function mapItemToNotion(
  item: PRDItem,
): { properties: NotionPageProperties; children?: NotionBlock[] } {
  const config = NOTION_LEVEL_CONFIG[item.level];

  const properties: NotionPageProperties = {
    Name: { title: [{ text: { content: item.title } }] },
    Status: { status: { name: config.statusMap[item.status] } },
    Level: { select: { name: item.level } },
    "PRD ID": { rich_text: [{ text: { content: item.id } }] },
  };

  if (item.description) {
    properties.Description = {
      rich_text: [{ text: { content: item.description } }],
    };
  }

  if (item.priority) {
    properties.Priority = {
      select: { name: PRIORITY_TO_NOTION[item.priority] },
    };
  }

  if (item.tags && item.tags.length > 0) {
    properties.Tags = {
      multi_select: item.tags.map((t) => ({ name: t })),
    };
  }

  if (item.source) {
    properties.Source = {
      rich_text: [{ text: { content: item.source } }],
    };
  }

  if (item.blockedBy && item.blockedBy.length > 0) {
    properties["Blocked By"] = {
      rich_text: [{ text: { content: item.blockedBy.join(", ") } }],
    };
  }

  if (item.startedAt) {
    properties["Started At"] = {
      rich_text: [{ text: { content: item.startedAt } }],
    };
  }

  if (item.completedAt) {
    properties["Completed At"] = {
      rich_text: [{ text: { content: item.completedAt } }],
    };
  }

  const children: NotionBlock[] = [];

  if (item.description) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ text: { content: item.description } }],
      },
    });
  }

  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    children.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ text: { content: "Acceptance Criteria" } }],
      },
    });
    for (const ac of item.acceptanceCriteria) {
      children.push({
        object: "block",
        type: "to_do",
        to_do: {
          rich_text: [{ text: { content: ac } }],
          checked: false,
        },
      });
    }
  }

  return {
    properties,
    ...(children.length > 0 ? { children } : {}),
  };
}

// ---------------------------------------------------------------------------
// Notion → PRDItem
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Convert a Notion page object into a PRDItem.
 * Expects the page to have the properties defined by `NotionPageProperties`.
 *
 * For the native Status property, reads `status.name` (and optionally the
 * status group from the database schema) to resolve to a PRD ItemStatus.
 * Custom status options (e.g. "Blocked") are resolved via their group
 * when `statusGroupMap` is provided.
 *
 * @param notionPage      Notion page object with properties and optional children.
 * @param statusGroupMap  Optional map of status option name → group name, from
 *                        the database schema. Enables group-based fallback for
 *                        custom status options.
 */
export function mapNotionToItem(
  notionPage: any,
  statusGroupMap?: Map<string, NotionStatusGroup>,
): PRDItem {
  const props = notionPage.properties;

  const title =
    props.Name?.title?.[0]?.plain_text ?? props.Name?.title?.[0]?.text?.content ?? "";
  const notionStatus = props.Status?.status?.name ?? "Not started";
  const level = (props.Level?.select?.name ?? "task") as ItemLevel;
  const prdId =
    props["PRD ID"]?.rich_text?.[0]?.plain_text ??
    props["PRD ID"]?.rich_text?.[0]?.text?.content ??
    "";

  const statusGroup = statusGroupMap?.get(notionStatus);

  const item: PRDItem = {
    id: prdId || notionPage.id,
    title,
    status: resolveStatusFromNotion(notionStatus, statusGroup),
    level,
    remoteId: notionPage.id,
  };

  // Description — from property (preferred) or body blocks
  const descriptionProp =
    props.Description?.rich_text?.[0]?.plain_text ??
    props.Description?.rich_text?.[0]?.text?.content;
  if (descriptionProp) {
    item.description = descriptionProp;
  } else if (notionPage.children) {
    const desc = extractDescriptionFromBlocks(notionPage.children);
    if (desc) {
      item.description = desc;
    }
  }

  // Acceptance criteria — from body blocks (to_do items after an "Acceptance Criteria" heading)
  if (notionPage.children) {
    const criteria = extractCriteriaFromBlocks(notionPage.children);
    if (criteria.length > 0) {
      item.acceptanceCriteria = criteria;
    }
  }

  // Priority
  const notionPriority = props.Priority?.select?.name;
  if (notionPriority && NOTION_TO_PRIORITY[notionPriority]) {
    item.priority = NOTION_TO_PRIORITY[notionPriority];
  }

  // Tags
  const tags = props.Tags?.multi_select;
  if (tags && tags.length > 0) {
    item.tags = tags.map((t: any) => t.name);
  }

  // Source
  const sourceProp =
    props.Source?.rich_text?.[0]?.plain_text ??
    props.Source?.rich_text?.[0]?.text?.content;
  if (sourceProp) {
    item.source = sourceProp;
  }

  // Blocked By
  const blockedByProp =
    props["Blocked By"]?.rich_text?.[0]?.plain_text ??
    props["Blocked By"]?.rich_text?.[0]?.text?.content;
  if (blockedByProp) {
    item.blockedBy = blockedByProp
      .split(",")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
  }

  // Started At
  const startedAtProp =
    props["Started At"]?.rich_text?.[0]?.plain_text ??
    props["Started At"]?.rich_text?.[0]?.text?.content;
  if (startedAtProp) {
    item.startedAt = startedAtProp;
  }

  // Completed At
  const completedAtProp =
    props["Completed At"]?.rich_text?.[0]?.plain_text ??
    props["Completed At"]?.rich_text?.[0]?.text?.content;
  if (completedAtProp) {
    item.completedAt = completedAtProp;
  }

  return item;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Body block extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract description text from Notion page body blocks.
 * Collects paragraph blocks that appear before any heading block
 * (headings typically start structured sections like "Acceptance Criteria").
 */
function extractDescriptionFromBlocks(blocks: any[]): string | undefined {
  const paragraphs: string[] = [];

  for (const block of blocks) {
    if (block.type?.startsWith("heading")) break;
    if (block.type === "paragraph") {
      const text = extractRichTextContent(block.paragraph?.rich_text);
      if (text) paragraphs.push(text);
    }
  }

  return paragraphs.length > 0 ? paragraphs.join("\n\n") : undefined;
}

/**
 * Extract acceptance criteria from Notion page body blocks.
 * Looks for to_do blocks that follow an "Acceptance Criteria" heading.
 */
function extractCriteriaFromBlocks(blocks: any[]): string[] {
  const criteria: string[] = [];
  let inCriteriaSection = false;

  for (const block of blocks) {
    if (block.type?.startsWith("heading")) {
      const headingText = extractRichTextContent(
        block[block.type]?.rich_text,
      );
      inCriteriaSection =
        headingText?.toLowerCase() === "acceptance criteria";
      continue;
    }

    if (inCriteriaSection && block.type === "to_do") {
      const text = extractRichTextContent(block.to_do?.rich_text);
      if (text) criteria.push(text);
    }
  }

  return criteria;
}

/**
 * Extract plain text from a Notion rich_text array.
 */
function extractRichTextContent(richText: any[] | undefined): string | undefined {
  if (!richText || richText.length === 0) return undefined;
  return richText
    .map((rt: any) => rt.plain_text ?? rt.text?.content ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Group-aware status resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Notion status name to a PRD ItemStatus.
 *
 * First tries an exact match against known status option names.
 * If no exact match, falls back to group-based resolution — any custom
 * status option assigned to a Notion status group will map to the
 * corresponding PRD status:
 *
 * - "To-do" group     → pending
 * - "In progress" group → in_progress
 * - "Complete" group   → completed
 *
 * This handles databases where users have added custom status options
 * (e.g. "Blocked" in the "In progress" group) that don't exactly match
 * our canonical names.
 */
const GROUP_TO_STATUS: Record<NotionStatusGroup, ItemStatus> = {
  "To-do": "pending",
  "In progress": "in_progress",
  "Complete": "completed",
};

export function resolveStatusFromNotion(
  statusName: string,
  group?: NotionStatusGroup,
): ItemStatus {
  // Exact match against known options
  const exact = NOTION_TO_STATUS[statusName];
  if (exact) return exact;

  // Fall back to group-based resolution
  if (group) {
    return GROUP_TO_STATUS[group] ?? "pending";
  }

  return "pending";
}

// ---------------------------------------------------------------------------
// Database schema validation
// ---------------------------------------------------------------------------

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that a Notion database has the expected property configuration
 * for rex sync. Checks property names and types; does not validate individual
 * option values (those can be added via the Notion UI).
 */
export function validateDatabaseSchema(
  /* eslint-disable @typescript-eslint/no-explicit-any */
  databaseProperties: Record<string, any>,
  /* eslint-enable @typescript-eslint/no-explicit-any */
): SchemaValidationResult {
  const errors: string[] = [];

  for (const [propName, schema] of Object.entries(DATABASE_SCHEMA)) {
    const dbProp = databaseProperties[propName];

    if (!dbProp) {
      // Name and Status are required; others are optional
      if (propName === "Name" || propName === "Status" || propName === "Level" || propName === "PRD ID") {
        errors.push(`Missing required property: "${propName}"`);
      }
      continue;
    }

    if (dbProp.type !== schema.type) {
      errors.push(
        `Property "${propName}" has type "${dbProp.type}", expected "${schema.type}"`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Parent resolution
// ---------------------------------------------------------------------------

/**
 * Determine the Notion parent reference for an item.
 *
 * @param item       The PRDItem being placed.
 * @param databaseId The root Notion database ID (used for top-level items).
 * @param idMap      Map of PRD item ID → Notion page ID (for already-synced items).
 * @param parentId   The PRD ID of this item's parent (from the tree walk).
 */
export function resolveParentPage(
  item: PRDItem,
  databaseId: string,
  idMap: Map<string, string>,
  parentId?: string,
): NotionParent {
  // Root-level items are always top-level in the database
  if (isRootLevel(item.level)) {
    return { database_id: databaseId };
  }

  // For sub-items, look up the parent's Notion page ID
  if (parentId) {
    const parentNotionId = idMap.get(parentId);
    if (parentNotionId) {
      return { page_id: parentNotionId };
    }
  }

  // Fallback: place in the database directly
  return { database_id: databaseId };
}

// ---------------------------------------------------------------------------
// Document → Notion (tree flattening)
// ---------------------------------------------------------------------------

/**
 * Flatten an entire PRD document into an ordered list of Notion page descriptors.
 * Items are yielded in DFS order so parents are created before children.
 *
 * Each descriptor includes the PRDItem, its mapped Notion properties, body blocks,
 * the resolved Notion parent reference, and the PRD parent ID (for post-creation
 * ID mapping).
 */
export function mapDocumentToNotion(
  doc: PRDDocument,
  databaseId: string,
): NotionPageDescriptor[] {
  const pages: NotionPageDescriptor[] = [];

  for (const { item, parents } of walkTree(doc.items)) {
    const { properties, children } = mapItemToNotion(item);
    const parentItem = parents.length > 0 ? parents[parents.length - 1] : undefined;
    const parentId = parentItem?.id;

    // We can't resolve page_id references during mapping (those come after
    // creation), so we use database_id for epics and record parentItemId for
    // the caller to resolve after page creation.
    const parent: NotionParent =
      isRootLevel(item.level) || !parentId
        ? { database_id: databaseId }
        : { database_id: databaseId }; // caller will remap after creation

    pages.push({
      item,
      parent,
      ...(parentId ? { parentItemId: parentId } : {}),
      properties,
      ...(children ? { children } : {}),
    });
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Notion → Document (tree reconstruction)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reconstruct a PRDDocument tree from a flat list of Notion pages.
 * Uses each page's `parent.page_id` or `parent.database_id` to determine nesting.
 *
 * Pages whose parent.database_id is set are treated as roots.
 * Pages whose parent.page_id matches another page's Notion ID become children.
 * Orphaned pages (parent not found) are placed at root level.
 *
 * @param statusGroupMap  Optional map of status option name → group name, for
 *                        group-based status resolution of custom options.
 */
export function mapNotionToDocument(
  notionPages: any[],
  projectTitle: string,
  statusGroupMap?: Map<string, NotionStatusGroup>,
): PRDDocument {
  // Phase 1: convert all pages to PRDItems and index by Notion page ID
  const itemsByNotionId = new Map<string, PRDItem>();
  const parentNotionIdMap = new Map<string, string | null>(); // notionId → parent notionId (null = root)

  for (const page of notionPages) {
    const item = mapNotionToItem(page, statusGroupMap);
    itemsByNotionId.set(page.id, item);

    if (page.parent?.database_id) {
      parentNotionIdMap.set(page.id, null); // root item
    } else if (page.parent?.page_id) {
      parentNotionIdMap.set(page.id, page.parent.page_id);
    } else {
      parentNotionIdMap.set(page.id, null); // unknown parent → root
    }
  }

  // Phase 2: build the tree by attaching children
  const roots: PRDItem[] = [];

  for (const [notionId, item] of itemsByNotionId) {
    const parentNotionId = parentNotionIdMap.get(notionId);

    if (parentNotionId === null || parentNotionId === undefined) {
      roots.push(item);
      continue;
    }

    const parentItem = itemsByNotionId.get(parentNotionId);
    if (parentItem) {
      if (!parentItem.children) {
        parentItem.children = [];
      }
      parentItem.children.push(item);
    } else {
      // Orphaned — parent Notion page not in the set
      roots.push(item);
    }
  }

  return {
    schema: SCHEMA_VERSION,
    title: projectTitle,
    items: roots,
  };
}

/**
 * Build a status group map from a Notion database schema response.
 * Extracts the Status property's groups and maps each option name to its group.
 *
 * @example
 *   const db = await notion.databases.retrieve({ database_id: "..." });
 *   const groupMap = buildStatusGroupMap(db.properties);
 *   const doc = mapNotionToDocument(pages, "Project", groupMap);
 */
export function buildStatusGroupMap(
  databaseProperties: Record<string, any>,
): Map<string, NotionStatusGroup> {
  const map = new Map<string, NotionStatusGroup>();
  const statusProp = databaseProperties.Status;

  if (statusProp?.type !== "status" || !statusProp.status?.groups) {
    return map;
  }

  for (const group of statusProp.status.groups) {
    const groupName = group.name as NotionStatusGroup;
    // Match option IDs to option names
    const optionIds = new Set<string>(group.option_ids ?? []);
    for (const option of statusProp.status.options ?? []) {
      if (optionIds.has(option.id)) {
        map.set(option.name, groupName);
      }
    }
  }

  return map;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
