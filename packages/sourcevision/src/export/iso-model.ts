/**
 * Isometric map model builder.
 *
 * Turns sourcevision analysis output into a layered, grid-placed scene graph
 * that the isometric renderer can extrude into 3D boxes. All geometry is
 * computed here — in project grid units, not pixels — so the layout is
 * deterministic and testable without touching HTML or the DOM.
 *
 * Grid units: `u` runs along the dependency axis (left→right in the projected
 * scene), `v` across it, `h` is extrusion height. The renderer projects
 * (u, v, h) to screen space; nothing in this module knows about pixels.
 */

import type {
  Classifications,
  Components,
  Finding,
  Imports,
  Inventory,
  Manifest,
  RiskLevel,
  Zone,
  Zones,
} from "../schema/v1.js";

// ── Public model types ──────────────────────────────────────────────────────

/**
 * Visual category for a node. Derived from the dominant archetype of a zone's
 * files, which is what gives the map its "these blocks do the same kind of
 * work" reading rather than colouring by package.
 */
export type IsoKind =
  | "entry"
  | "logic"
  | "data"
  | "ui"
  | "gateway"
  | "support"
  | "tests"
  | "external";

export interface IsoKindMeta {
  id: IsoKind;
  label: string;
  color: string;
}

/** A cross-zone relationship shown in a node's detail panel. */
export interface IsoNodeLink {
  id: string;
  name: string;
  weight: number;
}

export interface IsoNodeMetrics {
  files: number;
  lines: number;
  cohesion: number;
  coupling: number;
  riskLevel: RiskLevel | "unscored";
  /** Server routes owned by this zone — a concrete inbound entry point count. */
  routes: number;
}

export interface IsoNode {
  id: string;
  name: string;
  kind: IsoKind;
  /** Dependency layer (0 = nothing in the map depends on it upstream). */
  col: number;
  /** Slot within the layer. */
  row: number;
  /** Grid origin and footprint. */
  u: number;
  v: number;
  w: number;
  d: number;
  /** Extrusion height, scaled from line count. */
  h: number;
  /** Layer caption shown above the node name in the panel. */
  stage: string;
  /** One-line metric summary. */
  sub: string;
  /** Zone description. */
  body: string;
  metrics: IsoNodeMetrics;
  /** Archetype mix, most common first: [archetypeId, fileCount]. */
  archetypes: Array<[string, number]>;
  /** Representative files — entry points first, then largest by line count. */
  keyFiles: string[];
  /** Zone insights from analysis (structural + AI-enriched). */
  insights: string[];
  /** Findings scoped to this zone. */
  findings: Array<{ text: string; severity: string; type: string }>;
  inbound: IsoNodeLink[];
  outbound: IsoNodeLink[];
}

export interface IsoEdge {
  from: string;
  to: string;
  /** Number of underlying cross-zone import edges. */
  weight: number;
  /** True when the edge runs backwards through the layering (a cycle). */
  back: boolean;
  /** Orthogonal route in grid units, precomputed so the renderer stays dumb. */
  points: Array<[number, number]>;
}

export interface IsoModelMeta {
  project: string;
  analyzedAt: string;
  gitBranch?: string;
  gitSha?: string;
  totalZones: number;
  shownZones: number;
  totalFiles: number;
  totalLines: number;
  /** Zones dropped by the maxNodes cap, largest-first ordering retained. */
  omittedZones: string[];
  /** Signals the map could not derive from analysis output. */
  gaps: string[];
}

export interface IsoModel {
  nodes: IsoNode[];
  edges: IsoEdge[];
  kinds: IsoKindMeta[];
  layers: string[];
  meta: IsoModelMeta;
  /** Scene bounds in grid units. */
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number };
}

export interface IsoModelInput {
  manifest: Manifest;
  zones: Zones;
  inventory: Inventory;
  imports: Imports;
  classifications?: Classifications;
  components?: Components;
  projectName: string;
}

