/**
 * Isometric map model builder.
 *
 * Turns a normalized view of a codebase into a layered, grid-placed scene graph
 * that the renderer can extrude into 3D boxes. All geometry is computed here —
 * in project grid units, not pixels — so the layout is deterministic and
 * testable without touching HTML or the DOM.
 *
 * The input is deliberately source-agnostic: `iso-sources.ts` adapts either a
 * `.sourcevision/` analysis or a direct filesystem scan into the same shape, so
 * there is exactly one implementation of layering, sizing, colouring and
 * routing regardless of where the facts came from.
 *
 * Grid units: `u` runs along the dependency axis (left→right in the projected
 * scene), `v` across it, `h` is extrusion height. The renderer projects
 * (u, v, h) to screen space; nothing in this module knows about pixels.
 *
 * Imports nothing but types — this module is bundled into a standalone script.
 */

// ── Public model types ──────────────────────────────────────────────────────

/**
 * Visual category for a node, derived from what a zone's files mostly do.
 * This is what gives the map its "these blocks do the same kind of work"
 * reading rather than colouring by package.
 */
export type IsoKind =
  | "entry"
  | "logic"
  | "data"
  | "ui"
  | "gateway"
  | "support"
  | "tests"
  | "external"
  | "infra";

export interface IsoKindMeta {
  id: IsoKind;
  label: string;
  color: string;
  /** Shown beside the colour so kind is never encoded by colour alone. */
  glyph: string;
}

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
  riskLevel: string;
  /** Server routes owned by this zone — a concrete inbound entry point count. */
  routes: number;
}

/** A file shown in a node's panel, optionally linked to its source. */
export interface IsoKeyFile {
  path: string;
  url?: string;
}

export interface IsoNode {
  id: string;
  name: string;
  kind: IsoKind;
  /** Dependency layer (0 = nothing in the map depends on it upstream). */
  col: number;
  /** Slot within the layer. */
  row: number;
  u: number;
  v: number;
  w: number;
  d: number;
  /** Extrusion height, scaled from line count. */
  h: number;
  stage: string;
  sub: string;
  body: string;
  metrics: IsoNodeMetrics;
  /** Composition of the zone, most common first: [label, count]. */
  mix: Array<[string, number]>;
  keyFiles: IsoKeyFile[];
  insights: string[];
  findings: Array<{ text: string; severity: string }>;
  inbound: IsoNodeLink[];
  outbound: IsoNodeLink[];
  /** Sub-zone tiles on the top face, offsets relative to the node's (u, v). */
  tiles?: IsoTile[];
}

/** A sub-zone drawn as a rectangle on its parent's top face. */
export interface IsoTile {
  id: string;
  name: string;
  files: number;
  u: number;
  v: number;
  w: number;
  d: number;
}

/**
 * Lay children out as rows of tiles filling a `w × d` face, areas
 * proportional to file count: about √n rows, children assigned largest-first
 * to the lightest row, each row's depth proportional to its total and each
 * tile's width to its share of the row. Deterministic for a given input.
 */
export function layoutTiles(children: Array<{ id: string; name: string; files: number }>, w: number, d: number): IsoTile[] {
  const kids = children.filter((c) => c.files > 0)
    .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id));
  if (kids.length < 2) return [];
  const rowCount = Math.max(1, Math.round(Math.sqrt(kids.length)));
  const rows: Array<{ total: number; items: typeof kids }> = Array.from({ length: rowCount }, () => ({ total: 0, items: [] }));
  for (const k of kids) {
    const row = rows.reduce((best, r) => (r.total < best.total ? r : best), rows[0]);
    row.items.push(k);
    row.total += k.files;
  }
  const grand = rows.reduce((n, r) => n + r.total, 0);
  const tiles: IsoTile[] = [];
  let v = 0;
  for (const row of rows.filter((r) => r.items.length > 0)) {
    const rd = (d * row.total) / grand;
    let u = 0;
    for (const k of row.items) {
      const tw = (w * k.files) / row.total;
      tiles.push({ id: k.id, name: k.name, files: k.files, u: round3(u), v: round3(v), w: round3(tw), d: round3(rd) });
      u += tw;
    }
    v += rd;
  }
  return tiles;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * What the call graph has to say about a declared seam.
 *
 * A seam is a claim somebody wrote down, and a refactor can leave the claim
 * behind: the map would go on asserting a relationship nothing invokes any
 * more, which is worse than showing nothing. Where a call graph exists it is
 * the available cross-check — a declared callback that is called on the
 * receiving side is corroborated, one that is called nowhere is stale or wrong.
 *
 * Absent (rather than `unverified`) when there was no call graph to check
 * against, or no callbacks named to look for. "Not checked" and "checked and
 * unsupported" are different claims and the map must not conflate them.
 */
