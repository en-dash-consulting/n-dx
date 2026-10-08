/**
 * Rex schema v2 — validation rules.
 *
 * Cross-node checks over a loaded v2 tree, as pure functions: no I/O, no
 * clock (the caller passes `now`), no mutation. Shapes live in `./v2.ts`;
 * this file judges how nodes relate. Wired to nothing yet, like `./v2.ts`.
 *
 * Errors make a tree invalid. Warnings are health signals for stewards.
 *
 * Every rule ignores `deleted` nodes: they are tombstones kept for history,
 * not part of the product layer or the plan. Two rules also read tombstones
 * (a node an applied `removed` amendment retired): `ref-resolves`, for which
 * a reference to one is history, not dangling; and `removed-target-live`,
 * which reports an open change removing one.
 *
 * @module rex/schema/v2-rules
 */

import { createHash } from "node:crypto";
import type { ItemStatus } from "./v1.js";
import { validateRunSettings } from "./validate.js";
import { layerOf, RETIRED_STATE_FIELDS, type AddedNodeType, type Amendment, type Criterion, type Layer, type NodeType, type V2Node } from "./v2.js";

// ── Inputs and findings ──────────────────────────────────────────

/** A loaded node with its children, as the rules walk it. */
export type RuleNode = V2Node & { children?: RuleNode[] };

/** Both layers' roots: `.ndx/rex/product` and `.ndx/rex/changes`. Keys match {@link Layer}. */
export interface V2Tree {
  product: RuleNode[];
  changes: RuleNode[];
}

export interface RuleOptions {
  /** The reference time for age-based warnings. Rules never read the clock. */
  now: Date;
  /** Days a product node may stay revised before `long-revised` warns. Default 14. */
  longRevisedDays?: number;
  /**
   * This project's releases, for `title-release-token`: the package version
   * line plus every `plannedRelease` and `shippedIn` in the tree. A title
   * version token is flagged only when it names one of these. Default none.
   */
  releases?: readonly string[];
}

export type RuleSeverity = "error" | "warning";

export type V2RuleId =
  | "change-has-target"
  | "change-placed-at-close"
  | "fix-not-spike"
  | "amendment-type"
  | "ref-unique"
  | "ref-resolves"
  | "title-release-token"
  | "layer-nesting"
  | "capability-depth"
  | "depends-on-acyclic"
  | "removed-target-live"
  | "capability-statement"
  | "check-unique"
  | "capability-criteria"
  | "long-revised"
  | "area-balance"
  | "unreviewed-spec"
  | "run-settings"
  | "retired-state-field"
  | "check-requirement";

export interface RuleFinding {
  rule: V2RuleId;
  severity: RuleSeverity;
  /** Id of the node the finding is about. */
  nodeId: string;
  message: string;
}

export const DEFAULT_LONG_REVISED_DAYS = 14;
/** `area-balance` warns when one area holds more than this share of capabilities. */
export const AREA_MAX_SHARE = 0.4;
/** `area-balance` warns when an area holds fewer capabilities than this. */
export const AREA_MIN_CAPABILITIES = 2;

// ── Tree index ───────────────────────────────────────────────────

export interface TreeEntry {
  node: RuleNode;
  parent?: RuleNode;
  /** The layer root the node was loaded under. */
  root: Layer;
  /**
   * Set on a tombstone: a `deleted` node, or a node under one. Only an index
   * built with `includeTombstones` holds these.
   */
  retired?: true;
}

export interface TreeIndex {
  /** Indexed nodes, depth first, product layer first. Live only unless built with `includeTombstones`. */
  entries: TreeEntry[];
  /**
   * Resolves an id, display id or alias to its node. Ids and display ids win
   * over aliases, so an alias never shadows a real id; live nodes win over
   * tombstones, so a folded id kept as an alias resolves to the live node.
   */
  resolve(ref: string): RuleNode | undefined;
}

