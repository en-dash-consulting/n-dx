/**
 * Which packet each Sidecar lens opens a turn with.
 *
 * Seven lenses have a builder today. General sends no packet. The rest need a
 * data source that does not exist yet, so they register as unavailable and
 * name it: a lens never sends a partial packet in place of the real one, and
 * the drawer can say why it is greyed out. When a source lands, its lens
 * changes from `unavailable` to `packet` here and nowhere else.
 *
 * A lens that only means something about one kind of item names it as its
 * `target`: with no item attached, the lens is unavailable and names what it
 * needs attached, rather than building a packet about nothing.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3.
 */

import type { Packet } from "./packet.js";
import {
  buildDescribePacket,
  buildDiagnoseRunPacket,
  buildExplainPacket,
  buildGuidePacket,
  buildPlanPacket,
  DESCRIBE_CAP,
  DIAGNOSE_RUN_CAP,
  EXPLAIN_CAP,
  GUIDE_CAP,
  PLAN_CAP,
  type PacketTarget,
} from "./packet-builders.js";
import type { PacketSources } from "./packet-sources.js";
import { buildDiagnoseBranchPacket, DIAGNOSE_BRANCH_CAP } from "./branch-packet.js";
import { buildPlacePacket, PLACE_CAP } from "./place-packet.js";

export const LENS_IDS = [
  "general",
  "explain",
  "describe",
  "plan",
  "guide",
  "diagnose-run",
  "diagnose-branch",
  "place",
  "migrate",
  "hub",
] as const;
export type LensId = (typeof LENS_IDS)[number];

/** The item a lens must have attached: its kind as the drawer names it, and what to say when there is none. */
export interface LensTarget {
  kind: "task" | "worktree" | "change";
  needs: string;
}

export type LensPacketPlan =
  | { kind: "none" }
  | {
      kind: "packet";
      cap: number;
      build: (sources: PacketSources, target: PacketTarget, now: string, signal?: AbortSignal) => Promise<Packet>;
      target?: LensTarget;
      /** A dashboard feature the lens needs on: while it is off the lens is unavailable and nothing is read. */
      feature?: LensFeature;
      /** The PRD layout the lens needs: on any other the lens is unavailable, naming it. */
      layout?: LensLayout;
    }
  | { kind: "unavailable"; needs: string };

/** A PRD layout a lens depends on, and what to say on another one. */
export interface LensLayout {
  layout: "v2";
  needs: string;
}

/** The feature toggle a lens depends on (the registry key in routes-features.ts) and what to say when it is off. */
export interface LensFeature {
  key: string;
  needs: string;
}

export const LENS_PACKETS: Readonly<Record<LensId, LensPacketPlan>> = {
  general: { kind: "none" },
  explain: { kind: "packet", cap: EXPLAIN_CAP, build: buildExplainPacket },
  describe: { kind: "packet", cap: DESCRIBE_CAP, build: buildDescribePacket },
  plan: { kind: "packet", cap: PLAN_CAP, build: buildPlanPacket },
  // The target is the ready list as a whole: Live attaches it, and no ref is needed.
  guide: {
    kind: "packet",
    cap: GUIDE_CAP,
    build: buildGuidePacket,
    feature: { key: "hench.readyNext", needs: "the hench.readyNext feature turned on" },
  },
  "diagnose-run": {
    kind: "packet",
    cap: DIAGNOSE_RUN_CAP,
    build: buildDiagnoseRunPacket,
    target: { kind: "task", needs: "a task to diagnose" },
  },
  "diagnose-branch": {
    kind: "packet",
    cap: DIAGNOSE_BRANCH_CAP,
    build: buildDiagnoseBranchPacket,
    // A Workspaces worktree card attaches it; its ref is the workspace key.
    target: { kind: "worktree", needs: "a branch or worktree" },
    feature: { key: "git.branchHealth", needs: "the git.branchHealth feature turned on" },
  },
  place: {
    kind: "packet",
    cap: PLACE_CAP,
    build: buildPlacePacket,
    // Plan › Inbox and a change's "Needs placement" tag attach it; its ref is the change id.
    target: { kind: "change", needs: "a change awaiting placement" },
    layout: { layout: "v2", needs: "a v2 PRD" },
  },
  migrate: { kind: "unavailable", needs: "the migration plan reads" },
  hub: { kind: "unavailable", needs: "the hub snapshot" },
};

export type LensPacketResult =
  | { status: "none"; lens: LensId }
  | { status: "unavailable"; lens: string; needs: string }
  | { status: "ready"; lens: LensId; packet: Packet };

export function isLensId(value: string): value is LensId {
  return (LENS_IDS as readonly string[]).includes(value);
}

/**
 * The packet `lens` opens a turn with, `none` for a lens that sends none, or
 * `unavailable` naming the missing source. A lens id this build does not know
 * is unavailable too: it is never answered with another lens's packet.
 */
export async function buildLensPacket(
  lens: string,
  target: PacketTarget,
  sources: PacketSources,
  now: string,
  signal?: AbortSignal,
): Promise<LensPacketResult> {
  if (!isLensId(lens)) return { status: "unavailable", lens, needs: "a lens this build knows" };
  const plan = LENS_PACKETS[lens];
  if (plan.kind === "none") return { status: "none", lens };
  if (plan.kind === "unavailable") return { status: "unavailable", lens, needs: plan.needs };
  if (plan.feature && !sources.featureEnabled(plan.feature.key)) return { status: "unavailable", lens, needs: plan.feature.needs };
  if (plan.layout && (await sources.prd())?.layout !== plan.layout.layout) return { status: "unavailable", lens, needs: plan.layout.needs };
  if (plan.target && !target.ref) return { status: "unavailable", lens, needs: plan.target.needs };
  return { status: "ready", lens, packet: await plan.build(sources, target, now, signal) };
}
