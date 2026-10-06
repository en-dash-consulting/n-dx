/**
 * View model for the v2 product layer and change layer.
 *
 * The Product page, the Changes view and the capability page read these
 * shapes and nothing else — no fetch, no store, no rex import. The viewer
 * cannot import rex (that crosses the server boundary and goes through
 * `src/server/rex-gateway.ts`), so the wire types are declared here the way
 * every other view declares its own, and the three views are driven from
 * fixtures until the v2 reader and its routes land.
 *
 * ## Derived fields are inputs, not outputs
 *
 * Capability `status` and `health`, a change's `stage` and a capability's
 * open-change overlays are *computed* values: the v2 schema deliberately
 * gives them no stored field (see `rex/schema/v2`), and the engine that
 * computes them is a separate piece of work. They arrive here already
 * computed. The helpers below only order and group what they are given.
 *
 * @module viewer/views/product-model
 */

// ── Capability status and health ─────────────────────────────────────

/**
 * Where a capability's spec stands relative to the build. Always computed:
 * `revised` means the requirement moved ahead of what was built, which is
 * the signal a status board cannot show.
 */
export type CapabilityStatus = "proposed" | "changing" | "met" | "revised" | "retired";

/** Whether a map node is working right now. Computed from open fixes. */
export type CapabilityHealth = "ok" | "defective";

/** Display order: unbuilt first, then in flight, then settled. */
export const CAPABILITY_STATUS_ORDER: readonly CapabilityStatus[] = [
  "proposed",
  "changing",
  "revised",
  "met",
  "retired",
];

export const CAPABILITY_STATUS_LABELS: Readonly<Record<CapabilityStatus, string>> = {
  proposed: "Proposed",
  changing: "Changing",
  met: "Met",
  revised: "Revised",
  retired: "Retired",
};

export const CAPABILITY_HEALTH_LABELS: Readonly<Record<CapabilityHealth, string>> = {
  ok: "OK",
  defective: "Defective",
};

// ── Change stage ─────────────────────────────────────────────────────

/**
 * A change's position in its own lifecycle. Computed from its state.
 *
 * **Provisional — this vocabulary is not yet fixed by the schema.** The v2
 * schema has no stage field and no stage concept (grep `stage` over
 * `rex/schema/v2.ts`: nothing), and these five values do not line up with
 * `VALID_STATUSES` either. They are this view's reading of "work grouped by
 * planned release and stage", chosen so a change's state fields map onto them
 * — `ready` from `ready`, `applied` from `appliedIn`, `shipped` from
 * `shippedIn`.
 *
 * The engine that computes derived status, health and edges owns the real
 * vocabulary. When it lands it must either adopt these values or update this
 * type, the three views and their fixtures together: nothing else pins them,
 * so the drift would otherwise be silent.
 */
export type ChangeStage = "proposed" | "ready" | "in-progress" | "applied" | "shipped";

/** Display order within a release group: earliest stage first. */
export const CHANGE_STAGE_ORDER: readonly ChangeStage[] = [
  "proposed",
  "ready",
  "in-progress",
  "applied",
  "shipped",
];

export const CHANGE_STAGE_LABELS: Readonly<Record<ChangeStage, string>> = {
  proposed: "Proposed",
  ready: "Ready",
  "in-progress": "In progress",
  applied: "Applied",
  shipped: "Shipped",
};

/** Heading for changes with no `plannedRelease`. */
export const UNSCHEDULED_RELEASE_LABEL = "Unscheduled";

// ── Map layer ────────────────────────────────────────────────────────

/** How a change moves a capability's spec. */
export type AmendmentDelta = "added" | "modified" | "removed";

/**
 * A change that is open against a capability, rendered as an overlay on the
 * capability's row: what is coming, before it is true.
 */
export interface OpenChangeOverlay {
  id: string;
  displayId?: string;
  title: string;
  stage: ChangeStage;
  /** Absent when the change only touches the capability without amending it. */
  delta?: AmendmentDelta;
}

