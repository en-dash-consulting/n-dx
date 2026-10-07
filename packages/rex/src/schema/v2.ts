/**
 * Rex schema v2 — the product layer and the change layer.
 *
 * Types and Zod schemas for every v2 node, field and stored file. Wired to
 * nothing yet: only `store/state-writer.ts` (itself unwired) imports this
 * file until the v2 store lands (enforced by tests/unit/schema/v2.test.ts). Validation *rules*
 * (cross-node checks such as "every change amends or touches something")
 * are pure functions in `./v2-rules.ts`; this file only fixes shapes.
 *
 * ## Model
 *
 * Two layers. The **product layer** (area, capability, constraint) describes the
 * product as built, in present tense. The **change layer** (change, task,
 * subtask) is linear work that closes. `type` replaces v1's `level`; a spike
 * is a change with `spike: true`, not a type. Releases are fields on a change
 * (`plannedRelease`, `shippedIn`), never containers.
 *
 * ## Intent and state
 *
 * Every node is stored in two places. **Intent** (what people author) lives
 * in the node's Markdown frontmatter and body. **State** (what tools write)
 * lives in the folder's committed `state.yaml`, keyed by item id. An item
 * absent from `state.yaml` reads as `status: pending` with no stamps.
 *
 * | Intent (`*.md`)                                  | State (`state.yaml`)                         |
 * |--------------------------------------------------|----------------------------------------------|
 * | id, type, title, slug, displayId, aliases        | status, startedAt, completedAt, endedAt      |
 * | tags, source, blockedBy, body, hypotheses*       | activeIntervals                              |
 * | area: summary, stewards                          | failureReason, resolutionType/Detail         |
 * | capability: statement, criteria, requirements,   | metAt, revisedAt, specReviewed, checks       |
 * |   dependsOn                                      |   (product nodes)                            |
 * |                                                  | appliedIn, shippedIn, prs, issues (changes)  |
 * | constraint: statement, requirements, appliesTo   | links*                                       |
 * | change: intent, amends, touches, plannedRelease, | assignee, ready, needsPlacement              |
 * |   spike, priority, requirements, loe,            | lastModified, lastModifiedBy                 |
 * |   loeRationale, loeConfidence, effort*,          |                                              |
 * |   discoveredFrom { item?, run? }, run            |                                              |
 * | task/subtask: description, acceptanceCriteria;   |                                              |
 * |   task also requirements, priority, loe,         |                                              |
 * |   loeRationale, loeConfidence, effort*, run      |                                              |
 *
 * `*` reserved with no shape: `hypotheses` waits for the Hypothesis Layer,
 * `links` for the tracker bridge, `effort` for the task-prep recommender's
 * effort object. Every object schema passes unknown keys through, so a newer
 * writer's fields survive an older reader's save.
 *
 * Derived values (capability health, openAmendments, "bound by" edges,
 * change kind, a change's commits) are computed and cached outside the tree;
 * they have no field here on purpose. A change's commits come from its
 * `N-DX-Item` trailers (`core/change-commits.ts`): a rebase or squash rewrites
 * a SHA but keeps the trailer.
 *
 * @module rex/schema/v2
 */

import { z } from "zod";
import {
  VALID_STATUSES,
  VALID_PRIORITIES,
  RUN_SETTING_KEYS,
  type ItemStatus,
  type Priority,
  type Requirement,
  type ResolutionType,
  type ActiveInterval,
} from "./v1.js";
import { RequirementSchema } from "./validate.js";

// ── Schema stamp ─────────────────────────────────────────────────

/** Stamp written to the root `index.md` and every `state.yaml`. */
export const SCHEMA_VERSION_V2 = "rex/v2";

/** True for `rex/v2` and its forward-compatible minors (`rex/v2.1`). */
export function isV2Schema(version: string | undefined): boolean {
  if (!version) return false;
  return version === SCHEMA_VERSION_V2 || version.startsWith(SCHEMA_VERSION_V2 + ".");
}

const V2StampSchema = z.string().refine(isV2Schema, {
  message: `Incompatible PRD schema version, expected "${SCHEMA_VERSION_V2}"`,
});

// ── Node types ───────────────────────────────────────────────────