export interface IsoModelOptions {
  /** Cap on rendered zones; the largest by file count win. Default 40. */
  maxNodes?: number;
  /** Include shared third-party packages as a leading column. Default true. */
  includeExternals?: boolean;
  /** Cap on external nodes. Default 5. */
  maxExternals?: number;
  /**
   * Minimum number of consuming zones before an external package earns a node.
   * Keeps the column to genuinely shared infrastructure. Default 2.
   */
  minExternalConsumers?: number;
}

// ── Palette and archetype mapping ───────────────────────────────────────────

export const ISO_KINDS: IsoKindMeta[] = [
  { id: "entry", label: "Entry points", color: "#4F9BE8" },
  { id: "logic", label: "Business logic", color: "#7FAE33" },
  { id: "data", label: "Data & schema", color: "#C06BD4" },
  { id: "ui", label: "User interface", color: "#E0A33E" },
  { id: "gateway", label: "Gateways", color: "#3FB6A8" },
  { id: "support", label: "Support & config", color: "#6F7BA6" },
  { id: "tests", label: "Tests", color: "#4E5B78" },
  { id: "external", label: "Outside the codebase", color: "#7C879B" },
];

/**
 * Archetype → visual kind. Anything unmapped falls through to "support",
 * which is the honest default for utility-shaped code.
 */
const ARCHETYPE_KIND: Record<string, IsoKind> = {
  entrypoint: "entry",
  "route-handler": "entry",
  page: "entry",
  "cli-command": "logic",
  service: "logic",
  middleware: "logic",
  store: "data",
  schema: "data",
  types: "data",
  model: "data",
  component: "ui",
  hook: "ui",
  view: "ui",
  gateway: "gateway",
  adapter: "gateway",
  client: "gateway",
  utility: "support",
  config: "support",
  "test-helper": "support",
};

// ── Geometry constants ──────────────────────────────────────────────────────