/** One capability as the Product page lists it. */
export interface CapabilityRow {
  id: string;
  displayId?: string;
  title: string;
  statement?: string;
  status: CapabilityStatus;
  health: CapabilityHealth;
  /** A person has read the spec text. */
  specReviewed?: boolean;
  /**
   * How many criteria the capability has. A count rather than the criteria
   * themselves because the Product page lists every capability and never
   * renders their text; the capability page carries the array instead and
   * drops this field, so the two can never disagree.
   */
  criteriaCount: number;
  openChanges: OpenChangeOverlay[];
}

/** One constraint. Constraints carry health but no capability status. */
export interface ConstraintRow {
  id: string;
  displayId?: string;
  title: string;
  statement?: string;
  health: CapabilityHealth;
  /** `"all"` binds every map node; otherwise the titles it binds. */
  appliesTo: "all" | string[];
}

/** An area and the capabilities under it. */
export interface AreaSection {
  id: string;
  displayId?: string;
  title: string;
  summary?: string;
  stewards?: string[];
  capabilities: CapabilityRow[];
}

/** Everything the Product page renders. */
export interface ProductMap {
  /** The project statement from the root `index.md`. */
  statement?: string;
  areas: AreaSection[];
  constraints: ConstraintRow[];
}

// ── Change layer ─────────────────────────────────────────────────────

/** A capability or constraint a change amends. */
export interface AmendedNode {
  id: string;
  title: string;
  delta: AmendmentDelta;
}

/** A map node a change works on without amending it. */
export interface TouchedNode {
  id: string;
  title: string;
}

/** One change as the Changes view lists it. */
export interface ChangeRow {
  id: string;
  displayId?: string;
  title: string;
  intent?: string;
  stage: ChangeStage;
  priority?: string;
  /** Level of effort in engineer-weeks. */
  loe?: number;
  spike?: boolean;
  assignee?: string;
  plannedRelease?: string;
  shippedIn?: string;
  /** Placement on the map still needs a decision. */
  needsPlacement?: boolean;
  amends: AmendedNode[];
  touches: TouchedNode[];
  taskCount: number;
  completedTaskCount: number;
}

// ── Capability page ──────────────────────────────────────────────────

/** One acceptance criterion, with the capability it came from when inherited. */
export interface CapabilityCriterion {
  id: string;
  text: string;
  /** Title of the capability this criterion is inherited from. */
  inheritedFrom?: string;
}

/** One entry in a capability's history: a change that moved it. */
export interface CapabilityHistoryEntry {
  changeId: string;
  changeDisplayId?: string;
  changeTitle: string;
  stage: ChangeStage;
  delta?: AmendmentDelta;
  /** Release the change shipped in. */
  shippedIn?: string;
  /** ISO timestamp of the stage the entry records. */
  at?: string;
}

/** A file or directory the capability is built in. */
export interface CodeSite {
  path: string;
  /** What the site does for the capability ("entry point", "tests", …). */
  role?: string;
}

/**
 * Everything the capability page renders.
 *
 * Carries `criteria` in place of `CapabilityRow`'s `criteriaCount` — the page
 * renders the criteria and counts them from the array, so a separate count
 * would be a second place to hold one number and a way for the heading to
 * contradict the list below it.
 */
export interface CapabilityDetail extends Omit<CapabilityRow, "criteriaCount"> {
  areaId: string;
  areaTitle: string;
  criteria: CapabilityCriterion[];
  dependsOn: Array<{ id: string; title: string }>;
  history: CapabilityHistoryEntry[];
  code: CodeSite[];
}

// ── Grouping and ordering ────────────────────────────────────────────

/** Changes at one stage, within one release group. */
export interface StageGroup {
  stage: ChangeStage;
  changes: ChangeRow[];
}

/** One release heading on the Changes view, with its stages. */
export interface ReleaseGroup {
  /** The planned release, or `undefined` for the unscheduled group. */
  release?: string;
  label: string;
  stages: StageGroup[];
  changeCount: number;
}

/** A release segment that may be read as a number: digits and nothing else. */
const NUMERIC_SEGMENT = /^\d+$/;