export type ProductNodeType = "area" | "capability" | "constraint";
export type ChangeNodeType = "change" | "task" | "subtask";
export type NodeType = ProductNodeType | ChangeNodeType;
export type Layer = "product" | "changes";

export const PRODUCT_NODE_TYPES: ReadonlySet<ProductNodeType> = new Set<ProductNodeType>(["area", "capability", "constraint"]);
export const CHANGE_NODE_TYPES: ReadonlySet<ChangeNodeType> = new Set<ChangeNodeType>(["change", "task", "subtask"]);
/** The closed node set, product layer first. */
export const NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([...PRODUCT_NODE_TYPES, ...CHANGE_NODE_TYPES]);

export function isNodeType(value: string | undefined): value is NodeType {
  return value !== undefined && NODE_TYPES.has(value as NodeType);
}

export function layerOf(type: NodeType): Layer {
  return PRODUCT_NODE_TYPES.has(type as ProductNodeType) ? "product" : "changes";
}

// ── Display ids ──────────────────────────────────────────────────

/**
 * Human-facing ids beside the UUID: `CH-142` for a change (`CH-142.2` for
 * its children) and `A4` / `A4.3` for product nodes. The UUID stays the key.
 */
const DISPLAY_ID_PATTERN = /^(?:CH-\d+|A\d+)(?:\.\d+)*$/;

export function isDisplayId(value: string): boolean {
  return DISPLAY_ID_PATTERN.test(value);
}

// ── Work references (prs, issues) ────────────────────────────────

/** Tracker key such as `WM-2054` (Jira, Linear and similar). */
const TRACKER_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

/**
 * A stored PR or issue reference: a full http(s) URL or a tracker key.
 * Host short forms (`owner/repo#12`, `#12`) are expanded to URLs by the
 * writer, so a short form here means the expansion was skipped and is
 * rejected. Keeping URLs makes the record host-neutral (GitHub, Bitbucket).
 */
