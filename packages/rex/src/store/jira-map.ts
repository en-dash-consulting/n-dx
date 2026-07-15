/**
 * Bidirectional mapping between PRD items and Jira issues.
 *
 * Jira has no cross-instance "external id" field and its native hierarchy
 * (epic/story/subtask) is issue-type-specific, so — like the GitHub Projects
 * adapter — all PRD-only structure is encoded in the issue description:
 *
 * - **title**   ↔ issue `summary`
 * - **description + acceptanceCriteria** ↔ the human-readable part of the
 *   description
 * - **id / level / status / priority / parentId / tags / …** ↔ a machine-
 *   readable footer (`<!-- n-dx-meta: {json} -->`) at the end of the description
 *
 * The tree is reconstructed from each item's stored `parentId`. Issues created
 * directly in Jira have no footer; those degrade gracefully — the PRD id falls
 * back to the issue key, they are treated as roots, and the level is inferred
 * from depth. When label sync is enabled, PRD tags are also written to the Jira
 * `labels` field (sanitized), but round-trip fidelity comes from the footer.
 */

import { SCHEMA_VERSION, isItemStatus, isPriority, isValidLevel } from "../schema/index.js";
import type {
  PRDDocument,
  PRDItem,
  ItemLevel,
  ItemStatus,
  Priority,
} from "../schema/index.js";
import type { JiraIssue, JiraCreateParams, JiraUpdateParams } from "./jira-client.js";

const AC_HEADING = "## Acceptance Criteria";
const META_PREFIX = "<!-- n-dx-meta:";
const META_SUFFIX = "-->";
const META_RE = /<!--\s*n-dx-meta:\s*([\s\S]*?)-->/;

const LEVEL_BY_DEPTH: ItemLevel[] = ["epic", "feature", "task", "subtask"];

function levelForDepth(depth: number): ItemLevel {
  return LEVEL_BY_DEPTH[Math.min(depth, LEVEL_BY_DEPTH.length - 1)];
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((v): v is string => typeof v === "string");
  return arr.length > 0 ? arr : undefined;
}

/** Jira labels may not contain whitespace; normalise a tag into a valid label. */
function toLabel(tag: string): string {
  return tag.trim().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// PRD metadata carried in the description footer
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

/** Extract the n-dx metadata footer from an issue description, if present. */
export function parseMeta(description: string): ItemMeta {
  const match = description.match(META_RE);
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
// description ↔ description + acceptanceCriteria
// ---------------------------------------------------------------------------

/** Parse the human-readable portion of a description into description + AC. */
export function parseDescription(description: string | undefined): {
  description?: string;
  acceptanceCriteria?: string[];
} {
  if (!description) return {};
  const human = description.replace(META_RE, "").trim();
  if (!human) return {};

  const idx = human.indexOf(AC_HEADING);
  if (idx === -1) {
    return { description: human };
  }

  const desc = human.slice(0, idx).trim();
  const acBlock = human.slice(idx + AC_HEADING.length);
  const acceptanceCriteria = acBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*(\[[ xX]\]\s*)?/, "").trim())
    .filter((line) => line.length > 0);

  const result: { description?: string; acceptanceCriteria?: string[] } = {};
  if (desc) result.description = desc;
  if (acceptanceCriteria.length > 0) result.acceptanceCriteria = acceptanceCriteria;
  return result;
}

/** Render a PRD item into a Jira description string (with metadata footer). */
export function renderDescription(item: PRDItem, parentId?: string): string {
  const parts: string[] = [];
  if (item.description) parts.push(item.description.trim());
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    parts.push([AC_HEADING, ...item.acceptanceCriteria.map((ac) => `- [ ] ${ac}`)].join("\n"));
  }
  parts.push(buildMeta(item, parentId));
  return parts.join("\n\n");
}

function labelsFor(item: PRDItem, syncLabels: boolean): string[] | undefined {
  if (!syncLabels || !item.tags || item.tags.length === 0) return undefined;
  return item.tags.map(toLabel).filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// PRDItem → Jira issue
// ---------------------------------------------------------------------------

/** Map a PRD item to the create parameters for a new Jira issue. */
export function mapItemToCreate(
  item: PRDItem,
  projectKey: string,
  issueType: string,
  syncLabels: boolean,
  parentId?: string,
): JiraCreateParams {
  const params: JiraCreateParams = {
    projectKey,
    issueType,
    summary: item.title,
    description: renderDescription(item, parentId),
  };
  const labels = labelsFor(item, syncLabels);
  if (labels) params.labels = labels;
  return params;
}

/** Map a PRD item to the update parameters for an existing Jira issue. */
export function mapItemToUpdate(
  item: PRDItem,
  syncLabels: boolean,
  parentId?: string,
): JiraUpdateParams {
  const params: JiraUpdateParams = {
    summary: item.title,
    description: renderDescription(item, parentId),
  };
  const labels = labelsFor(item, syncLabels);
  if (labels) params.labels = labels;
  return params;
}

// ---------------------------------------------------------------------------
// Jira issue → PRDItem
// ---------------------------------------------------------------------------

/**
 * Convert a single Jira issue into a PRDItem. `depth` is the issue's distance
 * from the tree root, used to infer a level for issues lacking stored metadata.
 */
export function mapIssueToPRD(issue: JiraIssue, depth: number): PRDItem {
  const meta = parseMeta(issue.description);
  const level = meta.level ?? levelForDepth(depth);
  const status: ItemStatus = meta.status ?? "pending";

  const item: PRDItem = {
    // Issues authored in Jira have no footer id; use the stable issue key.
    id: meta.prdId ?? issue.key,
    title: issue.summary ?? "",
    status,
    level,
  };

  const { description, acceptanceCriteria } = parseDescription(issue.description);
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
// Jira issues → Document (tree reconstruction)
// ---------------------------------------------------------------------------

/**
 * Reconstruct a PRDDocument tree from a flat list of Jira issues. The tree is
 * built from each issue's stored `parentId` (a PRD id): issues with no parent
 * (or an unknown parent) become roots; the rest are attached beneath their
 * parent.
 */
export function mapIssuesToDocument(
  issues: JiraIssue[],
  projectTitle: string,
): PRDDocument {
  const prdIdOf = new Map<JiraIssue, string>();
  const knownPrdIds = new Set<string>();
  for (const issue of issues) {
    const meta = parseMeta(issue.description);
    const prdId = meta.prdId ?? issue.key;
    prdIdOf.set(issue, prdId);
    knownPrdIds.add(prdId);
  }

  const childrenOf = new Map<string | null, JiraIssue[]>();
  for (const issue of issues) {
    const meta = parseMeta(issue.description);
    const parentId = meta.parentId && knownPrdIds.has(meta.parentId) ? meta.parentId : null;
    const list = childrenOf.get(parentId) ?? [];
    list.push(issue);
    childrenOf.set(parentId, list);
  }

  const build = (issue: JiraIssue, depth: number): PRDItem => {
    const item = mapIssueToPRD(issue, depth);
    const childIssues = childrenOf.get(prdIdOf.get(issue) as string) ?? [];
    if (childIssues.length > 0) {
      item.children = childIssues.map((child) => build(child, depth + 1));
    }
    return item;
  };

  const roots = (childrenOf.get(null) ?? []).map((issue) => build(issue, 0));

  return {
    schema: SCHEMA_VERSION,
    title: projectTitle,
    items: roots,
  };
}
