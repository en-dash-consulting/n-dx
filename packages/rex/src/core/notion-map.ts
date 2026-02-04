/**
 * Maps PRD hierarchy to Notion database structure.
 *
 * Notion model:
 * - Epics are top-level pages in the database
 * - Features, tasks, and subtasks are sub-pages nested under their parents
 * - Each page uses Notion-native property types (title, status, select, multi_select, rich_text)
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
import { SCHEMA_VERSION } from "../schema/index.js";
import { walkTree } from "./tree.js";

// ---------------------------------------------------------------------------
// Notion property shapes (minimal types for the API subset we use)
// ---------------------------------------------------------------------------

export interface NotionRichText {
  text: { content: string };
}

export interface NotionPageProperties {
  Name: { title: NotionRichText[] };
  Status: { status: { name: string } };
  Level: { select: { name: string } };
  "PRD ID": { rich_text: NotionRichText[] };
  Priority?: { select: { name: string } };
  Tags?: { multi_select: Array<{ name: string }> };
}

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

/** Notion status names used for every level. */
const STATUS_TO_NOTION: Record<ItemStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  completed: "Done",
  deferred: "Deferred",
};

/** Reverse lookup: Notion status name → PRD ItemStatus. */
const NOTION_TO_STATUS: Record<string, ItemStatus> = Object.fromEntries(
  Object.entries(STATUS_TO_NOTION).map(([k, v]) => [v, k as ItemStatus]),
) as Record<string, ItemStatus>;

/** Priority mapping: PRD → Notion (title-cased). */
const PRIORITY_TO_NOTION: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Reverse lookup: Notion priority → PRD Priority. */
const NOTION_TO_PRIORITY: Record<string, Priority> = Object.fromEntries(
  Object.entries(PRIORITY_TO_NOTION).map(([k, v]) => [v, k as Priority]),
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
 */
export function mapNotionToItem(notionPage: any): PRDItem {
  const props = notionPage.properties;

  const title =
    props.Name?.title?.[0]?.plain_text ?? props.Name?.title?.[0]?.text?.content ?? "";
  const notionStatus = props.Status?.status?.name ?? "Not started";
  const level = (props.Level?.select?.name ?? "task") as ItemLevel;
  const prdId =
    props["PRD ID"]?.rich_text?.[0]?.plain_text ??
    props["PRD ID"]?.rich_text?.[0]?.text?.content ??
    "";

  const item: PRDItem = {
    id: prdId || notionPage.id,
    title,
    status: NOTION_TO_STATUS[notionStatus] ?? "pending",
    level,
    remoteId: notionPage.id,
  };

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

  return item;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  // Epics are always top-level in the database
  if (item.level === "epic") {
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
      item.level === "epic" || !parentId
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
 */
export function mapNotionToDocument(
  notionPages: any[],
  projectTitle: string,
): PRDDocument {
  // Phase 1: convert all pages to PRDItems and index by Notion page ID
  const itemsByNotionId = new Map<string, PRDItem>();
  const parentNotionIdMap = new Map<string, string | null>(); // notionId → parent notionId (null = root)

  for (const page of notionPages) {
    const item = mapNotionToItem(page);
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
/* eslint-enable @typescript-eslint/no-explicit-any */
