/**
 * Which packet each Sidecar lens opens a turn with.
 *
 * Three lenses have a builder today. General sends no packet. The rest need a
 * data source that does not exist yet, so they register as unavailable and
 * name it: a lens never sends a partial packet in place of the real one, and
 * the drawer can say why it is greyed out. When a source lands, its lens
 * changes from `unavailable` to `packet` here and nowhere else.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3.
 */

import type { Packet } from "./packet.js";
import {
  buildDescribePacket,
  buildExplainPacket,
  buildPlanPacket,
  DESCRIBE_CAP,
  EXPLAIN_CAP,
  PLAN_CAP,
  type PacketTarget,
} from "./packet-builders.js";
import type { PacketSources } from "./packet-sources.js";

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

export type LensPacketPlan =
  | { kind: "none" }
  | { kind: "packet"; cap: number; build: (sources: PacketSources, target: PacketTarget, now: string) => Promise<Packet> }
  | { kind: "unavailable"; needs: string };

export const LENS_PACKETS: Readonly<Record<LensId, LensPacketPlan>> = {
  general: { kind: "none" },
  explain: { kind: "packet", cap: EXPLAIN_CAP, build: buildExplainPacket },
  describe: { kind: "packet", cap: DESCRIBE_CAP, build: buildDescribePacket },
  plan: { kind: "packet", cap: PLAN_CAP, build: buildPlanPacket },
  guide: { kind: "unavailable", needs: "the queue planner" },
  "diagnose-run": { kind: "unavailable", needs: "the run classifier" },
  "diagnose-branch": { kind: "unavailable", needs: "the branch status collector" },
  place: { kind: "unavailable", needs: "the Inbox list read" },
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
): Promise<LensPacketResult> {
  if (!isLensId(lens)) return { status: "unavailable", lens, needs: "a lens this build knows" };
  const plan = LENS_PACKETS[lens];
  if (plan.kind === "none") return { status: "none", lens };
  if (plan.kind === "unavailable") return { status: "unavailable", lens, needs: plan.needs };
  return { status: "ready", lens, packet: await plan.build(sources, target, now) };
}