export interface IndexOptions {
  /**
   * Also index `deleted` nodes and their descendants, marked `retired`, so a
   * reader can see a node an applied `removed` amendment retired. Default
   * false: rules see live nodes only.
   */
  includeTombstones?: boolean;
}

function isDeleted(node: RuleNode): boolean {
  return node.status === "deleted";
}

/** A node's id and display id. */
function primaryRefs(node: RuleNode): string[] {
  return node.displayId ? [node.id, node.displayId] : [node.id];
}

export function indexTree(tree: V2Tree, { includeTombstones = false }: IndexOptions = {}): TreeIndex {
  const entries: TreeEntry[] = [];
  const visit = (node: RuleNode, parent: RuleNode | undefined, root: Layer, underTombstone: boolean): void => {
    const retired = underTombstone || isDeleted(node);
    if (retired && !includeTombstones) return;
    entries.push(retired ? { node, parent, root, retired } : { node, parent, root });
    for (const child of node.children ?? []) visit(child, node, root, retired);
  };
  for (const node of tree.product) visit(node, undefined, "product", false);
  for (const node of tree.changes) visit(node, undefined, "changes", false);

  // Precedence: live ids, live aliases, retired ids, retired aliases. Within a tier the first claim wins.
  const byRef = new Map<string, RuleNode>();
  const claim = (node: RuleNode, refs: readonly string[]): void => {
    for (const ref of refs) if (ref && !byRef.has(ref)) byRef.set(ref, node);
  };
  for (const retired of [false, true]) {
    const tier = entries.filter((e) => !!e.retired === retired);
    for (const { node } of tier) claim(node, primaryRefs(node));
    for (const { node } of tier) claim(node, node.aliases ?? []);
  }
  return { entries, resolve: (ref) => byRef.get(ref) };
}

// ── Change predicates ────────────────────────────────────────────

/**
 * A change is applied when `appliedAt` is set, and by nothing else: a
 * completed status does not apply a change (`rex.applyOn` may defer apply to
 * review or release).
 */
export function isAppliedChange(node: RuleNode): boolean {
  return node.type === "change" && !!node.appliedAt;
}

/** Statuses after which a change never acts on the product layer. */
const ABANDONED_CHANGE_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["cancelled", "deleted"]);

/**
 * A change still acting on the product layer: not applied, and not cancelled
 * or deleted. A completed but unapplied change is open, so its targets keep
 * reading changing.
 */
export function isOpenChange(node: RuleNode): boolean {
  return node.type === "change" && !isAppliedChange(node) && !ABANDONED_CHANGE_STATUSES.has(node.status ?? "pending");
}

/** Each rule's fixed severity. */
export const RULE_SEVERITY: Readonly<Record<V2RuleId, RuleSeverity>> = {
  "change-has-target": "error",
  "change-placed-at-close": "error",
  "fix-not-spike": "error",
  "amendment-type": "error",
  "ref-unique": "error",
  "ref-resolves": "error",
  "title-release-token": "error",
  "layer-nesting": "error",
  "capability-depth": "error",
  "depends-on-acyclic": "error",
  "removed-target-live": "error",
  "capability-statement": "error",
  "check-unique": "error",
  "capability-criteria": "warning",
  "long-revised": "warning",
  "area-balance": "warning",
  "unreviewed-spec": "warning",
  "run-settings": "warning",
  "retired-state-field": "warning",
  "check-requirement": "warning",
};

function finding(rule: V2RuleId, node: RuleNode, message: string): RuleFinding {
  return { rule, severity: RULE_SEVERITY[rule], nodeId: node.id, message };
}

// ── Title lint ───────────────────────────────────────────────────