/** Gap between dependency layers, in grid units — leaves room for routing. */
const GAP_U = 5;
/** Gap between slots within a layer. */
const GAP_V = 2;
const MIN_W = 3;
const MAX_W = 9;
const MIN_D = 3;
const MAX_D = 7;
const MIN_H = 1.2;
const MAX_H = 6.5;

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Round to 2dp so emitted JSON stays stable across platforms. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function dominant<T extends string>(counts: Map<T, number>): T | undefined {
  let best: T | undefined;
  let bestCount = -1;
  // Sort keys so ties resolve deterministically rather than by insertion order.
  for (const key of [...counts.keys()].sort()) {
    const count = counts.get(key)!;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

// ── Model construction ──────────────────────────────────────────────────────

export function buildIsoModel(
  input: IsoModelInput,
  options: IsoModelOptions = {},
): IsoModel {
  const maxNodes = options.maxNodes ?? 40;
  const includeExternals = options.includeExternals ?? true;
  const maxExternals = options.maxExternals ?? 5;
  const minExternalConsumers = options.minExternalConsumers ?? 2;

  const { zones, inventory, imports, classifications, components, manifest } = input;

  // ── Per-file lookups ──────────────────────────────────────────────────────

  const linesByFile = new Map<string, number>();
  const roleByFile = new Map<string, string>();
  for (const file of inventory.files) {
    linesByFile.set(file.path, file.lineCount);
    roleByFile.set(file.path, file.role);
  }

  const archetypeByFile = new Map<string, string>();
  for (const entry of classifications?.files ?? []) {
    if (entry.archetype) archetypeByFile.set(entry.path, entry.archetype);
  }

  const routesByFile = new Map<string, number>();
  for (const group of components?.serverRoutes ?? []) {
    for (const route of group.routes ?? []) {
      routesByFile.set(route.file, (routesByFile.get(route.file) ?? 0) + 1);
    }
  }

  // ── Select zones ──────────────────────────────────────────────────────────

  // Detection artifacts carry meaningless cohesion/coupling — showing them as
  // architecture would be a lie, so they are excluded from the scene entirely.
  const candidates = zones.zones.filter(
    (z) => z.files.length > 0 && z.detectionQuality !== "artifact",
  );

  const ranked = [...candidates].sort(
    (a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id),
  );
  const selected = ranked.slice(0, maxNodes);
  const omitted = ranked.slice(maxNodes).map((z) => z.name);
  const selectedIds = new Set(selected.map((z) => z.id));

  const zoneById = new Map(selected.map((z) => [z.id, z]));

  // ── Zone-level aggregates ─────────────────────────────────────────────────

  interface Agg {
    lines: number;
    routes: number;
    /** Files whose inventory role is "test" — drives the tests kind. */
    testFiles: number;
    archetypes: Map<string, number>;
  }
  const aggById = new Map<string, Agg>();

  for (const zone of selected) {
    const agg: Agg = { lines: 0, routes: 0, testFiles: 0, archetypes: new Map() };
    for (const file of zone.files) {
      agg.lines += linesByFile.get(file) ?? 0;
      agg.routes += routesByFile.get(file) ?? 0;
      if (roleByFile.get(file) === "test") agg.testFiles += 1;
      const archetype = archetypeByFile.get(file);
      if (archetype) {
        agg.archetypes.set(archetype, (agg.archetypes.get(archetype) ?? 0) + 1);
      }
    }
    aggById.set(zone.id, agg);
  }

  // ── Aggregate cross-zone edges ────────────────────────────────────────────

  // Keyed on a tab, which cannot appear in a zone id, so the pair is recovered
  // from the stored value rather than by splitting the key back apart.
  const edgeWeights = new Map<string, { from: string; to: string; weight: number }>();
  for (const crossing of zones.crossings) {
    const { fromZone, toZone } = crossing;
    if (fromZone === toZone) continue;
    if (!selectedIds.has(fromZone) || !selectedIds.has(toZone)) continue;
    const key = `${fromZone}\t${toZone}`;
    const existing = edgeWeights.get(key);
    if (existing) existing.weight += 1;
    else edgeWeights.set(key, { from: fromZone, to: toZone, weight: 1 });
  }

  const rawEdges = [...edgeWeights.values()]
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to),
    );

  // ── Layer assignment ──────────────────────────────────────────────────────

  const layerById = assignLayers(
    selected.map((z) => z.id),
    rawEdges,
  );

  // ── External nodes occupy a leading column ────────────────────────────────

  const zoneOfFile = new Map<string, string>();
  for (const zone of selected) {
    for (const file of zone.files) zoneOfFile.set(file, zone.id);
  }

  interface ExternalPick {
    id: string;
    name: string;
    consumers: string[];
  }
  const externalPicks: ExternalPick[] = [];

  if (includeExternals) {
    const scored = imports.external
      .map((ext) => {
        const consumers = new Set<string>();
        for (const importer of ext.importedBy) {
          const zoneId = zoneOfFile.get(importer);
          if (zoneId) consumers.add(zoneId);
        }
        return { pkg: ext.package, consumers: [...consumers].sort() };
      })
      .filter((e) => e.consumers.length >= minExternalConsumers)
      .sort(
        (a, b) =>
          b.consumers.length - a.consumers.length || a.pkg.localeCompare(b.pkg),
      )
      .slice(0, maxExternals);

    for (const entry of scored) {
      externalPicks.push({
        id: `ext:${entry.pkg}`,
        name: entry.pkg,
        consumers: entry.consumers,
      });
    }
  }

  // Externals sit one layer left of everything; shift zones right to make room.
  const layerShift = externalPicks.length > 0 ? 1 : 0;

  // ── Build nodes (pre-geometry) ────────────────────────────────────────────

  const lineValues = selected.map((z) => aggById.get(z.id)!.lines);
  const minLines = lineValues.length ? Math.min(...lineValues) : 0;
  const maxLines = lineValues.length ? Math.max(...lineValues) : 0;

  const findingsByZone = new Map<string, Finding[]>();
  for (const finding of zones.findings ?? []) {
    if (!selectedIds.has(finding.scope)) continue;
    const list = findingsByZone.get(finding.scope) ?? [];
    list.push(finding);
    findingsByZone.set(finding.scope, list);
  }

  const inboundById = new Map<string, IsoNodeLink[]>();
  const outboundById = new Map<string, IsoNodeLink[]>();
  for (const edge of rawEdges) {
    const fromZone = zoneById.get(edge.from);
    const toZone = zoneById.get(edge.to);
    if (!fromZone || !toZone) continue;
    const out = outboundById.get(edge.from) ?? [];
    out.push({ id: edge.to, name: toZone.name, weight: edge.weight });
    outboundById.set(edge.from, out);
    const inb = inboundById.get(edge.to) ?? [];
    inb.push({ id: edge.from, name: fromZone.name, weight: edge.weight });
    inboundById.set(edge.to, inb);
  }

  const nodes: IsoNode[] = [];

  for (const zone of selected) {
    const agg = aggById.get(zone.id)!;
    const archetypes = [...agg.archetypes.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    // Test files usually classify as utility or test-helper, which would sink
    // them into "support" and make a test-heavy repo look like infrastructure.
    // Role is the more honest signal, so a majority-test zone wins outright and
    // becomes filterable from the legend.
    const topArchetype = dominant(agg.archetypes);
    const kind: IsoKind =
      agg.testFiles * 2 > zone.files.length
        ? "tests"
        : topArchetype
          ? (ARCHETYPE_KIND[topArchetype] ?? "support")
          : "support";

    const files = zone.files.length;
    const w = clamp(Math.round(Math.sqrt(files) * 1.4), MIN_W, MAX_W);
    const d = clamp(Math.round(Math.sqrt(files) * 1.0), MIN_D, MAX_D);
    const h = scaleHeight(agg.lines, minLines, maxLines);

    nodes.push({
      id: zone.id,
      name: zone.name,
      kind,
      col: layerById.get(zone.id)! + layerShift,
      row: 0, // assigned during ordering
      u: 0,
      v: 0,
      w,
      d,
      h,
      stage: "",
      sub: `${formatCount(files)} files · ${formatCount(agg.lines)} lines`,
      body: zone.description,
      metrics: {
        files,
        lines: agg.lines,
        cohesion: zone.cohesion,
        coupling: zone.coupling,
        riskLevel: zone.riskMetrics?.riskLevel ?? "unscored",
        routes: agg.routes,
      },
      archetypes: archetypes.slice(0, 6),
      keyFiles: pickKeyFiles(zone, linesByFile),
      insights: zone.insights ?? [],
      findings: (findingsByZone.get(zone.id) ?? [])
        .slice(0, 8)
        .map((f) => ({
          text: f.text,
          severity: f.severity ?? "info",
          type: f.type,
        })),
      inbound: (inboundById.get(zone.id) ?? []).slice(0, 8),
      outbound: (outboundById.get(zone.id) ?? []).slice(0, 8),
    });
  }

  for (const ext of externalPicks) {
    const consumerNames = ext.consumers
      .map((id) => zoneById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    nodes.push({
      id: ext.id,
      name: ext.name,
      kind: "external",
      col: 0,
      row: 0,
      u: 0,
      v: 0,
      w: MIN_W,
      d: MIN_D,
      h: MIN_H,
      stage: "",
      sub: `used by ${consumerNames.length} zones`,
      body: `Third-party package imported across ${consumerNames.length} zones. Nothing in this repository controls its behaviour — it is shown to make the shared dependency surface visible.`,
      metrics: {
        files: 0,
        lines: 0,
        cohesion: 0,
        coupling: 0,
        riskLevel: "unscored",
        routes: 0,
      },
      archetypes: [],
      keyFiles: [],
      insights: [],
      findings: [],
      inbound: [],
      outbound: consumerNames.map((name, i) => ({
        id: ext.consumers[i],
        name,
        weight: 1,
      })),
    });
  }

  // ── Row ordering and grid placement ───────────────────────────────────────

  orderRows(nodes, rawEdges);
  placeOnGrid(nodes);

  const layerCount = nodes.reduce((max, n) => Math.max(max, n.col), 0) + 1;
  const layers: string[] = [];
  for (let i = 0; i < layerCount; i++) {
    if (layerShift === 1 && i === 0) layers.push("Dependencies");
    else layers.push(`Layer ${i - layerShift + 1}`);
  }
  for (const node of nodes) node.stage = layers[node.col];

  const bounds = computeBounds(nodes);

  // ── Edges, including external fan-out ─────────────────────────────────────

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: IsoEdge[] = [];

  for (const edge of rawEdges) {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) continue;
    const back = b.col <= a.col;
    edges.push({
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
      back,
      points: routeEdge(a, b, bounds),
    });
  }

  for (const ext of externalPicks) {
    const a = nodeById.get(ext.id);
    if (!a) continue;
    for (const consumerId of ext.consumers) {
      const b = nodeById.get(consumerId);
      if (!b) continue;
      edges.push({
        from: ext.id,
        to: consumerId,
        weight: 1,
        back: b.col <= a.col,
        points: routeEdge(a, b, bounds),
      });
    }
  }

  const totalLines = inventory.summary?.totalLines ?? 0;

  return {
    nodes,
    edges,
    kinds: ISO_KINDS,
    layers,
    bounds,
    meta: {
      project: input.projectName,
      analyzedAt: manifest.analyzedAt,
      gitBranch: manifest.gitBranch,
      gitSha: manifest.gitSha,
      totalZones: candidates.length,
      shownZones: selected.length,
      totalFiles: inventory.summary?.totalFiles ?? inventory.files.length,
      totalLines,
      omittedZones: omitted,
      gaps: describeGaps(input),
    },
  };
}

// ── Layering ────────────────────────────────────────────────────────────────

/**
 * Longest-path layering over the zone dependency graph.
 *
 * Import graphs are rarely acyclic, so back edges are removed first via a
 * deterministic DFS (any edge pointing at a node already on the recursion
 * stack). Those edges still render — they are drawn through a return lane
 * below the scene — but they must not participate in depth, or a single cycle
 * would stretch the map to the node count.
 */
export function assignLayers(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): Map<string, number> {
  const ids = [...nodeIds].sort();
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    if (edge.from === edge.to) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }
  for (const list of adjacency.values()) list.sort();

  // Pass 1 — find back edges with an iterative DFS.
  const backEdges = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  for (const id of ids) state.set(id, 0);

  for (const root of ids) {
    if (state.get(root) !== 0) continue;
    const stack: Array<{ id: string; index: number }> = [{ id: root, index: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = adjacency.get(frame.id)!;
      if (frame.index >= neighbours.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const next = neighbours[frame.index++];
      const nextState = state.get(next);
      if (nextState === 1) {
        backEdges.add(`${frame.id} ${next}`);
      } else if (nextState === 0) {
        state.set(next, 1);
        stack.push({ id: next, index: 0 });
      }
    }
  }

  // Pass 2 — longest path on the remaining DAG, memoized.
  const incoming = new Map<string, string[]>();
  for (const id of ids) incoming.set(id, []);
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (backEdges.has(`${from} ${to}`)) continue;
      incoming.get(to)!.push(from);
    }
  }

  const layer = new Map<string, number>();
  const visiting = new Set<string>();

  function depth(id: string): number {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // defensive: back edges are already removed
    visiting.add(id);
    let best = 0;
    for (const from of incoming.get(id)!) {
      best = Math.max(best, depth(from) + 1);
    }
    visiting.delete(id);
    layer.set(id, best);
    return best;
  }

  for (const id of ids) depth(id);
  return layer;
}