export interface IsoSeamVerification {
  /** `verified` when at least one declared callback is corroborated. */
  status: "verified" | "unverified";
  /** Declared callbacks the call graph shows being invoked on the receiving side. */
  corroborated: Array<{
    callback: string;
    /** File on the receiving side that calls it. */
    file: string;
    /** How the call reads in the source, e.g. `options.broadcast`. */
    expression: string;
  }>;
  /** Declared callbacks nothing on the receiving side calls. */
  missing: string[];
}

export interface IsoEdge {
  from: string;
  to: string;
  /** Cross-zone import references. */
  weight: number;
  /** Runtime call references, when a call graph was available. */
  calls: number;
  /** True when the edge runs backwards through the layering (a cycle). */
  back: boolean;
  /**
   * Set when this relationship was declared rather than inferred: a callback or
   * event seam whose runtime direction the import graph cannot see.
   */
  seam?: { callbacks: string[]; note?: string; verification?: IsoSeamVerification };
  /** Set when the edge connects a zone to declared runtime infrastructure. */
  infra?: boolean;
  /** Orthogonal route in grid units, precomputed so the renderer stays dumb. */
  points: Array<[number, number]>;
}

export interface IsoModelMeta {
  project: string;
  analyzedAt: string;
  gitBranch?: string;
  gitSha?: string;
  /** Where the facts came from. */
  origin: "sourcevision" | "scan";
  totalZones: number;
  shownZones: number;
  totalFiles: number;
  totalLines: number;
  omittedZones: string[];
  /** True when edges carry call counts as well as import counts. */
  hasCalls: boolean;
  /** Declared injection seams drawn on the map. */
  seamCount: number;
  /** Runtime infrastructure nodes drawn on the map. */
  infraCount: number;
  gaps: string[];
}

export interface IsoModel {
  nodes: IsoNode[];
  edges: IsoEdge[];
  kinds: IsoKindMeta[];
  layers: string[];
  meta: IsoModelMeta;
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number };
  /** `areas` when nodes are areas of zones; absent (zones) otherwise. */
  level?: "areas" | "zones";
  /** Area id → the map of that area's zones. Present on an areas-level model. */
  scenes?: Record<string, IsoModel>;
  /** On a scene: the area it shows. */
  scene?: { id: string; name: string };
}

// ── Normalized input ────────────────────────────────────────────────────────

export interface IsoZoneInput {
  id: string;
  name: string;
  description: string;
  files: string[];
  entryPoints: string[];
  cohesion: number;
  coupling: number;
  riskLevel?: string;
  insights?: string[];
  /**
   * Balanced sub-zones, drawn as tiles on the zone's top face. Only a
   * subdivision where no child dominates is passed; a lopsided one would
   * draw as one giant tile plus slivers.
   */
  children?: Array<{ id: string; name: string; files: number }>;
}

export interface IsoFileInput {
  lineCount: number;
  /** Visual kind hint for this file. */
  kind: IsoKind;
  /** Finer label used for the composition breakdown (archetype, or the kind). */
  label?: string;
  /** Server routes defined in this file. */
  routes?: number;
}

export interface IsoModelInput {
  zones: IsoZoneInput[];
  crossings: Array<{ fromZone: string; toZone: string }>;
  files: Map<string, IsoFileInput>;
  external: Array<{ package: string; importedBy: string[] }>;
  findings: Array<{ scope: string; text: string; severity?: string }>;
  /** Aggregated call-graph edges between zones, when available. */
  callEdges?: Array<{ fromZone: string; toZone: string; weight: number }>;
  /**
   * Runtime control-flow seams declared in .n-dx.json. Drawn in the direction
   * control actually flows, which is often the opposite of the import.
   */
  seams?: Array<{
    fromZone: string;
    toZone: string;
    callbacks?: string[];
    note?: string;
    /** Set when a call graph was available to check the declaration against. */
    verification?: IsoSeamVerification;
  }>;
  /** Runtime infrastructure, declared or discovered from IaC. */
  infrastructure?: Array<{
    id: string;
    name: string;
    kind: string;
    note?: string;
    origin: string;
    /** Zone ids that use it. */
    consumers: string[];
  }>;
  meta: {
    project: string;
    analyzedAt: string;
    gitBranch?: string;
    gitSha?: string;
    origin: "sourcevision" | "scan";
    totalFiles: number;
    totalLines: number;
    /** Source-specific caveats prepended to the standing gap list. */
    extraGaps?: string[];
  };
  /** Base URL for source links, e.g. https://github.com/o/r/blob/main. */
  linkBase?: string;
  /**
   * Areas over the zones (`zones.json` `areas`). With two or more, the model's
   * top level draws areas and each area gets its own zone scene.
   */
  areas?: Array<{ id: string; name: string; zones: string[] }>;
}

