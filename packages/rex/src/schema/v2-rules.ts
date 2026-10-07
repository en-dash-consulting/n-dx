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
 * not part of the product layer or the plan.
 *
 * @module rex/schema/v2-rules
 */

import { createHash } from "node:crypto";
import type { ItemStatus } from "./v1.js";
import { layerOf, type Criterion, type Layer, type V2Node } from "./v2.js";

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
  | "title-release-token"
  | "layer-nesting"
  | "capability-depth"
  | "depends-on-acyclic"
  | "removed-target-live"
  | "capability-statement"
  | "capability-criteria"
  | "long-revised"
  | "area-balance"
  | "unreviewed-spec";

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

interface Entry {
  node: RuleNode;
  parent?: RuleNode;
  /** The layer root the node was loaded under. */
  root: Layer;
}

interface TreeIndex {
  /** Every non-deleted node, depth first, product layer first. */
  entries: Entry[];
  /** Resolves an id, display id or alias to its node. */
  resolve(ref: string): RuleNode | undefined;
}

function isDeleted(node: RuleNode): boolean {
  return node.status === "deleted";
}

function indexTree(tree: V2Tree): TreeIndex {
  const entries: Entry[] = [];
  const byRef = new Map<string, RuleNode>();
  const visit = (node: RuleNode, parent: RuleNode | undefined, root: Layer): void => {
    if (isDeleted(node)) return;
    entries.push({ node, parent, root });
    for (const ref of [node.id, node.displayId, ...(node.aliases ?? [])]) {
      if (ref && !byRef.has(ref)) byRef.set(ref, node);
    }
    for (const child of node.children ?? []) visit(child, node, root);
  };
  for (const node of tree.product) visit(node, undefined, "product");
  for (const node of tree.changes) visit(node, undefined, "changes");
  return { entries, resolve: (ref) => byRef.get(ref) };
}

/** Each rule's fixed severity. */
export const RULE_SEVERITY: Readonly<Record<V2RuleId, RuleSeverity>> = {
  "change-has-target": "error",
  "title-release-token": "error",
  "layer-nesting": "error",
  "capability-depth": "error",
  "depends-on-acyclic": "error",
  "removed-target-live": "error",
  "capability-statement": "error",
  "capability-criteria": "warning",
  "long-revised": "warning",
  "area-balance": "warning",
  "unreviewed-spec": "warning",
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

// ── Rules ────────────────────────────────────────────────────────

type Rule = (index: TreeIndex, options: RuleOptions) => RuleFinding[];

const changeHasTarget: Rule = ({ entries }) =>
  entries.flatMap(({ node }) => {
    if (node.type !== "change" || node.spike || node.amends?.length || node.touches?.length) return [];
    return [finding("change-has-target", node, `Change "${node.title}" neither amends nor touches a product node; mark it a spike or name its target`)];
  });

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

/** Statuses after which a change no longer acts on the product layer. */
const CLOSED_CHANGE_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["completed", "cancelled", "deleted"]);

function isOpenChange(node: RuleNode): boolean {
  return node.type === "change" && !node.appliedIn && !CLOSED_CHANGE_STATUSES.has(node.status ?? "pending");
}

const removedTargetLive: Rule = ({ entries, resolve }) =>
  entries
    .filter(({ node }) => isOpenChange(node))
    .flatMap(({ node }) =>
      (node.type === "change" ? (node.amends ?? []) : [])
        .filter((a) => a.delta === "removed")
        .filter((a) => {
          const target = resolve(a.target);
          return !target || layerOf(target.type) !== "product";
        })
        .map((a) =>
          finding("removed-target-live", node, `Change "${node.title}" removes "${a.target}", which is not a live product node`),
        ),
    );

const capabilityStatement: Rule = ({ entries }) =>
  entries
    .filter(({ node }) => node.type === "capability" && !node.statement?.trim())
    .map(({ node }) => finding("capability-statement", node, `Capability "${node.title}" has no statement`));

const capabilityCriteria: Rule = ({ entries }) =>
  entries
    .filter(({ node }) => node.type === "capability" && !node.criteria?.length)
    .map(({ node }) => finding("capability-criteria", node, `Capability "${node.title}" has no criteria`));

const DAY_MS = 86_400_000;

/**
 * A product node is revised when its spec no longer hashes to `metAt` and no open
 * change amends it (an amended one is "changing" instead). A node never met
 * (`metAt` absent) is proposed, not revised. Age is measured from
 * `revisedAt`, which the state writer stamps when a spec edit first makes the
 * hash differ from `metAt` and clears whenever the hash equals `metAt` again
 * (see `ItemState.revisedAt`). It is not measured from `lastModified`, because
 * every state write (checks, specReviewed) re-stamps that. Without
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
    if (specHash(node.type === "capability" ? node : { statement: node.statement }) === node.metAt) return [];
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

const unreviewedSpec: Rule = ({ entries }) =>
  entries
    .filter(({ node }) => (node.type === "capability" || node.type === "constraint") && node.specReviewed !== true)
    .map(({ node }) => finding("unreviewed-spec", node, `${node.type} "${node.title}" has a spec no person has reviewed`));

/** Every rule, errors first, in the order findings are reported. */
const RULES: Readonly<Record<V2RuleId, Rule>> = {
  "change-has-target": changeHasTarget,
  "title-release-token": titleReleaseTokenRule,
  "layer-nesting": layerNesting,
  "capability-depth": capabilityDepth,
  "depends-on-acyclic": dependsOnAcyclic,
  "removed-target-live": removedTargetLive,
  "capability-statement": capabilityStatement,
  "capability-criteria": capabilityCriteria,
  "long-revised": longRevised,
  "area-balance": areaBalance,
  "unreviewed-spec": unreviewedSpec,
};

export const V2_RULE_IDS = Object.keys(RULES) as V2RuleId[];

/** Run every rule (or the named subset) over a tree. */
export function checkV2Rules(tree: V2Tree, options: RuleOptions, only: ReadonlyArray<V2RuleId> = V2_RULE_IDS): RuleFinding[] {
  const index = indexTree(tree);
  return V2_RULE_IDS.filter((id) => only.includes(id)).flatMap((id) => RULES[id](index, options));
}