// ── Row ordering ────────────────────────────────────────────────────────────

/**
 * Orders nodes within each layer using a barycenter heuristic: a node sits
 * near the average row of the things that depend on it. One forward pass is
 * enough to remove most edge crossings without the cost of full Sugiyama.
 */
function orderRows(nodes: IsoNode[], edges: Array<{ from: string; to: string }>): void {
  const byCol = new Map<number, IsoNode[]>();
  for (const node of nodes) {
    const list = byCol.get(node.col) ?? [];
    list.push(node);
    byCol.set(node.col, list);
  }

  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const list = predecessors.get(edge.to) ?? [];
    list.push(edge.from);
    predecessors.set(edge.to, list);
  }

  const rowOf = new Map<string, number>();
  const cols = [...byCol.keys()].sort((a, b) => a - b);

  for (const col of cols) {
    const layer = byCol.get(col)!;
    layer.sort((a, b) => {
      const ba = barycenter(a, predecessors, rowOf);
      const bb = barycenter(b, predecessors, rowOf);
      if (ba !== bb) return ba - bb;
      return b.metrics.files - a.metrics.files || a.id.localeCompare(b.id);
    });
    layer.forEach((node, index) => {
      node.row = index;
      rowOf.set(node.id, index);
    });
  }
}

function barycenter(
  node: IsoNode,
  predecessors: Map<string, string[]>,
  rowOf: Map<string, number>,
): number {
  const preds = predecessors.get(node.id) ?? [];
  const rows = preds
    .map((id) => rowOf.get(id))
    .filter((r): r is number => r !== undefined);
  if (rows.length === 0) return Number.MAX_SAFE_INTEGER; // unanchored → sort last
  return rows.reduce((sum, r) => sum + r, 0) / rows.length;
}