export interface IsoModelOptions {
  /** Cap on rendered zones; the largest by file count win. Default 40. */
  maxNodes?: number;
  /** Include shared third-party packages as a leading column. Default true. */
  includeExternals?: boolean;
  /** Cap on external nodes. Default 5. */
  maxExternals?: number;
  /** Minimum consuming zones before an external earns a node. Default 2. */
  minExternalConsumers?: number;
}

// ── Palette ─────────────────────────────────────────────────────────────────

export const ISO_KINDS: IsoKindMeta[] = [
  { id: "entry", label: "Entry points", color: "#4F9BE8", glyph: "▶" },
  { id: "logic", label: "Business logic", color: "#7FAE33", glyph: "◆" },
  { id: "data", label: "Data & schema", color: "#C06BD4", glyph: "▤" },
  { id: "ui", label: "User interface", color: "#E0A33E", glyph: "▣" },
  { id: "gateway", label: "Gateways", color: "#3FB6A8", glyph: "⇄" },
  { id: "support", label: "Support & config", color: "#6F7BA6", glyph: "○" },
  { id: "tests", label: "Tests", color: "#4E5B78", glyph: "✓" },
  { id: "external", label: "Outside the codebase", color: "#7C879B", glyph: "◇" },
  { id: "infra", label: "Runtime infrastructure", color: "#B0668A", glyph: "▥" },
];

const KIND_IDS = new Set<string>(ISO_KINDS.map((k) => k.id));

/** Narrow an arbitrary string to a known kind, defaulting to support. */
export function asKind(value: string | undefined): IsoKind {
  return value && KIND_IDS.has(value) ? (value as IsoKind) : "support";
}

// ── Geometry constants ──────────────────────────────────────────────────────

const GAP_U = 5;
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Zone kind from its files' kind hints.
 *
 * Kinds are resolved per file and then counted, rather than picking a dominant
 * archetype and mapping that afterwards. The difference matters: a zone of 20
 * utilities, 12 services and 10 middleware is mostly business logic (22) even
 * though "utility" is the single most common label (20). Counting after the
 * mapping answers "what does this zone do"; counting before answers "what is
 * its most common file type", which is not the question the colour is asking.
 */
export function resolveZoneKind(kindCounts: Map<IsoKind, number>, totalFiles: number): IsoKind {
  // Test files usually carry a generic label, so a majority-test zone wins
  // outright — otherwise a test-heavy repo reads as infrastructure.
  const tests = kindCounts.get("tests") ?? 0;
  if (tests * 2 > totalFiles) return "tests";

  let best: IsoKind = "support";
  let bestCount = -1;
  // Iterate the palette in order so ties resolve deterministically.
  for (const meta of ISO_KINDS) {
    const count = kindCounts.get(meta.id) ?? 0;
    if (count > bestCount) {
      best = meta.id;
      bestCount = count;
    }
  }
  return bestCount <= 0 ? "support" : best;
}

// ── Model construction ──────────────────────────────────────────────────────

/**
 * Build the map model. With areas, the top level draws one block per area
 * (its zones as tiles, edges aggregated between areas) and `scenes` holds one
 * zone-level model per area; otherwise zones are drawn directly.
 */
