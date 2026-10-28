/**
 * The Explain, Describe and Plan packet builders.
 *
 * Each reads through a {@link PacketSources}, renders plain text sections in
 * order of importance (the cap trims from the end, see `packet.ts`) and makes
 * no LLM call. On a v2 tree the facts come from rex's own reports
 * (`capabilityReport`, `productReport`): status and health are rex's derived
 * values, never recomputed here. On a v1 tree an epic or feature stands where
 * a capability would.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3.
 */

import { capabilityReport, indexTree, isAppliedChange, productReport } from "../rex-gateway.js";
import type { RuleNode, V2Tree } from "../rex-gateway.js";
import { assemblePacket, type Packet, type PacketSection, type Staleness } from "./packet.js";
import type { PacketSources, PrdRead } from "./packet-sources.js";

export const EXPLAIN_CAP = 8_000;
export const DESCRIBE_CAP = 8_000;
export const PLAN_CAP = 10_000;

/** What the operator pointed the lens at: an item id, display id or alias. Plan may have none. */
export interface PacketTarget {
  ref?: string;
}

const FRESH: Staleness = { state: "fresh" };
const PRD_SOURCE = ".rex/ (live read)";

// ── Small helpers ────────────────────────────────────────────────────

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

function oneLine(value: string, max = 200): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function label(node: RuleNode): string {
  return node.displayId ? `${node.displayId} ${node.title}` : node.title;
}

/** `epic` or `feature` on a v1 tree, which reads both as changes; the node type otherwise. */
function kindOf(node: RuleNode): string {
  return typeof node.level === "string" ? node.level : node.type;
}

function nodeStatus(node: RuleNode): string {
  return typeof node.status === "string" ? node.status : "pending";
}

interface Found {
  node: RuleNode;
  /** Ancestors, root first. */
  chain: RuleNode[];
  /** The siblings under the same parent (or root list), the node included. */
  siblings: RuleNode[];
}

function findNode(roots: RuleNode[], ref: string): Found | null {
  const walk = (nodes: RuleNode[], chain: RuleNode[]): Found | null => {
    for (const node of nodes) {
      if (node.id === ref || node.displayId === ref) return { node, chain, siblings: nodes };
      const inner = walk(node.children ?? [], [...chain, node]);
      if (inner) return inner;
    }
    return null;
  };
  return walk(roots, []);
}