// ── Grid placement ──────────────────────────────────────────────────────────

/**
 * Converts (col, row) slots into grid coordinates. Column widths and row
 * depths are sized to the largest box occupying them, so boxes never overlap
 * regardless of how lopsided the zone sizes are.
 */
function placeOnGrid(nodes: IsoNode[]): void {
  const colWidth = new Map<number, number>();
  const rowDepth = new Map<number, number>();

  for (const node of nodes) {
    colWidth.set(node.col, Math.max(colWidth.get(node.col) ?? 0, node.w));
    rowDepth.set(node.row, Math.max(rowDepth.get(node.row) ?? 0, node.d));
  }

  const colOffset = new Map<number, number>();
  let u = 0;
  for (const col of [...colWidth.keys()].sort((a, b) => a - b)) {
    colOffset.set(col, u);
    u += colWidth.get(col)! + GAP_U;
  }

  const rowOffset = new Map<number, number>();
  let v = 0;
  for (const row of [...rowDepth.keys()].sort((a, b) => a - b)) {
    rowOffset.set(row, v);
    v += rowDepth.get(row)! + GAP_V;
  }

  for (const node of nodes) {
    node.u = colOffset.get(node.col)!;
    node.v = rowOffset.get(node.row)!;
  }
}

function computeBounds(nodes: IsoNode[]): IsoModel["bounds"] {
  if (nodes.length === 0) return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
  let uMax = 0;
  let vMax = 0;
  for (const node of nodes) {
    uMax = Math.max(uMax, node.u + node.w);
    vMax = Math.max(vMax, node.v + node.d);
  }
  return { uMin: 0, uMax, vMin: 0, vMax };
}