export function buildIsoModel(input: IsoModelInput, options: IsoModelOptions = {}): IsoModel {
  const areas = (input.areas ?? []).filter((a) => a.zones.length > 0);
  if (areas.length < 2) return buildZoneIsoModel(input, options);

  const zoneById = new Map(input.zones.map((z) => [z.id, z]));
  const areaOf = new Map<string, string>();
  for (const a of areas) for (const id of a.zones) areaOf.set(id, a.id);
  const mapId = (id: string) => areaOf.get(id);

  const areaZones: IsoZoneInput[] = areas.map((a) => {
    const members = a.zones.map((id) => zoneById.get(id)).filter((z): z is IsoZoneInput => Boolean(z));
    const files = members.flatMap((z) => z.files);
    const weigh = (pick: (z: IsoZoneInput) => number) =>
      files.length > 0 ? members.reduce((n, z) => n + pick(z) * z.files.length, 0) / files.length : 0;
    return {
      id: a.id,
      name: a.name,
      description: `${members.length} zone${members.length === 1 ? "" : "s"}: ${members
        .slice().sort((x, y) => y.files.length - x.files.length).slice(0, 6).map((z) => z.name).join(", ")}${members.length > 6 ? ", …" : ""}.`,
      files,
      entryPoints: members.flatMap((z) => z.entryPoints).slice(0, 12),
      cohesion: Math.round(weigh((z) => z.cohesion) * 100) / 100,
      coupling: Math.round(weigh((z) => z.coupling) * 100) / 100,
      insights: [],
      children: members.map((z) => ({ id: z.id, name: z.name, files: z.files.length })),
    };
  });

  const liftPairs = <T extends { fromZone: string; toZone: string }>(items: T[]): T[] =>
    items.flatMap((c) => {
      const from = mapId(c.fromZone), to = mapId(c.toZone);
      return from && to && from !== to ? [{ ...c, fromZone: from, toZone: to }] : [];
    });
  const callTotals = new Map<string, { fromZone: string; toZone: string; weight: number }>();
  for (const c of liftPairs(input.callEdges ?? [])) {
    const k = `${c.fromZone}\u0001${c.toZone}`;
    const t = callTotals.get(k);
    if (t) t.weight += c.weight;
    else callTotals.set(k, { ...c });
  }

  const areaInput: IsoModelInput = {
    ...input,
    zones: areaZones,
    crossings: liftPairs(input.crossings),
    callEdges: [...callTotals.values()],
    external: input.external.map((e) => ({ ...e, importedBy: [...new Set(e.importedBy.map((id) => mapId(id) ?? id))] })),
    findings: input.findings.flatMap((f) => (mapId(f.scope) ? [{ ...f, scope: mapId(f.scope)! }] : [])),
    seams: liftPairs(input.seams ?? []),
    infrastructure: (input.infrastructure ?? []).map((i) => ({ ...i, consumers: [...new Set(i.consumers.map((id) => mapId(id) ?? id))] })),
    areas: undefined,
  };
  const root = buildZoneIsoModel(areaInput, { ...options, maxNodes: Math.max(areas.length, options.maxNodes ?? 40) });
  root.level = "areas";
  root.meta.totalZones = input.zones.filter((z) => z.files.length > 0).length;

  const scenes: Record<string, IsoModel> = {};
  for (const a of areas) {
    const ids = new Set(a.zones);
    const scene = buildZoneIsoModel(
      {
        ...input,
        zones: input.zones.filter((z) => ids.has(z.id)),
        crossings: input.crossings.filter((c) => ids.has(c.fromZone) && ids.has(c.toZone)),
        callEdges: (input.callEdges ?? []).filter((c) => ids.has(c.fromZone) && ids.has(c.toZone)),
        external: input.external.map((e) => ({ ...e, importedBy: e.importedBy.filter((id) => ids.has(id)) })),
        findings: input.findings.filter((f) => ids.has(f.scope)),
        seams: (input.seams ?? []).filter((c) => ids.has(c.fromZone) && ids.has(c.toZone)),
        infrastructure: (input.infrastructure ?? []).map((i) => ({ ...i, consumers: i.consumers.filter((id) => ids.has(id)) })),
        areas: undefined,
      },
      options,
    );
    scene.level = "zones";
    scene.scene = { id: a.id, name: a.name };
    scenes[a.id] = scene;
  }
  root.scenes = scenes;
  return root;
}

