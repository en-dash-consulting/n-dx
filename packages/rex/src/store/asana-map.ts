/**
 * Bidirectional mapping between PRD items and Asana tasks.
 *
 * Asana's task model is far simpler than Notion's typed database, so this
 * mapping is correspondingly lean:
 *
 * - **title**   ↔ task `name`
 * - **status**  ↔ task `completed` (boolean) for the completed/not-completed
 *                 axis, with the full PRD status preserved in `external.data`
 *                 for round-trip fidelity
 * - **id/level/priority** ↔ the task's native `external` field
 *                 (`{ gid, data }`), which Asana provides specifically for
 *                 integrations to store a foreign reference
 * - **description + acceptanceCriteria** ↔ task `notes` (plain text)
 * - **hierarchy** ↔ Asana subtasks (`parent`)
 *
 * Tasks created in the Asana UI have no `external` field; those degrade
 * gracefully — the PRD id falls back to the Asana gid, the level is inferred
 * from tree depth, and the status from the `completed` flag.
 */

import { SCHEMA_VERSION, isItemStatus, isPriority, isValidLevel } from "../schema/index.js";
import type {
  PRDDocument,
  PRDItem,
  ItemLevel,
  ItemStatus,
  Priority,
} from "../schema/index.js";
import type {
  AsanaTask,
  AsanaCreateParams,
  AsanaExternal,
} from "./asana-client.js";

/** Heading that separates the description from acceptance criteria in `notes`. */
const AC_HEADING = "## Acceptance Criteria";

/** Level assigned to a task by its depth when no explicit level is stored. */
const LEVEL_BY_DEPTH: ItemLevel[] = ["epic", "feature", "task", "subtask"];

function levelForDepth(depth: number): ItemLevel {
  return LEVEL_BY_DEPTH[Math.min(depth, LEVEL_BY_DEPTH.length - 1)];
}

// ---------------------------------------------------------------------------
// PRD metadata carried in Asana's `external.data`
// ---------------------------------------------------------------------------

/**
 * PRD-only fields that have no native Asana equivalent, carried verbatim in
 * `external.data`. Description and acceptance criteria are NOT here — those live
 * in the human-visible `notes` field.
 */
interface ExternalMeta {
  prdId: string;
  level?: ItemLevel;
  status?: ItemStatus;
  priority?: Priority;
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  startedAt?: string;
  completedAt?: string;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((v): v is string => typeof v === "string");
  return arr.length > 0 ? arr : undefined;
}