// ── Edge routing ────────────────────────────────────────────────────────────

/**
 * Orthogonal route between two boxes, in grid units.
 *
 * Forward edges leave the right face, step into the inter-layer gap, cross,
 * and enter the left face. Back edges (cycles, and same-layer links) drop below
 * the scene into a shared return lane so they read as exceptions rather than
 * cutting through the middle of the map.
 */
export function routeEdge(
  a: IsoNode,
  b: IsoNode,
  bounds: IsoModel["bounds"],
): Array<[number, number]> {
  const av = round2(a.v + a.d / 2);
  const bv = round2(b.v + b.d / 2);

  if (b.col > a.col) {
    const exit = a.u + a.w;
    const entry = b.u;
    const mid = round2(exit + (entry - exit) / 2);
    if (av === bv) return [[exit, av], [entry, bv]];
    return [
      [exit, av],
      [mid, av],
      [mid, bv],
      [entry, bv],
    ];
  }

  // Return lane below the scene, keyed off the deeper of the two boxes so
  // routes for adjacent rows do not stack on the same line.
  const lane = round2(bounds.vMax + 2 + (a.row % 3) * 0.8);
  const ax = round2(a.u + a.w / 2);
  const bx = round2(b.u + b.w / 2);
  return [
    [ax, a.v + a.d],
    [ax, lane],
    [bx, lane],
    [bx, b.v + b.d],
  ];
}