function buildZoneIsoModel(input: IsoModelInput, options: IsoModelOptions = {}): IsoModel {
  const maxNodes = options.maxNodes ?? 40;
  const includeExternals = options.includeExternals ?? true;
  const maxExternals = options.maxExternals ?? 5;
  const minExternalConsumers = options.minExternalConsumers ?? 2;

  const { files, meta } = input;

  // ── Select zones ──────────────────────────────────────────────────────────

  const candidates = input.zones.filter((z) => z.files.length > 0);
  const ranked = [...candidates].sort(
    (a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id),
  );
  const selected = ranked.slice(0, maxNodes);
  const omitted = ranked.slice(maxNodes).map((z) => z.name);
  const selectedIds = new Set(selected.map((z) => z.id));
  const zoneById = new Map(selected.map((z) => [z.id, z]));

  // ── Zone aggregates ───────────────────────────────────────────────────────

  interface Agg {
    lines: number;
    routes: number;
    kinds: Map<IsoKind, number>;
    labels: Map<string, number>;
  }
  const aggById = new Map<string, Agg>();

  for (const zone of selected) {
    const agg: Agg = { lines: 0, routes: 0, kinds: new Map(), labels: new Map() };
    for (const path of zone.files) {
      const file = files.get(path);
      if (!file) continue;
      agg.lines += file.lineCount;
      agg.routes += file.routes ?? 0;
      agg.kinds.set(file.kind, (agg.kinds.get(file.kind) ?? 0) + 1);
      const label = file.label ?? file.kind;
      agg.labels.set(label, (agg.labels.get(label) ?? 0) + 1);
    }
    aggById.set(zone.id, agg);
  }

  // ── Aggregate cross-zone edges ────────────────────────────────────────────

  // Keyed on a tab, which cannot appear in a zone id, so the pair is recovered
  // from the stored value rather than by splitting the key back apart.
  const edgeWeights = new Map<string, { from: string; to: string; weight: number }>();
  for (const crossing of input.crossings) {
    const { fromZone, toZone } = crossing;
    if (fromZone === toZone) continue;
    if (!selectedIds.has(fromZone) || !selectedIds.has(toZone)) continue;
    const key = `${fromZone}\t${toZone}`;
    const existing = edgeWeights.get(key);
    if (existing) existing.weight += 1;
    else edgeWeights.set(key, { from: fromZone, to: toZone, weight: 1 });
  }

  const callWeights = new Map<string, number>();
  for (const call of input.callEdges ?? []) {
    if (call.fromZone === call.toZone) continue;
    if (!selectedIds.has(call.fromZone) || !selectedIds.has(call.toZone)) continue;
    const key = `${call.fromZone}\t${call.toZone}`;
    callWeights.set(key, (callWeights.get(key) ?? 0) + call.weight);
    // A runtime call across a boundary is a real relationship even when no
    // import resolves it — dependency injection is exactly this shape.
    if (!edgeWeights.has(key)) {
      edgeWeights.set(key, { from: call.fromZone, to: call.toZone, weight: 0 });
    }
  }

  const rawEdges = [...edgeWeights.values()].sort(
    (a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );

  // ── Layer assignment ──────────────────────────────────────────────────────

  const layerById = assignLayers(selected.map((z) => z.id), rawEdges);

  // ── Externals occupy a leading column ─────────────────────────────────────

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
    const scored = input.external
      .map((ext) => {
        const consumers = new Set<string>();
        for (const importer of ext.importedBy) {
          const zoneId = zoneOfFile.get(importer);
          if (zoneId) consumers.add(zoneId);
        }
        return { pkg: ext.package, consumers: [...consumers].sort() };
      })
      .filter((e) => e.consumers.length >= minExternalConsumers)
      .sort((a, b) => b.consumers.length - a.consumers.length || a.pkg.localeCompare(b.pkg))
      .slice(0, maxExternals);

    for (const entry of scored) {
      externalPicks.push({ id: `ext:${entry.pkg}`, name: entry.pkg, consumers: entry.consumers });
    }
  }

  const layerShift = externalPicks.length > 0 ? 1 : 0;

  // ── Node assembly ─────────────────────────────────────────────────────────

  const lineValues = selected.map((z) => aggById.get(z.id)!.lines);
  const minLines = lineValues.length ? Math.min(...lineValues) : 0;
  const maxLines = lineValues.length ? Math.max(...lineValues) : 0;

  const findingsByZone = new Map<string, Array<{ text: string; severity: string }>>();
  for (const finding of input.findings) {
    if (!selectedIds.has(finding.scope)) continue;
    const list = findingsByZone.get(finding.scope) ?? [];
    list.push({ text: finding.text, severity: finding.severity ?? "info" });
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
    const fileCount = zone.files.length;

    nodes.push({
      id: zone.id,
      name: zone.name,
      kind: resolveZoneKind(agg.kinds, fileCount),
      col: (layerById.get(zone.id) ?? 0) + layerShift,
      row: 0,
      u: 0,
      v: 0,
      w: clamp(Math.round(Math.sqrt(fileCount) * 1.4), MIN_W, MAX_W),
      d: clamp(Math.round(Math.sqrt(fileCount) * 1.0), MIN_D, MAX_D),
      h: scaleHeight(agg.lines, minLines, maxLines),
      stage: "",
      sub: `${formatCount(fileCount)} files · ${formatCount(agg.lines)} lines`,
      body: zone.description,
      metrics: {
        files: fileCount,
        lines: agg.lines,
        cohesion: zone.cohesion,
        coupling: zone.coupling,
        riskLevel: zone.riskLevel ?? "unscored",
        routes: agg.routes,
      },
      mix: [...agg.labels.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6),
      keyFiles: pickKeyFiles(zone, files, input.linkBase),
      insights: zone.insights ?? [],
      findings: (findingsByZone.get(zone.id) ?? []).slice(0, 8),
      inbound: (inboundById.get(zone.id) ?? []).slice(0, 8),
      outbound: (outboundById.get(zone.id) ?? []).slice(0, 8),
    });
    const node = nodes[nodes.length - 1];
    const tiles = zone.children?.length ? layoutTiles(zone.children, node.w, node.d) : [];
    if (tiles.length > 0) node.tiles = tiles;
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
      metrics: { files: 0, lines: 0, cohesion: 0, coupling: 0, riskLevel: "unscored", routes: 0 },
      mix: [],
      keyFiles: [],
      insights: [],
      findings: [],
      inbound: [],
      outbound: consumerNames.map((name, i) => ({ id: ext.consumers[i], name, weight: 1 })),
    });
  }

  // ── Declared runtime infrastructure ───────────────────────────────────────

  // Infrastructure sits downstream of everything: zones talk to it, never the
  // reverse. It goes in a trailing column so the reading order stays
  // "dependencies, code, the things the code talks to".
  const maxZoneCol = nodes.reduce((max, n) => Math.max(max, n.col), 0);
  const infraNodes: IsoNode[] = [];
  const infraEdges: Array<{ from: string; to: string }> = [];

  for (const infra of input.infrastructure ?? []) {
    const consumers = infra.consumers.filter((id) => selectedIds.has(id));
    if (consumers.length === 0) continue; // nothing on the map uses it
    infraNodes.push({
      id: infra.id,
      name: infra.name,
      kind: "infra",
      col: maxZoneCol + 1,
      row: 0,
      u: 0,
      v: 0,
      w: MIN_W,
      d: MIN_D,
      h: MIN_H + 0.6,
      stage: "",
      sub: `${infra.kind} · used by ${consumers.length} ${consumers.length === 1 ? "zone" : "zones"}`,
      body:
        (infra.note ? `${infra.note}. ` : "") +
        (infra.origin === "config"
          ? "Declared in .n-dx.json — this relationship was asserted by a person, not inferred from the code."
          : `Discovered in ${infra.origin}. Zones are attributed by finding its name in their source, which is weaker evidence than an import.`),
      metrics: { files: 0, lines: 0, cohesion: 0, coupling: 0, riskLevel: "unscored", routes: 0 },
      mix: [],
      keyFiles: [],
      insights: [],
      findings: [],
      inbound: consumers.map((id) => ({ id, name: zoneById.get(id)!.name, weight: 1 })),
      outbound: [],
    });
    for (const id of consumers) infraEdges.push({ from: id, to: infra.id });
  }
  nodes.push(...infraNodes);

  // ── Placement ─────────────────────────────────────────────────────────────

  orderRows(nodes, [...rawEdges, ...infraEdges]);
  wrapTallColumns(nodes);
  const lanes = placeOnGrid(nodes);

  const layerCount = nodes.reduce((max, n) => Math.max(max, n.col), 0) + 1;
  const layers: string[] = [];
  for (let i = 0; i < layerCount; i++) {
    // The bookend columns are not dependency layers and should not be numbered
    // as if they were: third-party leads, declared infrastructure trails.
    if (layerShift === 1 && i === 0) layers.push("Dependencies");
    else if (infraNodes.length > 0 && i === layerCount - 1) layers.push("Infrastructure");
    else layers.push(`Layer ${i - layerShift + 1}`);
  }
  for (const node of nodes) node.stage = layers[node.col];

  const bounds = computeBounds(nodes);

  // ── Edges ─────────────────────────────────────────────────────────────────

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: IsoEdge[] = [];

  rawEdges.forEach((edge, index) => {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) return;
    edges.push({
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
      calls: callWeights.get(`${edge.from}\t${edge.to}`) ?? 0,
      back: b.col <= a.col,
      points: routeEdge(a, b, bounds, lanes, index),
    });
  });

  // Declared seams: drawn in the direction control actually flows at runtime,
  // which is frequently the reverse of the import that static analysis sees.
  const seamList = (input.seams ?? []).filter(
    (s) => selectedIds.has(s.fromZone) && selectedIds.has(s.toZone) && s.fromZone !== s.toZone,
  );
  seamList.forEach((seam, i) => {
    const a = nodeById.get(seam.fromZone);
    const b = nodeById.get(seam.toZone);
    if (!a || !b) return;
    edges.push({
      from: seam.fromZone,
      to: seam.toZone,
      weight: 0,
      calls: 0,
      back: b.col <= a.col,
      seam: { callbacks: seam.callbacks ?? [], note: seam.note, verification: seam.verification },
      points: routeEdge(a, b, bounds, lanes, rawEdges.length + i),
    });
  });

  infraEdges.forEach((edge, i) => {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) return;
    edges.push({
      from: edge.from,
      to: edge.to,
      weight: 0,
      calls: 0,
      back: b.col <= a.col,
      infra: true,
      points: routeEdge(a, b, bounds, lanes, rawEdges.length + seamList.length + i),
    });
  });

  externalPicks.forEach((ext, extIndex) => {
    const a = nodeById.get(ext.id);
    if (!a) return;
    ext.consumers.forEach((consumerId, i) => {
      const b = nodeById.get(consumerId);
      if (!b) return;
      edges.push({
        from: ext.id,
        to: consumerId,
        weight: 1,
        calls: 0,
        back: b.col <= a.col,
        points: routeEdge(a, b, bounds, lanes, rawEdges.length + extIndex * 8 + i),
      });
    });
  });

  return {
    nodes,
    edges,
    kinds: ISO_KINDS,
    layers,
    bounds,
    meta: {
      project: meta.project,
      analyzedAt: meta.analyzedAt,
      gitBranch: meta.gitBranch,
      gitSha: meta.gitSha,
      origin: meta.origin,
      totalZones: candidates.length,
      shownZones: selected.length,
      totalFiles: meta.totalFiles,
      totalLines: meta.totalLines,
      omittedZones: omitted,
      hasCalls: (input.callEdges?.length ?? 0) > 0,
      seamCount: seamList.length,
      infraCount: infraNodes.length,
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
 * stack). Those edges still render — through a return lane below the scene —
 * but they must not participate in depth, or a single cycle would stretch the
 * map to the node count.
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
        backEdges.add(`${frame.id}\t${next}`);
      } else if (nextState === 0) {
        state.set(next, 1);
        stack.push({ id: next, index: 0 });
      }
    }
  }

  // Pass 2 — longest path on the remaining DAG, memoized over reverse edges.
  const incoming = new Map<string, string[]>();
  for (const id of ids) incoming.set(id, []);
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (backEdges.has(`${from}\t${to}`)) continue;
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
 * Orders nodes within each layer using a barycenter heuristic: a node sits near
 * the average row of the things that depend on it. One forward pass removes
 * most edge crossings without the cost of full Sugiyama.
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
  for (const col of [...byCol.keys()].sort((a, b) => a - b)) {
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
  const rows = preds.map((id) => rowOf.get(id)).filter((r): r is number => r !== undefined);
  if (rows.length === 0) return Number.MAX_SAFE_INTEGER; // unanchored → sort last
  return rows.reduce((sum, r) => sum + r, 0) / rows.length;
}