/** Ids of `node` and everything below it, bounded: evidence reads a sample, not a census. */
function subtreeIds(node: RuleNode, limit = 200): string[] {
  const out: string[] = [];
  const visit = (n: RuleNode): void => {
    if (out.length >= limit) return;
    out.push(n.id);
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

function gap(id: string, title: string, why: string, now: string, source: string): PacketSection {
  return {
    id,
    title,
    body: `Not available: ${why}`,
    provenance: { source, generatedAt: now },
    staleness: { state: "unknown", reason: why },
  };
}

function header(lens: string, target: PacketTarget): string {
  return `# Sidecar context packet: ${lens}${target.ref ? ` · ${target.ref}` : ""}\nBuilt by code from the repository's own records. No model wrote it.`;
}

function bullets(lines: string[], none: string): string {
  return lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : none;
}

function prdSection(id: string, title: string, body: string, now: string): PacketSection {
  return { id, title, body, provenance: { source: PRD_SOURCE, generatedAt: now }, staleness: FRESH };
}

async function noPrd(lens: string, cap: number, target: PacketTarget, now: string, why: string): Promise<Packet> {
  return assemblePacket({ lens, cap, header: header(lens, target), sections: [gap("prd", "PRD", why, now, PRD_SOURCE)] });
}

// ── Evidence and zone sections (Explain) ─────────────────────────────

async function evidenceSections(sources: PacketSources, ids: string[], now: string): Promise<PacketSection[]> {
  const evidence = await sources.evidence(ids);
  const source = "git history, N-DX-Item trailers";
  if (!evidence) {
    return [
      gap("evidence", "Trailer-commit evidence", "no readable git history", now, source),
      gap("zones", "Sourcevision zones", "no commits to name the touched files", now, ".sourcevision/zones.json"),
    ];
  }
  const commits = evidence.commits;
  const evidenceSection: PacketSection = {
    id: "evidence",
    title: "Trailer-commit evidence",
    body: bullets(
      commits.map((c) => `${c.hash.slice(0, 9)} ${c.timestamp.slice(0, 10)} ${oneLine(c.subject, 120)} (${c.files.length} file${c.files.length === 1 ? "" : "s"})`),
      "No commit names these items in an N-DX-Item trailer.",
    ),
    provenance: { source, generatedAt: now },
    staleness: FRESH,
  };

  const files = [...new Set(commits.flatMap((c) => c.files))].sort();
  const zones = files.length > 0 ? await sources.zones(files) : null;
  const zoneSource = ".sourcevision/zones.json";
  if (files.length === 0) {
    return [evidenceSection, gap("zones", "Sourcevision zones", "no touched files to place in a zone", now, zoneSource)];
  }
  if (!zones) {
    return [evidenceSection, gap("zones", "Sourcevision zones", "no sourcevision analysis (run `ndx analyze`)", now, zoneSource)];
  }
  const newest = commits.reduce((max, c) => (c.timestamp > max ? c.timestamp : max), "");
  const staleness: Staleness = zones.analyzedAt < newest
    ? { state: "stale", reason: `analysis ${zones.analyzedAt.slice(0, 10)} predates the newest evidence commit ${newest.slice(0, 10)}` }
    : FRESH;
  const lines = zones.zones.map(
    (z) => `${z.id} (${z.name}): ${z.matched} of ${files.length} touched files; cohesion ${z.cohesion}, coupling ${z.coupling}. ${oneLine(z.description, 160)}`,
  );
  if (zones.unzoned > 0) lines.push(`${zones.unzoned} touched file(s) are in no zone.`);
  return [
    evidenceSection,
    {
      id: "zones",
      title: "Sourcevision zones for the touched files",
      body: bullets(lines, "No zone holds the touched files."),
      provenance: { source: zoneSource, generatedAt: zones.analyzedAt },
      staleness,
    },
  ];
}

// ── Explain ──────────────────────────────────────────────────────────

function v2CapabilitySections(tree: V2Tree, node: RuleNode, now: string): { sections: PacketSection[]; ids: string[] } {
  const report = capabilityReport(tree, node.id, { status: "all", limit: 10 });
  const criteria = (Array.isArray(node.criteria) ? node.criteria : []) as Array<{ id: string; text: string }>;
  const sections: PacketSection[] = [
    prdSection(
      "capability",
      "Capability",
      [
        `${label(node)}`,
        `Statement: ${text(node.statement) ?? "(none)"}`,
        "Criteria:",
        bullets(criteria.map((c) => `${c.id}: ${c.text}`), "(none)"),
      ].join("\n"),
      now,
    ),
    prdSection(
      "status",
      "Derived status and health",
      `status ${report.status.status}, health ${report.status.health} (rex's derivation, not stored)`,
      now,
    ),
    prdSection(
      "changes",
      "Linked changes",
      bullets(
        report.changes.map(
          (c) =>
            `${c.displayId ?? c.id} ${oneLine(c.title, 100)}: ${c.relation}, ${c.open ? "open" : c.applied ? `applied${c.appliedAt ? ` ${c.appliedAt.slice(0, 10)}` : ""}` : c.status}${c.release ? `, release ${c.release}` : ""}`,
        ),
        "No change amends or touches this capability.",
      ) + (report.changesPage.matched > report.changes.length ? `\n(${report.changesPage.matched - report.changes.length} more not listed)` : ""),
      now,
    ),
  ];
  const index = indexTree(tree);
  const ids = report.changes.flatMap((c) => {
    const change = index.resolve(c.id);
    return change ? subtreeIds(change, 50) : [c.id];
  });
  return { sections, ids };
}

function v1ItemSections(found: Found, now: string): { sections: PacketSection[]; ids: string[] } {
  const { node, chain } = found;
  const criteria = strings(node.acceptanceCriteria);
  const children = node.children ?? [];
  return {
    sections: [
      prdSection(
        "item",
        kindOf(node),
        [
          label(node),
          `Status: ${nodeStatus(node)}`,
          ...(text(node.description) ? [`Description: ${text(node.description)}`] : []),
          "Acceptance criteria:",
          bullets(criteria, "(none)"),
        ].join("\n"),
        now,
      ),
      prdSection("parents", "Parent chain", bullets(chain.map((p) => `${kindOf(p)} ${label(p)}`), "(top level)"), now),
      prdSection(
        "children",
        "Children",
        bullets(children.map((c) => `${kindOf(c)} ${oneLine(label(c), 100)}: ${nodeStatus(c)}`), "(none)"),
        now,
      ),
    ],
    ids: subtreeIds(node),
  };
}

/** Explain: what a capability (or, on a v1 tree, an epic or feature) is, where it stands and what code backs it. */
export async function buildExplainPacket(sources: PacketSources, target: PacketTarget, now: string): Promise<Packet> {
  const lens = "explain";
  const prd = await sources.prd();
  if (!prd) return noPrd(lens, EXPLAIN_CAP, target, now, "no readable PRD");
  if (!target.ref) return noPrd(lens, EXPLAIN_CAP, target, now, "Explain needs a target: name a capability, epic or feature");

  let built: { sections: PacketSection[]; ids: string[] } | null = null;
  if (prd.layout === "v2") {
    const node = indexTree(prd.tree).resolve(target.ref);
    if (node?.type === "capability") built = v2CapabilitySections(prd.tree, node, now);
  }
  const found = built ? null : findNode([...prd.tree.product, ...prd.tree.changes], target.ref);
  if (!built && found) built = v1ItemSections(found, now);
  if (!built) return noPrd(lens, EXPLAIN_CAP, target, now, `"${target.ref}" names no capability, epic or feature`);

  const sections = [...built.sections, ...(await evidenceSections(sources, built.ids, now))];
  return assemblePacket({ lens, cap: EXPLAIN_CAP, header: header(lens, target), sections });
}

// ── Describe ─────────────────────────────────────────────────────────

const PREVIEW_HEADINGS_MAX = 25;

/** What the brief preview says about itself without the brief: its size and its headings. */
function previewDigest(brief: string): string {
  const lines = brief.split("\n");
  const headings = lines.filter((l) => /^#{1,3}\s/.test(l)).slice(0, PREVIEW_HEADINGS_MAX);
  return [`${brief.length} characters, ${lines.length} lines.`, "Headings:", bullets(headings, "(no headings)")].join("\n");
}

/** Describe: the task as it will run: text, done-when, settings, what blocks it and how it has gone. */
export async function buildDescribePacket(sources: PacketSources, target: PacketTarget, now: string): Promise<Packet> {
  const lens = "describe";
  const prd = await sources.prd();
  if (!prd) return noPrd(lens, DESCRIBE_CAP, target, now, "no readable PRD");
  const found = target.ref ? findNode(prd.tree.changes, target.ref) : null;
  if (!found) return noPrd(lens, DESCRIBE_CAP, target, now, target.ref ? `"${target.ref}" names no task` : "Describe needs a task");
  const { node, chain } = found;

  const sections: PacketSection[] = [
    prdSection(
      "task",
      "Task",
      [
        label(node),
        `Status: ${nodeStatus(node)}${text(node.priority) ? ` · priority ${text(node.priority)}` : ""}`,
        `Description: ${text(node.description) ?? text(node.intent) ?? "(none)"}`,
        "Done when:",
        bullets(strings(node.acceptanceCriteria), "(none stated)"),
      ].join("\n"),
      now,
    ),
    prdSection("parents", "Parent chain", bullets(chain.map((p) => `${kindOf(p)} ${label(p)} (${nodeStatus(p)})`), "(top level)"), now),
    prdSection("blockers", "Blockers and dependencies", blockersBody(prd, node), now),
  ];

  const resolved = await sources.resolve(node.id);
  sections.push(
    resolved
      ? {
          id: "settings",
          title: "Run settings (ndx work --resolve)",
          body: [
            bullets(resolved.settings.map((s) => `${s.key} = ${JSON.stringify(s.value)} (from ${s.source})`), "(none resolved)"),
            "Refusals:",
            bullets(resolved.refusals.map((r) => `${r.code}: ${oneLine(r.message)}`), "none"),
            ...(resolved.warnings.length > 0 ? ["Warnings:", bullets(resolved.warnings.map((w) => `${w.code}: ${oneLine(w.message)}`), "")] : []),
          ].join("\n"),
          provenance: { source: "ndx work --resolve", generatedAt: now },
          staleness: FRESH,
        }
      : gap("settings", "Run settings (ndx work --resolve)", "the resolve command did not answer", now, "ndx work --resolve"),
  );

  const brief = await sources.preview(node.id);
  sections.push(
    brief !== null
      ? { id: "brief", title: "Brief preview digest", body: previewDigest(brief), provenance: { source: "ndx work --dry-run", generatedAt: now }, staleness: FRESH }
      : gap("brief", "Brief preview digest", "the dry run did not answer", now, "ndx work --dry-run"),
  );

  const runs = await sources.runs(node.id);
  const runSource = ".hench/runs/";
  sections.push(
    runs
      ? {
          id: "runs",
          title: "Prior runs",
          body: bullets(runs.slice(0, 10).map((r) => `${r.id.slice(0, 8)} ${r.startedAt.slice(0, 16)} ${r.status}`), "No run of this task is recorded."),
          provenance: { source: runSource, generatedAt: now },
          staleness: FRESH,
        }
      : gap("runs", "Prior runs", "the run records could not be read", now, runSource),
  );

  return assemblePacket({ lens, cap: DESCRIBE_CAP, header: header(lens, target), sections });
}

function blockersBody(prd: PrdRead, node: RuleNode): string {
  const all = [...prd.tree.product, ...prd.tree.changes];
  const describe = (ref: string): string => {
    const hit = findNode(all, ref);
    return hit ? `${label(hit.node)}: ${nodeStatus(hit.node)}` : `${ref}: not found`;
  };
  const blockedBy = strings(node.blockedBy).map(describe);
  const dependsOn = strings(node.dependsOn).map(describe);
  return [
    "Blocked by:",
    bullets(blockedBy, "nothing"),
    ...(dependsOn.length > 0 ? ["Depends on:", bullets(dependsOn, "")] : []),
  ].join("\n");
}

// ── Plan ─────────────────────────────────────────────────────────────

const RECENT_CHANGES = 8;

/** Plan: the product-map slice (v2) or epic subtree (v1) around the target, what awaits placement, what changed lately, what to dedupe against. */
export async function buildPlanPacket(sources: PacketSources, target: PacketTarget, now: string): Promise<Packet> {
  const lens = "plan";
  const prd = await sources.prd();
  if (!prd) return noPrd(lens, PLAN_CAP, target, now, "no readable PRD");
  const all = [...prd.tree.product, ...prd.tree.changes];
  const found = target.ref ? findNode(all, target.ref) : null;
  if (target.ref && !found) return noPrd(lens, PLAN_CAP, target, now, `"${target.ref}" names no item`);

  const sections: PacketSection[] = [];
  if (prd.layout === "v2") {
    sections.push(prdSection("slice", "Product map around the target", productSlice(prd.tree, found), now));
  } else {
    const epic = found ? (found.chain[0] ?? found.node) : null;
    sections.push(prdSection("slice", "Epic subtree around the target", epic ? subtreeLines(epic, 0, 3).join("\n") : "(no target: see the sibling titles)", now));
  }

  const changes = flattenChanges(prd.tree.changes);
  const placement = changes.filter((c) => c.needsPlacement === true);
  sections.push(
    prdSection(
      "inbox",
      "Inbox and items needing placement",
      bullets(placement.map((c) => `${label(c)} (${nodeStatus(c)})`), "Nothing awaits placement."),
      now,
    ),
    prdSection(
      "recent",
      "Recent changes",
      bullets(
        changes
          .filter((c) => c.type === "change" && (isAppliedChange(c) || nodeStatus(c) === "completed"))
          .sort((a, b) => doneAt(b).localeCompare(doneAt(a)) || a.id.localeCompare(b.id))
          .slice(0, RECENT_CHANGES)
          .map((c) => `${label(c)} (${doneAt(c).slice(0, 10) || "undated"})`),
        "No change has been applied or completed.",
      ),
      now,
    ),
    prdSection(
      "siblings",
      "Sibling titles (dedupe against these)",
      bullets((found ? found.siblings : prd.layout === "v2" ? prd.tree.product : prd.tree.changes).map((s) => label(s)), "(none)"),
      now,
    ),
  );
  return assemblePacket({ lens, cap: PLAN_CAP, header: header(lens, target), sections });
}

function doneAt(node: RuleNode): string {
  return text(node.appliedAt) ?? text(node.completedAt) ?? "";
}

function flattenChanges(roots: RuleNode[]): RuleNode[] {
  const out: RuleNode[] = [];
  const visit = (n: RuleNode): void => {
    out.push(n);
    for (const child of n.children ?? []) visit(child);
  };
  roots.forEach(visit);
  return out;
}

function subtreeLines(node: RuleNode, depth: number, maxDepth: number): string[] {
  const own = `${"  ".repeat(depth)}- ${kindOf(node)} ${oneLine(label(node), 100)} (${nodeStatus(node)})`;
  if (depth >= maxDepth) return [own];
  return [own, ...(node.children ?? []).flatMap((c) => subtreeLines(c, depth + 1, maxDepth))];
}

/** The target's area with its capabilities and their derived status; every area when nothing is targeted. */
function productSlice(tree: V2Tree, found: Found | null): string {
  const report = productReport(tree);
  const areaOf = found ? [...found.chain, found.node].find((n) => n.type === "area") : undefined;
  const areas = areaOf ? report.filter((a) => a.id === areaOf.id) : report;
  const lines: string[] = [];
  const visit = (row: (typeof report)[number], depth: number): void => {
    const state = row.status ? ` (${row.status}, ${row.health})` : "";
    lines.push(`${"  ".repeat(depth)}- ${row.type} ${oneLine(row.displayId ? `${row.displayId} ${row.title}` : row.title, 100)}${state}`);
    for (const child of row.children ?? []) visit(child, depth + 1);
  };
  areas.forEach((a) => visit(a, 0));
  return lines.length > 0 ? lines.join("\n") : "(the product layer is empty)";
}