// ── Scaling ─────────────────────────────────────────────────────────────────

/**
 * Log-normalized height. Line counts across zones span orders of magnitude, so
 * a linear scale would flatten every small zone to nothing; normalizing across
 * the observed range guarantees the tallest and shortest zones are visibly
 * different even in a narrow project.
 */
export function scaleHeight(lines: number, minLines: number, maxLines: number): number {
  if (maxLines <= 0) return MIN_H;
  const lo = Math.log10(Math.max(minLines, 1) + 1);
  const hi = Math.log10(Math.max(maxLines, 1) + 1);
  if (hi - lo < 1e-9) return round2((MIN_H + MAX_H) / 2);
  const t = (Math.log10(Math.max(lines, 1) + 1) - lo) / (hi - lo);
  return round2(MIN_H + clamp(t, 0, 1) * (MAX_H - MIN_H));
}

// ── Detail helpers ──────────────────────────────────────────────────────────

function pickKeyFiles(zone: Zone, linesByFile: Map<string, number>): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];

  for (const entry of zone.entryPoints.slice(0, 4)) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    picked.push(entry);
  }

  const bySize = [...zone.files]
    .filter((f) => !seen.has(f))
    .sort(
      (a, b) =>
        (linesByFile.get(b) ?? 0) - (linesByFile.get(a) ?? 0) ||
        a.localeCompare(b),
    );

  for (const file of bySize) {
    if (picked.length >= 8) break;
    picked.push(file);
  }

  return picked;
}

/**
 * What the map cannot show from static analysis alone.
 *
 * This is deliberately data-driven rather than a fixed string: the list shrinks
 * as the underlying analysis gains the corresponding signal, so the rendered
 * map always states its own honest limits. See
 * docs/architecture/iso-map-data-flow.md for the full analysis.
 */
function describeGaps(input: IsoModelInput): string[] {
  const gaps: string[] = [];

  if (!input.classifications) {
    gaps.push(
      "No classifications.json — block colours fall back to a single support kind. Run a full analyze to classify archetypes.",
    );
  }
  if (!input.components || (input.components.serverRoutes ?? []).length === 0) {
    gaps.push(
      "No server routes detected — inbound entry points are inferred from zone entry files rather than real HTTP surfaces.",
    );
  }

  gaps.push(
    "Edges are static import relationships, not runtime data flow. A drawn edge means \"this zone imports that one\", not \"a request travels this way\".",
  );
  gaps.push(
    "Runtime infrastructure — queues, caches, buckets, databases, cron — has no static import signature and is absent unless a zone wraps it in code.",
  );
  gaps.push(
    "Edge direction follows imports. A callback or event seam inverts control at runtime and will appear pointing the wrong way.",
  );

  return gaps;
}