// ── Grid placement ──────────────────────────────────────────────────────────

/**
 * Split any column holding more rows than `max(3, ⌈√n⌉)` into several
 * adjacent columns, shifting the columns after it. A flat dependency graph
 * puts most zones in one layer, which drew as a single long diagonal of
 * specks; wrapping keeps the left-to-right layer order and makes it a block.
 */
export function wrapTallColumns(nodes: IsoNode[]): void {
  const maxRows = Math.max(3, Math.ceil(Math.sqrt(nodes.length)));
  // Group by the original column before renumbering anything.
  const byCol = new Map<number, IsoNode[]>();
  for (const n of nodes) {
    let list = byCol.get(n.col);
    if (!list) byCol.set(n.col, (list = []));
    list.push(n);
  }
  let shift = 0;
  for (const col of [...byCol.keys()].sort((a, b) => a - b)) {
    const inCol = byCol.get(col)!.sort((a, b) => a.row - b.row);
    const parts = Math.ceil(inCol.length / maxRows);
    inCol.forEach((n, i) => {
      n.col = col + shift + Math.floor(i / maxRows);
      n.row = i % maxRows;
    });
    shift += parts - 1;
  }
}

/**
 * Converts (col, row) slots into grid coordinates and returns the free
 * horizontal corridors between rows.
 *
 * Column widths and row depths are sized to the largest box occupying them, so
 * boxes never overlap however lopsided the zone sizes are. The corridors are
 * the empty strips between rows — edge routing uses them to cross the scene
 * without cutting through blocks.
 */
