/**
 * Bidirectional mapping between PRD items and GitHub Projects (v2) draft issues.
 *
 * GitHub Projects v2 is a flat collection with no `external` field and no native
 * parent/child relationship, so all PRD-only structure is encoded in the draft
 * issue's body:
 *
 * - **title**   ↔ draft issue `title`
 * - **description + acceptanceCriteria** ↔ the human-readable part of `body`
 * - **id / level / status / priority / parentId / tags / …** ↔ a machine-
 *   readable HTML-comment footer (`<!-- n-dx-meta: {json} -->`) that GitHub
 *   hides in rendered markdown
 *
 * The tree is reconstructed from each item's stored `parentId`. Draft issues
 * created in the GitHub UI have no footer; those degrade gracefully — the PRD
 * id falls back to the item's content id, they are treated as roots, and the
 * level is inferred from depth.
 */

import { SCHEMA_VERSION, isItemStatus, isPriority, isValidLevel } from "../schema/index.js";
import type {
  PRDDocument,
  PRDItem,
  ItemLevel,
  ItemStatus,
  Priority,
} from "../schema/index.js";
import type { GitHubProjectItem, DraftContent } from "./github-projects-client.js";

/** Heading that separates the description from acceptance criteria in the body. */
const AC_HEADING = "## Acceptance Criteria";

/** Machine-readable metadata footer markers. */
const META_PREFIX = "<!-- n-dx-meta:";
const META_SUFFIX = "-->";
const META_RE = /<!--\s*n-dx-meta:\s*([\s\S]*?)-->/;

/** Level assigned to a task by its depth when no explicit level is stored. */
const LEVEL_BY_DEPTH: ItemLevel[] = ["epic", "feature", "task", "subtask"];

function levelForDepth(depth: number): ItemLevel {
  return LEVEL_BY_DEPTH[Math.min(depth, LEVEL_BY_DEPTH.length - 1)];
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((v): v is string => typeof v === "string");
  return arr.length > 0 ? arr : undefined;
}

// ---------------------------------------------------------------------------
// PRD metadata carried in the body footer
// ---------------------------------------------------------------------------

interface ItemMeta {
  prdId?: string;
  parentId?: string;
  level?: ItemLevel;
  status?: ItemStatus;
  priority?: Priority;
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  startedAt?: string;
  completedAt?: string;
}

/** Extract the n-dx metadata footer from a draft-issue body, if present. */
export function parseMeta(body: string): ItemMeta {
  const match = body.match(META_RE);
  if (!match) return {};

  const meta: ItemMeta = {};
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    if (typeof parsed.id === "string") meta.prdId = parsed.id;
    if (typeof parsed.parentId === "string") meta.parentId = parsed.parentId;
    if (typeof parsed.level === "string" && isValidLevel(parsed.level)) meta.level = parsed.level;
    if (typeof parsed.status === "string" && isItemStatus(parsed.status)) meta.status = parsed.status;
    if (typeof parsed.priority === "string" && isPriority(parsed.priority)) meta.priority = parsed.priority;
    if (typeof parsed.source === "string") meta.source = parsed.source;
    meta.tags = asStringArray(parsed.tags);
    meta.blockedBy = asStringArray(parsed.blockedBy);
    if (typeof parsed.startedAt === "string") meta.startedAt = parsed.startedAt;
    if (typeof parsed.completedAt === "string") meta.completedAt = parsed.completedAt;
  } catch {
    /* malformed footer — ignore */
  }
  return meta;
}