/** Parse the PRD reference and metadata stored on an Asana task's `external` field. */
export function parseExternal(task: AsanaTask): ExternalMeta {
  const gid = task.external?.gid;
  const meta: ExternalMeta = {
    // A task authored in Asana has no external.gid; use the Asana gid so the
    // item still has a stable identity for subsequent syncs.
    prdId: gid && gid.length > 0 ? gid : task.gid,
  };

  const raw = task.external?.data;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.level === "string" && isValidLevel(parsed.level)) meta.level = parsed.level;
      if (typeof parsed.status === "string" && isItemStatus(parsed.status)) meta.status = parsed.status;
      if (typeof parsed.priority === "string" && isPriority(parsed.priority)) meta.priority = parsed.priority;
      if (typeof parsed.source === "string") meta.source = parsed.source;
      meta.tags = asStringArray(parsed.tags);
      meta.blockedBy = asStringArray(parsed.blockedBy);
      if (typeof parsed.startedAt === "string") meta.startedAt = parsed.startedAt;
      if (typeof parsed.completedAt === "string") meta.completedAt = parsed.completedAt;
    } catch {
      /* malformed metadata — fall back to defaults */
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// notes ↔ description + acceptanceCriteria
// ---------------------------------------------------------------------------

/** Render a PRD item's description and acceptance criteria into `notes` text. */
export function renderNotes(item: PRDItem): string {
  const parts: string[] = [];
  if (item.description) parts.push(item.description.trim());
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    const lines = [AC_HEADING, ...item.acceptanceCriteria.map((ac) => `- [ ] ${ac}`)];
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}

/** Parse `notes` text back into a description and acceptance-criteria list. */
export function parseNotes(notes: string | undefined): {
  description?: string;
  acceptanceCriteria?: string[];
} {
  if (!notes) return {};
  const idx = notes.indexOf(AC_HEADING);
  if (idx === -1) {
    const description = notes.trim();
    return description ? { description } : {};
  }

  const description = notes.slice(0, idx).trim();
  const acBlock = notes.slice(idx + AC_HEADING.length);
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
// PRDItem → Asana
// ---------------------------------------------------------------------------

function buildExternal(item: PRDItem): AsanaExternal {
  const data: Record<string, unknown> = { level: item.level, status: item.status };
  if (item.priority) data.priority = item.priority;
  if (item.tags && item.tags.length > 0) data.tags = item.tags;
  if (item.source) data.source = item.source;
  if (item.blockedBy && item.blockedBy.length > 0) data.blockedBy = item.blockedBy;
  if (item.startedAt) data.startedAt = item.startedAt;
  if (item.completedAt) data.completedAt = item.completedAt;
  return { gid: item.id, data: JSON.stringify(data) };
}

/** Map a PRD item to the create parameters for a new Asana task. */
export function mapItemToCreate(
  item: PRDItem,
  projectId: string,
  parentGid?: string,
): AsanaCreateParams {
  const params: AsanaCreateParams = {
    name: item.title,
    completed: item.status === "completed",
    external: buildExternal(item),
  };
  const notes = renderNotes(item);
  if (notes) params.notes = notes;

  // Subtasks attach to their parent task; root items attach to the project.
  if (parentGid) {
    params.parent = parentGid;
  } else {
    params.projects = [projectId];
  }
  return params;
}

/** Map a PRD item to the update parameters for an existing Asana task. */
export function mapItemToUpdate(item: PRDItem): {
  name: string;
  notes: string;
  completed: boolean;
  external: AsanaExternal;
} {
  return {
    name: item.title,
    notes: renderNotes(item),
    completed: item.status === "completed",
    external: buildExternal(item),
  };
}

// ---------------------------------------------------------------------------
// Asana → PRDItem
// ---------------------------------------------------------------------------

/**
 * Convert a single Asana task into a PRDItem. `depth` is the task's distance
 * from the tree root and is used to infer a level for tasks that lack stored
 * PRD metadata (e.g. tasks created directly in Asana).
 */
export function mapAsanaToItem(task: AsanaTask, depth: number): PRDItem {
  const meta = parseExternal(task);
  const level = meta.level ?? levelForDepth(depth);
  const status: ItemStatus =
    meta.status ?? (task.completed ? "completed" : "pending");

  const item: PRDItem = {
    id: meta.prdId,
    title: task.name ?? "",
    status,
    level,
  };

  const { description, acceptanceCriteria } = parseNotes(task.notes);
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
// Asana → Document (tree reconstruction)
// ---------------------------------------------------------------------------

/**
 * Reconstruct a PRDDocument tree from a flat list of Asana tasks. The tree is
 * built from each task's `parent.gid`: tasks with no parent (or an unknown
 * parent) become roots; the rest are attached beneath their parent. Depth is
 * computed top-down so levels can be inferred for metadata-less tasks.
 */
export function mapAsanaToDocument(
  tasks: AsanaTask[],
  projectTitle: string,
): PRDDocument {
  const byGid = new Map<string, AsanaTask>();
  for (const task of tasks) byGid.set(task.gid, task);

  // childrenByParent: parent gid → child task gids (null key = roots)
  const childrenOf = new Map<string | null, string[]>();
  for (const task of tasks) {
    const parentGid = task.parent?.gid;
    const key = parentGid && byGid.has(parentGid) ? parentGid : null;
    const list = childrenOf.get(key) ?? [];
    list.push(task.gid);
    childrenOf.set(key, list);
  }

  const build = (gid: string, depth: number): PRDItem => {
    const task = byGid.get(gid) as AsanaTask;
    const item = mapAsanaToItem(task, depth);
    const childGids = childrenOf.get(gid) ?? [];
    if (childGids.length > 0) {
      item.children = childGids.map((childGid) => build(childGid, depth + 1));
    }
    return item;
  };

  const roots = (childrenOf.get(null) ?? []).map((gid) => build(gid, 0));

  return {
    schema: SCHEMA_VERSION,
    title: projectTitle,
    items: roots,
  };
}