function placeOnGrid(nodes: IsoNode[]): number[] {
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
  const lanes: number[] = [round2(-GAP_V / 2)]; // corridor above the first row
  let v = 0;
  for (const row of [...rowDepth.keys()].sort((a, b) => a - b)) {
    rowOffset.set(row, v);
    v += rowDepth.get(row)!;
    lanes.push(round2(v + GAP_V / 2)); // corridor after this row
    v += GAP_V;
  }

  for (const node of nodes) {
    node.u = colOffset.get(node.col)!;
    node.v = rowOffset.get(node.row)!;
  }

  return lanes;
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

/** The free corridor nearest a target v coordinate. */
function nearestLane(lanes: number[], target: number): number {
  if (lanes.length === 0) return target;
  let best = lanes[0];
  for (const lane of lanes) {
    if (Math.abs(lane - target) < Math.abs(best - target)) best = lane;
  }
  return best;
}

/**
 * Orthogonal route between two boxes, in grid units.
 *
 * Adjacent layers are joined directly through the inter-column gap, which is
 * empty by construction. An edge spanning more than one layer would otherwise
 * cut straight through whatever sits in between, so it detours into a free
 * corridor between rows, runs the distance there, and comes back — the whole
 * long leg stays in empty space. Back edges (cycles, and same-layer links) drop
 * below the scene into a shared return lane so they read as exceptions.
 *
 * `index` only nudges parallel routes apart so overlapping edges stay legible.
 */
export function routeEdge(
  a: IsoNode,
  b: IsoNode,
  bounds: IsoModel["bounds"],
  lanes: number[] = [],
  index = 0,
): Array<[number, number]> {
  const av = round2(a.v + a.d / 2);
  const bv = round2(b.v + b.d / 2);

  if (b.col > a.col) {
    const exit = a.u + a.w;
    const entry = b.u;

    // Adjacent columns: the gap between them is empty, cross it directly.
    if (b.col === a.col + 1) {
      if (av === bv) return [[exit, av], [entry, bv]];
      const mid = round2(exit + (entry - exit) / 2);
      return [[exit, av], [mid, av], [mid, bv], [entry, bv]];
    }

    // Spanning layers: travel in a corridor between rows rather than through
    // whatever occupies the columns in between.
    const jog = round2(exit + GAP_U / 2);
    const back = round2(entry - GAP_U / 2);
    const lane = round2(nearestLane(lanes, (av + bv) / 2) + (index % 3) * 0.3);
    if (lane === av && lane === bv) return [[exit, av], [entry, bv]];
    return [
      [exit, av],
      [jog, av],
      [jog, lane],
      [back, lane],
      [back, bv],
      [entry, bv],
    ];
  }

  // Return lane below the scene, keyed off the row so routes for adjacent rows
  // do not stack on the same line.
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

function pickKeyFiles(
  zone: IsoZoneInput,
  files: Map<string, IsoFileInput>,
  linkBase?: string,
): IsoKeyFile[] {
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
      (a, b) => (files.get(b)?.lineCount ?? 0) - (files.get(a)?.lineCount ?? 0) || a.localeCompare(b),
    );

  for (const file of bySize) {
    if (picked.length >= 8) break;
    picked.push(file);
  }

  const base = linkBase?.replace(/\/$/, "");
  return picked.map((path) => (base ? { path, url: `${base}/${path}` } : { path }));
}

/**
 * What the map cannot show.
 *
 * Data-driven rather than a fixed string: the list shrinks as the underlying
 * analysis gains the corresponding signal, so the rendered map always states
 * its own honest limits. See docs/architecture/iso-map-data-flow.md.
 */
function describeGaps(input: IsoModelInput): string[] {
  const gaps: string[] = [...(input.meta.extraGaps ?? [])];

  if ((input.callEdges?.length ?? 0) > 0) {
    gaps.push(
      "Connectors carry both import counts and runtime call counts. Calls are closer to real behaviour, but they are still resolved statically — a dispatch through a variable or a string key is not counted.",
    );
  } else {
    gaps.push(
      'Edges are static import relationships, not runtime data flow. A drawn edge means "this zone imports that one", not "a request travels this way".',
    );
  }

  const infraCount = (input.infrastructure ?? []).length;
  if (infraCount > 0) {
    gaps.push(
      "Runtime infrastructure is shown from declarations, not detection: entries in .n-dx.json and resources found in Terraform or CloudFormation. A queue nobody declared is still invisible, and a zone is attributed to a resource by naming it in source, which is weaker evidence than an import.",
    );
  } else {
    gaps.push(
      "Runtime infrastructure — queues, caches, buckets, databases, cron — has no static signature and is absent. Declare it under sourcevision.isoMap.infrastructure in .n-dx.json, or add Terraform or CloudFormation, and it will be drawn.",
    );
  }

  const seamCount = (input.seams ?? []).length;
  if (seamCount > 0) {
    gaps.push(
      "Import edges follow build-time direction. Declared injection seams are drawn separately in the direction control flows at runtime — but only the seams somebody wrote down; an undeclared one still points the wrong way.",
    );
  } else {
    gaps.push(
      "Edge direction follows imports. A callback or event seam inverts control at runtime and will appear pointing the wrong way. Declare it under sourcevision.isoMap.injectionSeams in .n-dx.json to draw the runtime direction.",
    );
  }

  return gaps;
}