function buildMeta(item: PRDItem, parentId?: string): string {
  const data: Record<string, unknown> = { id: item.id, level: item.level, status: item.status };
  if (parentId) data.parentId = parentId;
  if (item.priority) data.priority = item.priority;
  if (item.tags && item.tags.length > 0) data.tags = item.tags;
  if (item.source) data.source = item.source;
  if (item.blockedBy && item.blockedBy.length > 0) data.blockedBy = item.blockedBy;
  if (item.startedAt) data.startedAt = item.startedAt;
  if (item.completedAt) data.completedAt = item.completedAt;
  return `${META_PREFIX} ${JSON.stringify(data)} ${META_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// body ↔ description + acceptanceCriteria
// ---------------------------------------------------------------------------

/** Parse the human-readable portion of a body into description + AC. */
export function parseBody(body: string | undefined): {
  description?: string;
  acceptanceCriteria?: string[];
} {
  if (!body) return {};
  // Strip the metadata footer before parsing human content.
  const human = body.replace(META_RE, "").trim();
  if (!human) return {};

  const idx = human.indexOf(AC_HEADING);
  if (idx === -1) {
    return human ? { description: human } : {};
  }

  const description = human.slice(0, idx).trim();
  const acBlock = human.slice(idx + AC_HEADING.length);
  const acceptanceCriteria = acBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*(\[[ xX]\]\s*)?/, "").trim())
    .filter((line) => line.length > 0);

  const result: { description?: string; acceptanceCriteria?: string[] } = {};
  if (description) result.description = description;
  if (acceptanceCriteria.length > 0) result.acceptanceCriteria = acceptanceCriteria;
  return result;
}

// ---------------------------------------------------------------------------
// PRDItem → draft issue
// ---------------------------------------------------------------------------

/** Render a PRD item into a draft-issue title + body (with metadata footer). */
export function mapItemToDraft(item: PRDItem, parentId?: string): DraftContent {
  const parts: string[] = [];
  if (item.description) parts.push(item.description.trim());
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    parts.push([AC_HEADING, ...item.acceptanceCriteria.map((ac) => `- [ ] ${ac}`)].join("\n"));
  }
  parts.push(buildMeta(item, parentId));

  return { title: item.title, body: parts.join("\n\n") };
}

// ---------------------------------------------------------------------------
// draft issue → PRDItem
// ---------------------------------------------------------------------------

/**
 * Convert a single project item into a PRDItem. `depth` is the item's distance
 * from the tree root, used to infer a level for items lacking stored metadata.
 */
export function mapItemToPRD(projItem: GitHubProjectItem, depth: number): PRDItem {
  const meta = parseMeta(projItem.body);
  const level = meta.level ?? levelForDepth(depth);
  const status: ItemStatus = meta.status ?? "pending";

  const item: PRDItem = {
    // Items authored in GitHub have no footer id; use the stable content id.
    id: meta.prdId ?? projItem.contentId,
    title: projItem.title ?? "",
    status,
    level,
  };

  const { description, acceptanceCriteria } = parseBody(projItem.body);
  if (description) item.description = description;
  if (acceptanceCriteria) item.acceptanceCriteria = acceptanceCriteria;
  if (meta.priority) item.priority = meta.priority;
  if (meta.tags) item.tags = meta.tags;
  if (meta.source) item.source = meta.source;
  if (meta.blockedBy) item.blockedBy = meta.blockedBy;
  if (meta.startedAt) item.startedAt = meta.startedAt;
  if (meta.completedAt) item.completedAt = meta.completedAt;

  return item;
}

// ---------------------------------------------------------------------------
// project items → Document (tree reconstruction)
// ---------------------------------------------------------------------------

/**
 * Reconstruct a PRDDocument tree from a flat list of project items. The tree is
 * built from each item's stored `parentId` (a PRD id): items with no parent (or
 * an unknown parent) become roots; the rest are attached beneath their parent.
 */
export function mapItemsToDocument(
  projItems: GitHubProjectItem[],
  projectTitle: string,
): PRDDocument {
  // Resolve each project item's PRD id and parent id up-front.
  const prdIdOf = new Map<GitHubProjectItem, string>();
  const knownPrdIds = new Set<string>();
  for (const pi of projItems) {
    const meta = parseMeta(pi.body);
    const prdId = meta.prdId ?? pi.contentId;
    prdIdOf.set(pi, prdId);
    knownPrdIds.add(prdId);
  }

  // childrenByParent: parent PRD id → child project items (null key = roots)
  const childrenOf = new Map<string | null, GitHubProjectItem[]>();
  for (const pi of projItems) {
    const meta = parseMeta(pi.body);
    const parentId = meta.parentId && knownPrdIds.has(meta.parentId) ? meta.parentId : null;
    const list = childrenOf.get(parentId) ?? [];
    list.push(pi);
    childrenOf.set(parentId, list);
  }

  const build = (pi: GitHubProjectItem, depth: number): PRDItem => {
    const item = mapItemToPRD(pi, depth);
    const childItems = childrenOf.get(prdIdOf.get(pi) as string) ?? [];
    if (childItems.length > 0) {
      item.children = childItems.map((child) => build(child, depth + 1));
    }
    return item;
  };

  const roots = (childrenOf.get(null) ?? []).map((pi) => build(pi, 0));

  return {
    schema: SCHEMA_VERSION,
    title: projectTitle,
    items: roots,
  };
}