/** `0.8.0`, `v1.2.3`, `1.0.0-beta.1`, `0.8.x`, `v1.0`. A bare `0.8` is a number, not a release. */
const VERSION_TOKEN = /\b(?:v?\d+\.\d+\.(?:\d+|x)(?:-[0-9A-Za-z.]+)?|v\d+\.\d+)\b/gi;
/** `PR 12`, `PR #12`, `PR-12`, `PR12`, `pull request 12`. A bare `#12` is too ambiguous to flag. */
const PR_TOKEN = /\b(?:PR|pull request)\s*[#-]?\s*\d+\b/i;

const normalizeVersion = (version: string): string => version.trim().toLowerCase().replace(/^v/, "");

/**
 * Whether a version token names one of `releases`. A full version must equal
 * a release; a line (`0.8.x`, `v1.0`) names every release in it.
 */
function namesRelease(token: string, releases: ReadonlySet<string>): boolean {
  const version = normalizeVersion(token);
  const line = /^(\d+\.\d+)(?:\.x)?$/.exec(version)?.[1];
  if (!line) return releases.has(version);
  for (const release of releases) if (release.startsWith(`${line}.`)) return true;
  return false;
}

/**
 * The release or PR token a title carries, if any. Releases are fields on a
 * change (`plannedRelease`, `shippedIn`) and PRs are state (`prs`); a title
 * that names one is using the node as a container.
 *
 * Only this project's own `releases` count: "Upgrade zod to 3.25.76" names a
 * dependency, not a release. With no releases, no version token is flagged.
 * PR tokens are always flagged.
 */
export function titleReleaseToken(title: string, releases: readonly string[] = []): string | undefined {
  const known = new Set(releases.map(normalizeVersion));
  const release = [...title.matchAll(VERSION_TOKEN)].find(([token]) => namesRelease(token, known));
  return (release ?? PR_TOKEN.exec(title))?.[0];
}

// ── Spec hash ────────────────────────────────────────────────────

/**
 * The hash `metAt` records: SHA-256 hex of the trimmed statement and the
 * criteria (id and trimmed text, in order). Nothing else in the node is
 * hashed, so retitling or retagging does not mark a node revised.
 */
export function specHash(spec: { statement?: string; criteria?: Criterion[] }): string {
  const canonical = JSON.stringify([
    (spec.statement ?? "").trim(),
    (spec.criteria ?? []).map((c) => [c.id, c.text.trim()]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** A product node's spec as `specHash` reads it: its own statement and criteria (a constraint has none). */
function nodeSpec(node: RuleNode): { statement?: string; criteria?: Criterion[] } {
  return node.type === "capability" ? node : { statement: node.type === "constraint" ? node.statement : undefined };
}

// ── Rules ────────────────────────────────────────────────────────

/** `withTombstones` is the same tree indexed with `includeTombstones`, for the rules that must see retired nodes. */
type Rule = (index: TreeIndex, options: RuleOptions, withTombstones: TreeIndex) => RuleFinding[];

const hasTarget = (node: RuleNode): boolean => node.type === "change" && !!(node.amends?.length || node.touches?.length);

/** An Inbox change (`needsPlacement`) waits for a person to confirm its targets, so it may have none yet. */
const changeHasTarget: Rule = ({ entries }) =>
  entries.flatMap(({ node }) => {
    if (node.type !== "change" || node.spike || node.needsPlacement || hasTarget(node)) return [];
    return [finding("change-has-target", node, `Change "${node.title}" neither amends nor touches a product node; mark it a spike or name its target`)];
  });

/**
 * Placement is required before close: a completed change cannot carry
 * `needsPlacement`. A placed change with no target is `change-has-target`'s,
 * so together they hold every completed change to a target unless it is a spike.
 */
const changePlacedAtClose: Rule = ({ entries }) =>
  entries.flatMap(({ node }) => {
    if (node.type !== "change" || node.status !== "completed" || !node.needsPlacement) return [];
    const untargeted = node.spike || hasTarget(node) ? "" : "; it must also amend or touch a product node, or be a spike";
    return [finding("change-placed-at-close", node, `Change "${node.title}" is completed but still needs placement; a person must confirm its targets before it closes${untargeted}`)];
  });

const fixNotSpike: Rule = ({ entries }) =>
  entries.flatMap(({ node }) =>
    node.type === "change" && node.fix && node.spike
      ? [finding("fix-not-spike", node, `Change "${node.title}" is both a fix and a spike; a fix repairs product nodes, a spike changes none`)]
      : [],
  );

/** `type` names what an `added` amendment creates (a capability when absent, unreported); it means nothing on another delta. */
const amendmentType: Rule = ({ entries }) =>
  entries.flatMap(({ node }) =>
    (node.type === "change" ? (node.amends ?? []) : [])
      .filter((a) => a.delta !== "added" && a.type !== undefined)
      .map((a) =>
        finding("amendment-type", node, `Change "${node.title}" gives its ${a.delta} amendment of "${a.target}" a type; only an added amendment has one`),
      ),
  );

const named = (node: RuleNode): string => `${node.type} "${node.title}" (${node.id})`;

/** An id, display id or alias names one live node across both layers. Reported on the later node. */
const refUnique: Rule = ({ entries }) => {
  const owner = new Map<string, RuleNode>();
  const findings: RuleFinding[] = [];
  for (const { node } of entries) {
    for (const ref of new Set([...primaryRefs(node), ...(node.aliases ?? [])])) {
      const first = owner.get(ref);
      if (!first) owner.set(ref, node);
      else findings.push(finding("ref-unique", node, `"${ref}" names both ${named(first)} and ${named(node)}`));
    }
  }
  return findings;
};

/** Where a node sits, as placement reads it: its type and its parent's. */
interface Place {
  type: NodeType;
  parentType?: NodeType;
}

/** A kind a reference must name: a test over the place it names, and how a finding describes it. */
interface Destination {
  holds: (place: Place) => boolean;
  wanted: string;
}

const PRODUCT_NODE: Destination = { holds: ({ type }) => layerOf(type) === "product", wanted: "a product-layer node" };
const CHANGE_NODE: Destination = { holds: ({ type }) => layerOf(type) === "changes", wanted: "a change-layer node" };
const CAPABILITY: Destination = { holds: ({ type }) => type === "capability", wanted: "a capability" };

/**
 * What can hold an added node, by `layer-nesting` and `capability-depth`: a
 * capability goes under an area or a top-level capability; a constraint under
 * any product node.
 */
const HOLDER: Readonly<Record<AddedNodeType, Destination>> = {
  capability: {
    holds: ({ type, parentType }) => type === "area" || (type === "capability" && parentType !== "capability"),
    wanted: "an area or a capability not nested in another, which can hold a capability",
  },
  constraint: { ...PRODUCT_NODE, wanted: "a product-layer node, which can hold a constraint" },
};

const describePlace = ({ type, parentType }: Place): string =>
  type === "capability" && parentType === "capability" ? "a capability nested in a capability" : `${type === "area" ? "an" : "a"} ${type}`;

type AddedAmendment = Amendment & { delta: "added" };

/**
 * An unapplied change's additions placed under one another must form a tree:
 * each chain of same-change parents ends at an existing node or the layer
 * root. Reports each cycle once, naming its amendments, and each addition
 * whose chain runs into one. Returns the additions whose chain ends.
 */
function sameChangeTree(node: RuleNode, added: ReadonlyMap<string, AddedAmendment>): { findings: RuleFinding[]; placed: Set<AddedAmendment> } {
  const findings: RuleFinding[] = [];
  const placed = new Set<AddedAmendment>();
  const reported = new Set<string>();
  for (const a of added.values()) {
    const path: AddedAmendment[] = [a];
    let cycle: AddedAmendment[] | undefined;
    for (let next = a.under === undefined ? undefined : added.get(a.under); next; next = next.under === undefined ? undefined : added.get(next.under)) {
      const at = path.indexOf(next);
      if (at >= 0) {
        cycle = path.slice(at);
        break;
      }
      path.push(next);
    }
    if (!cycle) {
      placed.add(a);
    } else if (cycle[0] !== a) {
      findings.push(finding("ref-resolves", node, `change "${node.title}" adds "${a.target}" under "${a.under}", whose same-change parents never reach an existing node or the layer root`));
    } else {
      const key = cycle.map((c) => c.target).sort().join(" ");
      if (reported.has(key)) continue;
      reported.add(key);
      const what = cycle.length === 1 ? `"${a.target}" under itself` : cycle.map((c) => `"${c.target}" under "${c.under}"`).join(", ");
      findings.push(finding("ref-resolves", node, `change "${node.title}" adds ${what}; added nodes cannot hold one another in a cycle`));
    }
  }
  return { findings, placed };
}

/**
 * Every reference names a node of the kind its field needs, live or retired:
 * a reference to a tombstone is history, not dangling. touches, a modified or
 * removed amendment's target and appliesTo name product nodes; dependsOn
 * names a capability; blockedBy names a change-layer node; an added
 * amendment's `under` names a node that can hold the added type ({@link HOLDER}).
 * An added amendment's target does not exist until apply, so it is not
 * checked. Its `under` may name a node the same change adds: in an unapplied
 * change only when the additions form a tree ({@link sameChangeTree}).
 */
const refResolves: Rule = (_index, _options, { entries, resolve }) => {
  const parentOf = new Map(entries.map((e) => [e.node, e.parent]));
  const placeOf = (target: RuleNode): Place => ({ type: target.type, parentType: parentOf.get(target)?.type });
  return entries.flatMap(({ node, retired }) => {
    if (retired) return [];
    const findings: RuleFinding[] = [];
    const refs: [field: string, ref: string, destination: Destination][] = (node.blockedBy ?? []).map((ref) => ["blockedBy", ref, CHANGE_NODE]);
    if (node.type === "change") {
      const added = new Map<string, AddedAmendment>();
      const duplicated = new Set<string>();
      for (const a of node.amends ?? []) {
        if (a.delta !== "added") continue;
        if (!added.has(a.target)) added.set(a.target, a as AddedAmendment);
        else if (!duplicated.has(a.target)) {
          duplicated.add(a.target);
          findings.push(finding("ref-resolves", node, `change "${node.title}" adds "${a.target}" more than once; the first addition stands and the rest are ignored`));
        }
      }
      const tree = isAppliedChange(node) ? undefined : sameChangeTree(node, added);
      if (tree) findings.push(...tree.findings);
      /** A same-change parent's place: its added type, under its own `under`. */
      const addedPlace = (holder: AddedAmendment): Place => {
        if (holder.under === undefined) return { type: holder.type ?? "capability" };
        const above = added.get(holder.under);
        return { type: holder.type ?? "capability", parentType: above ? (above.type ?? "capability") : resolve(holder.under)?.type };
      };
      for (const ref of node.touches ?? []) refs.push(["touches", ref, PRODUCT_NODE]);
      for (const a of node.amends ?? []) {
        if (a.delta !== "added") {
          refs.push([`${a.delta} amendment target`, a.target, PRODUCT_NODE]);
          continue;
        }
        if (a.under === undefined) continue;
        const holder = added.get(a.under);
        const destination = HOLDER[a.type ?? "capability"];
        if (!holder) refs.push(["added amendment under", a.under, destination]);
        else if (tree?.placed.has(a as AddedAmendment) && !destination.holds(addedPlace(holder))) {
          findings.push(finding("ref-resolves", node, `change "${node.title}" added amendment under "${a.under}" names ${describePlace(addedPlace(holder))} the same change adds, not ${destination.wanted}`));
        }
      }
    }
    if (node.type === "capability") for (const ref of node.dependsOn ?? []) refs.push(["dependsOn", ref, CAPABILITY]);
    if (node.type === "constraint" && Array.isArray(node.appliesTo)) for (const ref of node.appliesTo) refs.push(["appliesTo", ref, PRODUCT_NODE]);
    for (const [field, ref, destination] of refs) {
      const target = resolve(ref);
      if (!target) findings.push(finding("ref-resolves", node, `${node.type} "${node.title}" ${field} "${ref}" names no node`));
      else if (!destination.holds(placeOf(target))) {
        findings.push(finding("ref-resolves", node, `${node.type} "${node.title}" ${field} "${ref}" names ${describePlace(placeOf(target))} "${target.title}", not ${destination.wanted}`));
      }
    }
    return findings;
  });
};

const titleReleaseTokenRule: Rule = ({ entries }, { releases }) =>
  entries.flatMap(({ node }) => {
    const token = titleReleaseToken(node.title, releases);
    return token
      ? [finding("title-release-token", node, `Title "${node.title}" names "${token}"; use plannedRelease, shippedIn or prs instead`)]
      : [];
  });

const layerNesting: Rule = ({ entries }) =>
  entries.flatMap(({ node, parent, root }) => {
    const expected = parent ? layerOf(parent.type) : root;
    if (layerOf(node.type) === expected) return [];
    const where = parent ? `${parent.type} "${parent.title}"` : `the ${root} root`;
    return [finding("layer-nesting", node, `${node.type} "${node.title}" sits under ${where}; nodes never nest across the product and change layers`)];
  });

const capabilityDepth: Rule = ({ entries }) => {
  const parentOf = new Map(entries.map((e) => [e.node, e.parent]));
  return entries.flatMap(({ node, parent }) => {
    if (node.type !== "capability" || parent?.type !== "capability") return [];
    if (parentOf.get(parent)?.type !== "capability") return [];
    return [finding("capability-depth", node, `Capability "${node.title}" is nested two levels deep; capabilities nest at most one level`)];
  });
};

const dependsOnAcyclic: Rule = ({ entries, resolve }) => {
  const capabilities = entries.map((e) => e.node).filter((n) => n.type === "capability");
  const edges = (node: RuleNode): RuleNode[] =>
    node.type === "capability"
      ? (node.dependsOn ?? []).map(resolve).filter((n): n is RuleNode => n?.type === "capability")
      : [];
  const state = new Map<RuleNode, "open" | "done">();
  const stack: RuleNode[] = [];
  const seen = new Set<string>();
  const findings: RuleFinding[] = [];
  const visit = (node: RuleNode): void => {
    state.set(node, "open");
    stack.push(node);
    for (const next of edges(node)) {
      if (state.get(next) === "open") {
        const cycle = stack.slice(stack.indexOf(next));
        const key = cycle.map((n) => n.id).sort().join(" ");
        if (!seen.has(key)) {
          seen.add(key);
          const path = [...cycle, next].map((n) => `"${n.title}"`).join(" → ");
          findings.push(finding("depends-on-acyclic", next, `dependsOn cycle: ${path}`));
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, "done");
  };
  for (const node of capabilities) if (!state.has(node)) visit(node);
  return findings;
};

/**
 * An open change refers only to live product nodes: its touches, its modified
 * and removed targets, and where an added amendment goes (`under`, unless it
 * names a node the same change adds). A plan against a retired node cannot be
 * realized; a reference to one is history only for an applied change. A
 * reference that names no node, or a change-layer node, is `ref-resolves`'s;
 * this rule reports a retired product node.
 */
const removedTargetLive: Rule = ({ entries, resolve }, _options, withTombstones) =>
  entries
    .filter(({ node }) => isOpenChange(node))
    .flatMap(({ node }) => {
      const amends = node.type === "change" ? (node.amends ?? []) : [];
      const added = new Set(amends.filter((a) => a.delta === "added").map((a) => a.target));
      const refs: [field: string, ref: string][] = [
        ...(node.type === "change" ? (node.touches ?? []) : []).map((ref): [string, string] => ["touches", ref]),
        ...amends.flatMap((a): [string, string][] =>
          a.delta !== "added"
            ? [[`${a.delta} amendment target`, a.target]]
            : a.under !== undefined && !added.has(a.under)
              ? [["added amendment under", a.under]]
              : [],
        ),
      ];
      return refs
        .filter(([, ref]) => {
          if (resolve(ref)) return false;
          const retired = withTombstones.resolve(ref);
          return !!retired && layerOf(retired.type) === "product";
        })
        .map(([field, ref]) =>
          finding("removed-target-live", node, `Change "${node.title}" ${field} "${ref}" names a retired node; an open change cannot plan against one`),
        );
    });

const capabilityStatement: Rule = ({ entries }) =>
  entries
    .filter(({ node }) => node.type === "capability" && !node.statement?.trim())
    .map(({ node }) => finding("capability-statement", node, `Capability "${node.title}" has no statement`));

const capabilityCriteria: Rule = ({ entries }) =>
  entries
    .filter(({ node }) => node.type === "capability" && !node.criteria?.length)
    .map(({ node }) => finding("capability-criteria", node, `Capability "${node.title}" has no criteria`));

/** A node keeps one result per requirement: the last run's. */
const checkUnique: Rule = ({ entries }) =>
  entries.flatMap(({ node }) => {
    const counts = new Map<string, number>();
    for (const c of node.checks ?? []) counts.set(c.requirementId, (counts.get(c.requirementId) ?? 0) + 1);
    return [...counts]
      .filter(([, count]) => count > 1)
      .map(([id, count]) => finding("check-unique", node, `${node.type} "${node.title}" holds ${count} check results for requirement "${id}"; keep only the last`));
  });

/** A check result for a requirement the node no longer has. */
const checkRequirement: Rule = ({ entries }) =>
  entries.flatMap(({ node }) => {
    const requirements = node.type === "area" || node.type === "subtask" ? [] : (node.requirements ?? []);
    const current = new Set(requirements.map((r) => r.id));
    const stale = new Set((node.checks ?? []).map((c) => c.requirementId).filter((id) => !current.has(id)));
    return [...stale].map((id) =>
      finding("check-requirement", node, `${node.type} "${node.title}" holds a check result for "${id}", which is not one of its requirements`),
    );
  });

const DAY_MS = 86_400_000;

/**
 * A product node is revised when its spec no longer hashes to `metAt` and no open
 * change amends it (an amended one is "changing" instead). A node never met
 * (`metAt` absent) is proposed, not revised. Age is measured from
 * `revisedAt`, which the state writer stamps when a spec edit first makes the
 * hash differ from `metAt` and clears whenever the hash equals `metAt` again
 * (see `ItemState.revisedAt`). It is not measured from `lastModified`, because
 * every state write (checks, reviewedHash) re-stamps that. Without
 * `revisedAt` the age is unknown and nothing is reported.
 */
const longRevised: Rule = ({ entries, resolve }, { now, longRevisedDays = DEFAULT_LONG_REVISED_DAYS }) => {
  const amended = new Set<RuleNode>();
  for (const { node } of entries) {
    if (node.type !== "change" || !isOpenChange(node)) continue;
    for (const a of node.amends ?? []) {
      const target = resolve(a.target);
      if (target) amended.add(target);
    }
  }
  return entries.flatMap(({ node }) => {
    if (node.type !== "capability" && node.type !== "constraint") return [];
    if (!node.metAt || amended.has(node)) return [];
    if (specHash(nodeSpec(node)) === node.metAt) return [];
    const revised = node.revisedAt ? Date.parse(node.revisedAt) : Number.NaN;
    if (Number.isNaN(revised)) return [];
    const days = Math.floor((now.getTime() - revised) / DAY_MS);
    if (days <= longRevisedDays) return [];
    return [finding("long-revised", node, `${node.type} "${node.title}" has been revised for ${days} days with no change open; draft one or re-stamp it`)];
  });
};

const areaBalance: Rule = ({ entries }) => {
  const nearestArea = new Map<RuleNode, RuleNode | undefined>();
  const counts = new Map<RuleNode, number>();
  for (const { node, parent } of entries) {
    const area = parent?.type === "area" ? parent : parent ? nearestArea.get(parent) : undefined;
    nearestArea.set(node, area);
    if (node.type === "area") counts.set(node, 0);
    else if (node.type === "capability" && area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // With two areas or fewer, one of them always holds over 40 percent.
  const checkShare = counts.size > 2 && total > 0;
  return [...counts].flatMap(([area, count]) => {
    if (count < AREA_MIN_CAPABILITIES) {
      return [finding("area-balance", area, `Area "${area.title}" holds ${count} capabilit${count === 1 ? "y" : "ies"}; fold it into a neighbour or grow it`)];
    }
    if (checkShare && count / total > AREA_MAX_SHARE) {
      const pct = Math.round((count / total) * 100);
      return [finding("area-balance", area, `Area "${area.title}" holds ${pct} percent of all capabilities; consider splitting it`)];
    }
    return [];
  });
};

/** A product node is reviewed while `reviewedHash` equals its current spec hash. */
const unreviewedSpec: Rule = ({ entries }) =>
  entries
    .filter(({ node }) => (node.type === "capability" || node.type === "constraint") && node.reviewedHash !== specHash(nodeSpec(node)))
    .map(({ node }) => finding("unreviewed-spec", node, `${node.type} "${node.title}" has a spec no person has reviewed`));

/**
 * A saved `run` block that `ndx work` ignores: invalid by `validateRunSettings`
 * (malformed, or holding a newer version's key), or carried by a node other
 * than a change or task. A warning, never an error: the schema keeps `run`
 * loose so one bad block cannot refuse writes to the rest of the tree.
 */
const runSettings: Rule = ({ entries }) =>
  entries.flatMap(({ node }) => {
    if (node.run === undefined) return [];
    if (node.type !== "change" && node.type !== "task") {
      return [finding("run-settings", node, `${node.type} "${node.title}" carries a run block; only changes and tasks hold saved run settings`)];
    }
    const check = validateRunSettings(node.run);
    if (check.ok) return [];
    return [finding("run-settings", node, `Invalid ${check.error} on ${node.type} "${node.title}"; ndx work ignores this block until it is fixed`)];
  });

/**
 * A state key the schema retired (`RETIRED_STATE_FIELDS`) still on a node. The
 * file loads and keeps the key, but nothing reads it; the warning says why.
 */
const retiredStateField: Rule = ({ entries }) =>
  entries.flatMap(({ node }) =>
    Object.entries(RETIRED_STATE_FIELDS)
      .filter(([key]) => node[key] !== undefined)
      .map(([key, reason]) =>
        finding("retired-state-field", node, `${node.type} "${node.title}" still carries "${key}", which is ignored: ${reason}`),
      ),
  );

/** Every rule, errors first, in the order findings are reported. */
const RULES: Readonly<Record<V2RuleId, Rule>> = {
  "change-has-target": changeHasTarget,
  "change-placed-at-close": changePlacedAtClose,
  "fix-not-spike": fixNotSpike,
  "amendment-type": amendmentType,
  "ref-unique": refUnique,
  "ref-resolves": refResolves,
  "title-release-token": titleReleaseTokenRule,
  "layer-nesting": layerNesting,
  "capability-depth": capabilityDepth,
  "depends-on-acyclic": dependsOnAcyclic,
  "removed-target-live": removedTargetLive,
  "capability-statement": capabilityStatement,
  "check-unique": checkUnique,
  "capability-criteria": capabilityCriteria,
  "long-revised": longRevised,
  "area-balance": areaBalance,
  "unreviewed-spec": unreviewedSpec,
  "run-settings": runSettings,
  "retired-state-field": retiredStateField,
  "check-requirement": checkRequirement,
};

export const V2_RULE_IDS = Object.keys(RULES) as V2RuleId[];

/** Run every rule (or the named subset) over a tree. */
export function checkV2Rules(tree: V2Tree, options: RuleOptions, only: ReadonlyArray<V2RuleId> = V2_RULE_IDS): RuleFinding[] {
  const index = indexTree(tree);
  const withTombstones = indexTree(tree, { includeTombstones: true });
  return V2_RULE_IDS.filter((id) => only.includes(id)).flatMap((id) => RULES[id](index, options, withTombstones));
}