export function isWorkRef(value: string): boolean {
  if (TRACKER_KEY_PATTERN.test(value)) return true;
  return /^https?:\/\/[^\s/?#]+/.test(value) && URL.canParse(value);
}

export const WorkRefSchema = z.string().refine(isWorkRef, {
  message: "Expected a full http(s) URL or a tracker key (e.g. WM-2054); expand owner/repo#n before writing",
});

// ── Shared shapes ────────────────────────────────────────────────

const ItemStatusSchema = z.enum([...VALID_STATUSES] as [ItemStatus, ...ItemStatus[]]);
const PrioritySchema = z.enum([...VALID_PRIORITIES] as [Priority, ...Priority[]]);
const ReservedSchema = z.unknown();
/** Engineer-weeks. Frontmatter scalars may arrive as strings ("1.5"), so coerce. */
const LoeSchema = z.coerce.number().positive().optional();

export const LOE_CONFIDENCES = ["low", "medium", "high"] as const;
export type LoeConfidence = (typeof LOE_CONFIDENCES)[number];

/** Level-of-effort fields shared by change and task intent. */
interface EffortIntent {
  /** Level of effort in engineer-weeks. */
  loe?: number;
  /** Why the estimate is what it is. */
  loeRationale?: string;
  loeConfidence?: LoeConfidence;
  /** Reserved for the task-prep recommender's effort object; no shape yet. */
  effort?: unknown;
}

const effortIntentShape = {
  loe: LoeSchema,
  loeRationale: z.string().optional(),
  loeConfidence: z.enum(LOE_CONFIDENCES).optional(),
  effort: ReservedSchema,
};

/** A key of a saved run block (`RUN_SETTING_KEYS`). */
export type RunSettingKey = (typeof RUN_SETTING_KEYS)[number];

/**
 * Saved run settings (`run`): how `ndx work` runs a change or task. Authored
 * intent, so it lives in frontmatter, not `state.yaml`.
 *
 * Loose on purpose, as in v1: known keys come from `RUN_SETTING_KEYS` with
 * any value, and unknown keys pass through. Only writers check strictly, with
 * `validateRunSettings`, which also turns `{}` into "no block" so an empty
 * block is never written. A strict schema here would let one malformed or
 * newer-version block refuse every PRD write; the `run-settings` rule warns
 * instead.
 */
export type SavedRunSettings = { [K in RunSettingKey]?: unknown };

export const SavedRunSettingsSchema = z
  .object(Object.fromEntries(RUN_SETTING_KEYS.map((key) => [key, z.unknown()])) as Record<RunSettingKey, z.ZodUnknown>)
  .passthrough();

/** One acceptance criterion with a stable id (`c1`…`cn`) that deltas address. */
export interface Criterion {
  id: string;
  text: string;
  [key: string]: unknown;
}

export const CriterionSchema = z.object({ id: z.string().min(1), text: z.string() }).passthrough();

export type AmendmentDelta = "added" | "modified" | "removed";
export const AMENDMENT_DELTAS: ReadonlySet<AmendmentDelta> = new Set<AmendmentDelta>(["added", "modified", "removed"]);

/** Criterion-level edits an amendment applies to its target. */
export interface CriteriaDelta {
  add?: Criterion[];
  replace?: Criterion[];
  /** Criterion ids. */
  remove?: string[];
  [key: string]: unknown;
}

/**
 * One product-layer edit a change carries. `target` is the node id (or display id) it
 * edits; for `added` it names the node to create, placed `under` a parent
 * with `title`. Either `criteria` (deterministic delta) or `proposed`
 * (replacement text) describes the edit.
 */
export interface Amendment {
  target: string;
  delta: AmendmentDelta;
  summary: string;
  criteria?: CriteriaDelta;
  proposed?: string;
  under?: string;
  title?: string;
  [key: string]: unknown;
}

export const AmendmentSchema = z
  .object({
    target: z.string().min(1),
    delta: z.enum(["added", "modified", "removed"]),
    summary: z.string(),
    criteria: z
      .object({
        add: z.array(CriterionSchema).optional(),
        replace: z.array(CriterionSchema).optional(),
        remove: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    proposed: z.string().optional(),
    under: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

/**
 * Where a change was found: the change or task whose work surfaced it, the
 * hench run that recorded it, or both. Written by the capture paths (an
 * agent's add_item during a run, review captures, `rex add --discovered-from`).
 */
export interface DiscoveredFrom {
  /** Id of the change or task being worked when this one was found. */
  item?: string;
  /** Hench run id. */
  run?: string;
  [key: string]: unknown;
}

export const DiscoveredFromSchema = z
  .object({
    item: z.string().min(1).optional(),
    run: z.string().min(1).optional(),
  })
  .passthrough();

/** Who stewards a product scope: git emails / identities, or team handles (`@org/team`). */
export type Steward = string;

// ── Intent ───────────────────────────────────────────────────────

interface BaseIntent {
  id: string;
  type: NodeType;
  title: string;
  /** Frozen at creation; the folder or file name. */
  slug: string;
  displayId?: string;
  /** Former ids (folded items, renumbered display ids) that still resolve here. */
  aliases?: string[];
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  /** Markdown body below the frontmatter (History and notes). */
  body?: string;
  /** Reserved for the Hypothesis Layer; no shape yet. */
  hypotheses?: unknown;
  [key: string]: unknown;
}

export interface AreaIntent extends BaseIntent {
  type: "area";
  /** One-paragraph description of what the area covers. */
  summary?: string;
  stewards?: Steward[];
}

export interface CapabilityIntent extends BaseIntent {
  type: "capability";
  statement?: string;
  criteria?: Criterion[];
  requirements?: Requirement[];
  /** Ids of capabilities this one depends on. */
  dependsOn?: string[];
}

export interface ConstraintIntent extends BaseIntent {
  type: "constraint";
  statement?: string;
  requirements?: Requirement[];
  /** `"all"` or the ids of the product nodes the constraint binds. */
  appliesTo?: "all" | string[];
}

export interface ChangeIntent extends BaseIntent, EffortIntent {
  type: "change";
  /** Why the change exists. */
  intent?: string;
  amends?: Amendment[];
  /** Product node ids the change works on without amending them. */
  touches?: string[];
  plannedRelease?: string;
  spike?: boolean;
  priority?: Priority;
  requirements?: Requirement[];
  discoveredFrom?: DiscoveredFrom;
  /** A change with no tasks is itself the unit of work `ndx work` runs. */
  run?: SavedRunSettings;
}

export interface TaskIntent extends BaseIntent, EffortIntent {
  type: "task";
  description?: string;
  acceptanceCriteria?: string[];
  requirements?: Requirement[];
  priority?: Priority;
  run?: SavedRunSettings;
}

export interface SubtaskIntent extends BaseIntent {
  type: "subtask";
  description?: string;
  acceptanceCriteria?: string[];
}

export type NodeIntent = AreaIntent | CapabilityIntent | ConstraintIntent | ChangeIntent | TaskIntent | SubtaskIntent;

const baseIntentShape = {
  id: z.string().min(1),
  title: z.string(),
  slug: z.string().min(1),
  displayId: z.string().refine(isDisplayId, { message: "Expected a display id such as CH-142 or A4.3" }).optional(),
  aliases: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  body: z.string().optional(),
  hypotheses: ReservedSchema,
};

export const AreaIntentSchema = z
  .object({
    ...baseIntentShape,
    type: z.literal("area"),
    summary: z.string().optional(),
    stewards: z.array(z.string()).optional(),
  })
  .passthrough();

export const CapabilityIntentSchema = z
  .object({
    ...baseIntentShape,
    type: z.literal("capability"),
    statement: z.string().optional(),
    criteria: z.array(CriterionSchema).optional(),
    requirements: z.array(RequirementSchema).optional(),
    dependsOn: z.array(z.string()).optional(),
  })
  .passthrough();

export const ConstraintIntentSchema = z
  .object({
    ...baseIntentShape,
    type: z.literal("constraint"),
    statement: z.string().optional(),
    requirements: z.array(RequirementSchema).optional(),
    appliesTo: z.union([z.literal("all"), z.array(z.string())]).optional(),
  })
  .passthrough();

export const ChangeIntentSchema = z
  .object({
    ...baseIntentShape,
    type: z.literal("change"),
    intent: z.string().optional(),
    amends: z.array(AmendmentSchema).optional(),
    touches: z.array(z.string()).optional(),
    plannedRelease: z.string().optional(),
    spike: z.boolean().optional(),
    priority: PrioritySchema.optional(),
    requirements: z.array(RequirementSchema).optional(),
    discoveredFrom: DiscoveredFromSchema.optional(),
    run: SavedRunSettingsSchema.optional(),
    ...effortIntentShape,
  })
  .passthrough();

export const TaskIntentSchema = z
  .object({
    ...baseIntentShape,
    type: z.literal("task"),
    description: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
    requirements: z.array(RequirementSchema).optional(),
    priority: PrioritySchema.optional(),
    run: SavedRunSettingsSchema.optional(),
    ...effortIntentShape,
  })
  .passthrough();

export const SubtaskIntentSchema = z
  .object({
    ...baseIntentShape,
    type: z.literal("subtask"),
    description: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
  })
  .passthrough();

/** Any node's intent, dispatched on `type`. A v1 `level` alone is refused. */
export const NodeIntentSchema = z.discriminatedUnion("type", [
  AreaIntentSchema,
  CapabilityIntentSchema,
  ConstraintIntentSchema,
  ChangeIntentSchema,
  TaskIntentSchema,
  SubtaskIntentSchema,
]);

// ── State ────────────────────────────────────────────────────────

export type CheckResultValue = "pass" | "fail" | "skipped";

/** Last result of running one requirement's check. */
export interface CheckResult {
  requirementId: string;
  result: CheckResultValue;
  /** ISO timestamp of the run. */
  at: string;
  detail?: string;
  [key: string]: unknown;
}

export const CheckResultSchema = z
  .object({
    requirementId: z.string().min(1),
    result: z.enum(["pass", "fail", "skipped"]),
    at: z.string(),
    detail: z.string().optional(),
  })
  .passthrough();

/**
 * Tool-written state for one item, as stored under its id in `state.yaml`.
 * One flat shape for every type, because the file is keyed by id alone;
 * which fields apply to which type is noted per field.
 */
export interface ItemState {
  /** Absent reads as `pending`. */
  status?: ItemStatus;
  startedAt?: string;
  completedAt?: string;
  endedAt?: string;
  activeIntervals?: ActiveInterval[];
  failureReason?: string;
  resolutionType?: ResolutionType;
  resolutionDetail?: string;
  /** Product nodes: hash of statement + criteria when an applied change last satisfied it. */
  metAt?: string;
  /**
   * Product nodes: when the spec became revised. The state writer stamps it when a
   * spec edit first makes the spec hash differ from `metAt`, and keeps it
   * across later edits and state writes. It clears it whenever the hash equals
   * `metAt` again: `metAt` is re-stamped, or the spec is reverted to its met
   * text. Otherwise a later revision would inherit the earlier one's age.
   * `long-revised` measures age from it, not from `lastModified`.
   */
  revisedAt?: string;
  /** Product nodes: a person reviewed the spec text. */
  specReviewed?: boolean;
  /** Product nodes: last result per requirement check. */
  checks?: CheckResult[];
  /** Changes: commit in which the change's amendments were applied to the product layer. */
  appliedIn?: string;
  /** Changes: release version the change shipped in. */
  shippedIn?: string;
  /** Changes: PR references (full URLs or tracker keys). */
  prs?: string[];
  /** Changes: issue references (full URLs or tracker keys). */
  issues?: string[];
  /** Reserved for the tracker bridge; no shape yet. */
  links?: unknown;
  /** Changes and tasks. "Name <email>" identity. */
  assignee?: string;
  /** Changes and tasks: informational readiness. */
  ready?: boolean;
  /** Changes: placement on the product layer still needs a decision (blocks autonomous selection only). */
  needsPlacement?: boolean;
  lastModified?: string;
  lastModifiedBy?: string;
  [key: string]: unknown;
}

export const ItemStateSchema = z
  .object({
    status: ItemStatusSchema.optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    endedAt: z.string().optional(),
    activeIntervals: z.array(z.object({ start: z.string(), end: z.string().optional() }).passthrough()).optional(),
    failureReason: z.string().optional(),
    resolutionType: z.enum(["code-change", "config-override", "acknowledgment", "deferred", "unclassified"]).optional(),
    resolutionDetail: z.string().optional(),
    metAt: z.string().optional(),
    revisedAt: z.string().optional(),
    specReviewed: z.boolean().optional(),
    checks: z.array(CheckResultSchema).optional(),
    appliedIn: z.string().optional(),
    shippedIn: z.string().optional(),
    prs: z.array(WorkRefSchema).optional(),
    issues: z.array(WorkRefSchema).optional(),
    links: ReservedSchema,
    assignee: z.string().optional(),
    ready: z.boolean().optional(),
    needsPlacement: z.boolean().optional(),
    lastModified: z.string().optional(),
    lastModifiedBy: z.string().optional(),
  })
  .passthrough();

/**
 * State keys an earlier v2 draft declared and this schema dropped, each with
 * the reason reported when one is found. Being undeclared, the state writer
 * keeps them as unknown keys, so an old `state.yaml` still loads and
 * round-trips; nothing reads them, and the `retired-state-field` rule warns.
 */
export const RETIRED_STATE_FIELDS: Readonly<Record<string, string>> = {
  commits: "a change's commits are computed from its N-DX-Item trailers, because a rebase or squash rewrites stored SHAs",
};

// ── Stored files ─────────────────────────────────────────────────

/** A folder's `state.yaml`: state for the folder item and its leaf files. */
export interface StateFile {
  schema: string;
  items: Record<string, ItemState>;
  [key: string]: unknown;
}

export const StateFileSchema = z
  .object({ schema: V2StampSchema, items: z.record(z.string(), ItemStateSchema) })
  .passthrough();

/** Root `index.md` frontmatter of the product layer: project title, stamp, project-wide requirements, stewards. */
export interface RootHeader {
  title: string;
  schema: string;
  requirements?: Requirement[];
  stewards?: Steward[];
  [key: string]: unknown;
}

export const RootHeaderSchema = z
  .object({
    title: z.string(),
    schema: V2StampSchema,
    requirements: z.array(RequirementSchema).optional(),
    stewards: z.array(z.string()).optional(),
  })
  .passthrough();

// ── Loaded nodes ─────────────────────────────────────────────────

/** A node as readers see it: intent merged with its state entry. */
export type V2Node<I extends NodeIntent = NodeIntent> = I & ItemState;
export type AreaNode = V2Node<AreaIntent>;
export type CapabilityNode = V2Node<CapabilityIntent>;
export type ConstraintNode = V2Node<ConstraintIntent>;
export type ChangeNode = V2Node<ChangeIntent>;
export type TaskNode = V2Node<TaskIntent>;
export type SubtaskNode = V2Node<SubtaskIntent>;