/**
 * Order two release labels.
 *
 * Compared segment by segment as numbers only when *every* segment of both
 * labels is digits, so `0.9.0` precedes `0.10.0`. Testing each segment matters
 * more than it looks: `Number.parseInt` stops at the first non-digit, so a
 * parse-and-check-for-NaN guard reads `2026-Q4` as the number 2026 — two
 * quarters then compare equal and fall back to whatever order they arrived in.
 *
 * Anything else is ordered as text. That orders quarters and codenames
 * sensibly; it does *not* give a prerelease its semver precedence, so `1.0.0`
 * sorts before `1.0.0-rc.1` rather than after it. Encoding prerelease
 * precedence means a semver parser, and `plannedRelease` is a free-text field
 * with no validation behind it — a parser would be guessing at input nothing
 * constrains.
 */
function compareReleases(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  const numeric = (parts: string[]) => parts.every((p) => NUMERIC_SEGMENT.test(p));
  if (!numeric(left) || !numeric(right)) return a.localeCompare(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = Number(left[i] ?? 0) - Number(right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Group changes by planned release, then by stage.
 *
 * Releases sort as versions when every segment is numeric and
 * lexicographically otherwise, so `0.9.0` precedes `0.10.0`. The unscheduled
 * group is always last: it is a backlog, not the next release. Stages keep
 * `CHANGE_STAGE_ORDER` and empty stages are dropped, so a release heading
 * shows only the stages it actually has.
 */
export function groupChangesByRelease(changes: readonly ChangeRow[]): ReleaseGroup[] {
  const byRelease = new Map<string, ChangeRow[]>();
  const unscheduled: ChangeRow[] = [];

  for (const change of changes) {
    if (change.plannedRelease === undefined) {
      unscheduled.push(change);
      continue;
    }
    const bucket = byRelease.get(change.plannedRelease);
    if (bucket) bucket.push(change);
    else byRelease.set(change.plannedRelease, [change]);
  }

  const toStages = (rows: ChangeRow[]): StageGroup[] =>
    CHANGE_STAGE_ORDER
      .map((stage) => ({ stage, changes: rows.filter((c) => c.stage === stage) }))
      .filter((group) => group.changes.length > 0);

  const groups: ReleaseGroup[] = [...byRelease.entries()]
    .sort(([a], [b]) => compareReleases(a, b))
    .map(([release, rows]) => ({
      release,
      label: release,
      stages: toStages(rows),
      changeCount: rows.length,
    }));

  if (unscheduled.length > 0) {
    groups.push({
      label: UNSCHEDULED_RELEASE_LABEL,
      stages: toStages(unscheduled),
      changeCount: unscheduled.length,
    });
  }

  return groups;
}

/**
 * A capability the Product page highlights: its spec has moved ahead of the
 * build, or what was built is broken. These are the two rows a reader is
 * looking for, so they are marked rather than left to be found.
 */
export function needsAttention(row: Pick<CapabilityRow, "status" | "health">): boolean {
  return row.status === "revised" || row.health === "defective";
}

/** Capability rows in display order: attention first, then by status, then title. */
export function sortCapabilities(rows: readonly CapabilityRow[]): CapabilityRow[] {
  return [...rows].sort((a, b) => {
    const attention = Number(needsAttention(b)) - Number(needsAttention(a));
    if (attention !== 0) return attention;
    const byStatus = CAPABILITY_STATUS_ORDER.indexOf(a.status) - CAPABILITY_STATUS_ORDER.indexOf(b.status);
    if (byStatus !== 0) return byStatus;
    return a.title.localeCompare(b.title);
  });
}

/** Counts for the Product page's summary row. */
export interface ProductTotals {
  capabilities: number;
  met: number;
  revised: number;
  defective: number;
  openChanges: number;
}

export function productTotals(map: ProductMap): ProductTotals {
  const capabilities = map.areas.flatMap((area) => area.capabilities);
  const openChangeIds = new Set<string>();
  for (const capability of capabilities) {
    for (const change of capability.openChanges) openChangeIds.add(change.id);
  }
  return {
    capabilities: capabilities.length,
    met: capabilities.filter((c) => c.status === "met").length,
    revised: capabilities.filter((c) => c.status === "revised").length,
    defective: capabilities.filter((c) => c.health === "defective").length
      + map.constraints.filter((c) => c.health === "defective").length,
    openChanges: openChangeIds.size,
  };
}
