/**
 * The Place packet: one change awaiting placement, with the rules' shortlist
 * for it, read from the same builder `GET /api/rex/changes/:id/placement`
 * answers with (`buildChangePlacement`), never a copy of it.
 *
 * Rex ranks the candidates, sets the relation and names the open changes that
 * already amend each candidate; this module only renders them. The agent acts
 * as the text tier: it recommends one target and relation, drafts the
 * amendment, or proposes a new node, and raises a `place_change_card`.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §5 Place (Q8).
 */

import { ChangePlacementError, indexTree, type V2Tree } from "../rex-gateway.js";
import { buildChangePlacement, type ChangePlacementWire, type PlacementCandidateWire } from "../routes-rex/placement.js";
import { PLACE_INSTRUCTIONS } from "./lens-instructions.js";
import { assemblePacket, type Packet, type PacketSection } from "./packet.js";
import type { PacketSources } from "./packet-sources.js";
import type { PacketTarget } from "./packet-builders.js";

export const PLACE_CAP = 6_000;

/** What the shortlist section names as its source: the route whose builder made it. */
const SHORTLIST_SOURCE = "rex suggestPlacement via GET /api/rex/changes/:id/placement";
const PRD_SOURCE = ".rex/ (live read)";

function section(id: string, title: string, body: string, source: string, now: string): PacketSection {
  return { id, title, body, provenance: { source, generatedAt: now }, staleness: { state: "fresh" } };
}

function gap(id: string, title: string, why: string, source: string, now: string): PacketSection {
  return { id, title, body: `Not available: ${why}`, provenance: { source, generatedAt: now }, staleness: { state: "unknown", reason: why } };
}

function changeBody(placement: ChangePlacementWire): string {
  const { change } = placement;
  return [
    `Change ${change.id}: ${change.title}`,
    `Status: ${change.status} · ${change.taskCount} ${change.taskCount === 1 ? "task" : "tasks"}`,
    `Tags: ${change.tags?.length ? change.tags.join(", ") : "none"}`,
    "Intent:",
    change.intent?.trim() || "(none written)",
  ].join("\n");
}

function relationBody(placement: ChangePlacementWire): string {
  return [
    `Default relation: ${placement.relation}`,
    `Set by: ${placement.relationRule}`,
    "Rules set the relation; you choose the target. Say so if you argue for the other relation.",
  ].join("\n");
}

function candidateLine(c: PlacementCandidateWire, i: number): string {
  const where = c.area ? ` · area ${c.area}` : "";
  const reasons = c.reasons.length ? c.reasons.join("; ") : "no reason recorded";
  return `${i + 1}. ${c.title} (${c.target}, ${c.type}${where}): score ${c.score}, ${c.strength}. Reasons: ${reasons}`;
}

function shortlistBody(placement: ChangePlacementWire): string {
  const { shortlist } = placement;
  if (shortlist.length === 0) {
    return "No rule fired: nothing on the product map matches this change. Propose a new capability or constraint under an area (see Areas).";
  }
  const lines = shortlist.map(candidateLine);
  if (placement.tied) lines.push("Tied: the top two share a score, so their order is the id tiebreak, not the rules. Choose between them on the statements.");
  else if (shortlist[0]!.strength !== "strong") lines.push(`No strong pick: the leader is ${shortlist[0]!.strength}. Weigh a new capability or constraint too.`);
  return lines.join("\n");
}

function candidatesBody(placement: ChangePlacementWire): string {
  if (placement.shortlist.length === 0) return "No candidates.";
  return placement.shortlist.map((c) => {
    const criteria = c.type === "constraint"
      ? ["  (a constraint has no capability criteria)"]
      : c.criteria.length
        ? c.criteria.map((k) => `  - ${k.id}: ${k.text}`)
        : ["  (no capability criteria)"];
    return [`${c.title} (${c.target})`, `  Statement: ${c.statement?.trim() || "(none)"}`, "  Capability criteria:", ...criteria].join("\n");
  }).join("\n");
}

function blockersBody(placement: ChangePlacementWire): string {
  const blocked = placement.shortlist.filter((c) => c.amendedBy?.length);
  if (blocked.length === 0) return "None: no other open change amends a candidate.";
  return [
    ...blocked.map((c) => `- ${c.title} (${c.target}): amended by open change ${c.amendedBy!.join(", ")}`),
    "Whichever applies first moves that spec, and apply then refuses an amends placement made here against the old one. A touches placement is not affected.",
  ].join("\n");
}

/** Every live area, for a proposal's `under`. */
function areasBody(tree: V2Tree): string {
  const areas = indexTree(tree).entries.filter((e) => e.root === "product" && e.node.type === "area").map((e) => `- ${e.node.id}: ${e.node.title}`);
  return areas.length ? areas.join("\n") : "No live area: a new node has nowhere to go until one exists.";
}

/**
 * The Place lens packet for the change `target.ref`. Sections run in order of
 * importance, so the areas list is trimmed first and the change never is.
 */
export async function buildPlacePacket(sources: PacketSources, target: PacketTarget, now: string): Promise<Packet> {
  const header = [
    `# Sidecar context packet: place${target.ref ? ` · ${target.ref}` : ""}`,
    "Built by code from the repository's own records. No model wrote it.",
    "",
    PLACE_INSTRUCTIONS,
  ].join("\n");
  const done = (sections: PacketSection[]): Packet => assemblePacket({ lens: "place", cap: PLACE_CAP, header, sections });
  if (!target.ref) return done([gap("change", "Change", "Place needs a change awaiting placement attached", PRD_SOURCE, now)]);
  const prd = await sources.prd();
  if (!prd) return done([gap("change", "Change", "the PRD could not be read", PRD_SOURCE, now)]);
  if (prd.layout !== "v2") return done([gap("change", "Change", "placement needs a v2 PRD; this one uses the v1 layout", PRD_SOURCE, now)]);

  let placement: ChangePlacementWire;
  try {
    placement = buildChangePlacement(prd.tree, target.ref);
  } catch (err) {
    if (err instanceof ChangePlacementError) return done([gap("change", "Change", err.plain, SHORTLIST_SOURCE, now)]);
    throw err;
  }
  return done([
    section("change", "Change", changeBody(placement), PRD_SOURCE, now),
    section("relation", "Relation default", relationBody(placement), "rex placementRelation (rules)", now),
    section("shortlist", `Rules shortlist (top ${placement.shortlist.length})`, shortlistBody(placement), SHORTLIST_SOURCE, now),
    section("blockers", "Open changes that would block apply", blockersBody(placement), "rex suggestPlacement (open changes amending each candidate)", now),
    section("candidates", "Candidates' statements and capability criteria", candidatesBody(placement), PRD_SOURCE, now),
    section("areas", "Areas (for a proposal's under)", areasBody(prd.tree), PRD_SOURCE, now),
  ]);
}
