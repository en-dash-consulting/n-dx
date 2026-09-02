#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Built from packages/sourcevision/src/export/ by scripts/build-iso-skill.mjs.
// Edit the TypeScript sources and re-run:
//
//     node scripts/build-iso-skill.mjs
//
// tests/e2e/iso-skill-drift.test.js fails if this file is out of date.
// ─────────────────────────────────────────────────────────────────────────────
// packages/sourcevision/src/export/iso-standalone.ts
import { writeFileSync, existsSync as existsSync4 } from "node:fs";
import { resolve as resolve3, join as join4, dirname as dirname2 } from "node:path";

// packages/sourcevision/src/export/iso-model.ts
var ISO_KINDS = [
  { id: "entry", label: "Entry points", color: "#4F9BE8", glyph: "▶" },
  { id: "logic", label: "Business logic", color: "#7FAE33", glyph: "◆" },
  { id: "data", label: "Data & schema", color: "#C06BD4", glyph: "▤" },
  { id: "ui", label: "User interface", color: "#E0A33E", glyph: "▣" },
  { id: "gateway", label: "Gateways", color: "#3FB6A8", glyph: "⇄" },
  { id: "support", label: "Support & config", color: "#6F7BA6", glyph: "○" },
  { id: "tests", label: "Tests", color: "#4E5B78", glyph: "✓" },
  { id: "external", label: "Outside the codebase", color: "#7C879B", glyph: "◇" },
  { id: "infra", label: "Runtime infrastructure", color: "#B0668A", glyph: "▥" }
];
var KIND_IDS = new Set(ISO_KINDS.map((k) => k.id));
function asKind(value) {
  return value && KIND_IDS.has(value) ? value : "support";
}
var GAP_U = 5;
var GAP_V = 2;
var MIN_W = 3;
var MAX_W = 9;
var MIN_D = 3;
var MAX_D = 7;
var MIN_H = 1.2;
var MAX_H = 6.5;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
function formatCount(n) {
  return n.toLocaleString("en-US");
}
function resolveZoneKind(kindCounts, totalFiles) {
  const tests = kindCounts.get("tests") ?? 0;
  if (tests * 2 > totalFiles) return "tests";
  let best = "support";
  let bestCount = -1;
  for (const meta of ISO_KINDS) {
    const count = kindCounts.get(meta.id) ?? 0;
    if (count > bestCount) {
      best = meta.id;
      bestCount = count;
    }
  }
  return bestCount <= 0 ? "support" : best;
}
function buildIsoModel(input, options = {}) {
  const maxNodes = options.maxNodes ?? 40;
  const includeExternals = options.includeExternals ?? true;
  const maxExternals = options.maxExternals ?? 5;
  const minExternalConsumers = options.minExternalConsumers ?? 2;
  const { files, meta } = input;
  const candidates = input.zones.filter((z) => z.files.length > 0);
  const ranked = [...candidates].sort(
    (a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id)
  );
  const selected = ranked.slice(0, maxNodes);
  const omitted = ranked.slice(maxNodes).map((z) => z.name);
  const selectedIds = new Set(selected.map((z) => z.id));
  const zoneById = new Map(selected.map((z) => [z.id, z]));
  const aggById = /* @__PURE__ */ new Map();
  for (const zone of selected) {
    const agg = { lines: 0, routes: 0, kinds: /* @__PURE__ */ new Map(), labels: /* @__PURE__ */ new Map() };
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
  const edgeWeights = /* @__PURE__ */ new Map();
  for (const crossing of input.crossings) {
    const { fromZone, toZone } = crossing;
    if (fromZone === toZone) continue;
    if (!selectedIds.has(fromZone) || !selectedIds.has(toZone)) continue;
    const key = `${fromZone}	${toZone}`;
    const existing = edgeWeights.get(key);
    if (existing) existing.weight += 1;
    else edgeWeights.set(key, { from: fromZone, to: toZone, weight: 1 });
  }
  const callWeights = /* @__PURE__ */ new Map();
  for (const call of input.callEdges ?? []) {
    if (call.fromZone === call.toZone) continue;
    if (!selectedIds.has(call.fromZone) || !selectedIds.has(call.toZone)) continue;
    const key = `${call.fromZone}	${call.toZone}`;
    callWeights.set(key, (callWeights.get(key) ?? 0) + call.weight);
    if (!edgeWeights.has(key)) {
      edgeWeights.set(key, { from: call.fromZone, to: call.toZone, weight: 0 });
    }
  }
  const rawEdges = [...edgeWeights.values()].sort(
    (a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
  );
  const layerById = assignLayers(selected.map((z) => z.id), rawEdges);
  const zoneOfFile = /* @__PURE__ */ new Map();
  for (const zone of selected) {
    for (const file of zone.files) zoneOfFile.set(file, zone.id);
  }
  const externalPicks = [];
  if (includeExternals) {
    const scored = input.external.map((ext) => {
      const consumers = /* @__PURE__ */ new Set();
      for (const importer of ext.importedBy) {
        const zoneId = zoneOfFile.get(importer);
        if (zoneId) consumers.add(zoneId);
      }
      return { pkg: ext.package, consumers: [...consumers].sort() };
    }).filter((e) => e.consumers.length >= minExternalConsumers).sort((a, b) => b.consumers.length - a.consumers.length || a.pkg.localeCompare(b.pkg)).slice(0, maxExternals);
    for (const entry of scored) {
      externalPicks.push({ id: `ext:${entry.pkg}`, name: entry.pkg, consumers: entry.consumers });
    }
  }
  const layerShift = externalPicks.length > 0 ? 1 : 0;
  const lineValues = selected.map((z) => aggById.get(z.id).lines);
  const minLines = lineValues.length ? Math.min(...lineValues) : 0;
  const maxLines = lineValues.length ? Math.max(...lineValues) : 0;
  const findingsByZone = /* @__PURE__ */ new Map();
  for (const finding of input.findings) {
    if (!selectedIds.has(finding.scope)) continue;
    const list = findingsByZone.get(finding.scope) ?? [];
    list.push({ text: finding.text, severity: finding.severity ?? "info" });
    findingsByZone.set(finding.scope, list);
  }
  const inboundById = /* @__PURE__ */ new Map();
  const outboundById = /* @__PURE__ */ new Map();
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
  const nodes = [];
  for (const zone of selected) {
    const agg = aggById.get(zone.id);
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
      d: clamp(Math.round(Math.sqrt(fileCount) * 1), MIN_D, MAX_D),
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
        routes: agg.routes
      },
      mix: [...agg.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6),
      keyFiles: pickKeyFiles(zone, files, input.linkBase),
      insights: zone.insights ?? [],
      findings: (findingsByZone.get(zone.id) ?? []).slice(0, 8),
      inbound: (inboundById.get(zone.id) ?? []).slice(0, 8),
      outbound: (outboundById.get(zone.id) ?? []).slice(0, 8)
    });
  }
  for (const ext of externalPicks) {
    const consumerNames = ext.consumers.map((id) => zoneById.get(id)?.name).filter((n) => Boolean(n));
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
      outbound: consumerNames.map((name, i) => ({ id: ext.consumers[i], name, weight: 1 }))
    });
  }
  const maxZoneCol = nodes.reduce((max, n) => Math.max(max, n.col), 0);
  const infraNodes = [];
  const infraEdges = [];
  for (const infra of input.infrastructure ?? []) {
    const consumers = infra.consumers.filter((id) => selectedIds.has(id));
    if (consumers.length === 0) continue;
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
      body: (infra.note ? `${infra.note}. ` : "") + (infra.origin === "config" ? "Declared in .n-dx.json — this relationship was asserted by a person, not inferred from the code." : `Discovered in ${infra.origin}. Zones are attributed by finding its name in their source, which is weaker evidence than an import.`),
      metrics: { files: 0, lines: 0, cohesion: 0, coupling: 0, riskLevel: "unscored", routes: 0 },
      mix: [],
      keyFiles: [],
      insights: [],
      findings: [],
      inbound: consumers.map((id) => ({ id, name: zoneById.get(id).name, weight: 1 })),
      outbound: []
    });
    for (const id of consumers) infraEdges.push({ from: id, to: infra.id });
  }
  nodes.push(...infraNodes);
  orderRows(nodes, [...rawEdges, ...infraEdges]);
  const lanes = placeOnGrid(nodes);
  const layerCount = nodes.reduce((max, n) => Math.max(max, n.col), 0) + 1;
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    if (layerShift === 1 && i === 0) layers.push("Dependencies");
    else if (infraNodes.length > 0 && i === layerCount - 1) layers.push("Infrastructure");
    else layers.push(`Layer ${i - layerShift + 1}`);
  }
  for (const node of nodes) node.stage = layers[node.col];
  const bounds = computeBounds(nodes);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  rawEdges.forEach((edge, index) => {
    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);
    if (!a || !b) return;
    edges.push({
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
      calls: callWeights.get(`${edge.from}	${edge.to}`) ?? 0,
      back: b.col <= a.col,
      points: routeEdge(a, b, bounds, lanes, index)
    });
  });
  const seamList = (input.seams ?? []).filter(
    (s) => selectedIds.has(s.fromZone) && selectedIds.has(s.toZone) && s.fromZone !== s.toZone
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
      seam: { callbacks: seam.callbacks ?? [], note: seam.note },
      points: routeEdge(a, b, bounds, lanes, rawEdges.length + i)
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
      points: routeEdge(a, b, bounds, lanes, rawEdges.length + seamList.length + i)
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
        points: routeEdge(a, b, bounds, lanes, rawEdges.length + extIndex * 8 + i)
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
      gaps: describeGaps(input)
    }
  };
}
function assignLayers(nodeIds, edges) {
  const ids = [...nodeIds].sort();
  const adjacency = /* @__PURE__ */ new Map();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    if (edge.from === edge.to) continue;
    adjacency.get(edge.from).push(edge.to);
  }
  for (const list of adjacency.values()) list.sort();
  const backEdges = /* @__PURE__ */ new Set();
  const state = /* @__PURE__ */ new Map();
  for (const id of ids) state.set(id, 0);
  for (const root of ids) {
    if (state.get(root) !== 0) continue;
    const stack = [{ id: root, index: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbours = adjacency.get(frame.id);
      if (frame.index >= neighbours.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const next = neighbours[frame.index++];
      const nextState = state.get(next);
      if (nextState === 1) {
        backEdges.add(`${frame.id}	${next}`);
      } else if (nextState === 0) {
        state.set(next, 1);
        stack.push({ id: next, index: 0 });
      }
    }
  }
  const incoming = /* @__PURE__ */ new Map();
  for (const id of ids) incoming.set(id, []);
  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      if (backEdges.has(`${from}	${to}`)) continue;
      incoming.get(to).push(from);
    }
  }
  const layer = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  function depth(id) {
    const cached = layer.get(id);
    if (cached !== void 0) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const from of incoming.get(id)) {
      best = Math.max(best, depth(from) + 1);
    }
    visiting.delete(id);
    layer.set(id, best);
    return best;
  }
  for (const id of ids) depth(id);
  return layer;
}
function orderRows(nodes, edges) {
  const byCol = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const list = byCol.get(node.col) ?? [];
    list.push(node);
    byCol.set(node.col, list);
  }
  const predecessors = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const list = predecessors.get(edge.to) ?? [];
    list.push(edge.from);
    predecessors.set(edge.to, list);
  }
  const rowOf = /* @__PURE__ */ new Map();
  for (const col of [...byCol.keys()].sort((a, b) => a - b)) {
    const layer = byCol.get(col);
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
function barycenter(node, predecessors, rowOf) {
  const preds = predecessors.get(node.id) ?? [];
  const rows = preds.map((id) => rowOf.get(id)).filter((r) => r !== void 0);
  if (rows.length === 0) return Number.MAX_SAFE_INTEGER;
  return rows.reduce((sum, r) => sum + r, 0) / rows.length;
}
function placeOnGrid(nodes) {
  const colWidth = /* @__PURE__ */ new Map();
  const rowDepth = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    colWidth.set(node.col, Math.max(colWidth.get(node.col) ?? 0, node.w));
    rowDepth.set(node.row, Math.max(rowDepth.get(node.row) ?? 0, node.d));
  }
  const colOffset = /* @__PURE__ */ new Map();
  let u = 0;
  for (const col of [...colWidth.keys()].sort((a, b) => a - b)) {
    colOffset.set(col, u);
    u += colWidth.get(col) + GAP_U;
  }
  const rowOffset = /* @__PURE__ */ new Map();
  const lanes = [round2(-GAP_V / 2)];
  let v = 0;
  for (const row of [...rowDepth.keys()].sort((a, b) => a - b)) {
    rowOffset.set(row, v);
    v += rowDepth.get(row);
    lanes.push(round2(v + GAP_V / 2));
    v += GAP_V;
  }
  for (const node of nodes) {
    node.u = colOffset.get(node.col);
    node.v = rowOffset.get(node.row);
  }
  return lanes;
}
function computeBounds(nodes) {
  if (nodes.length === 0) return { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
  let uMax = 0;
  let vMax = 0;
  for (const node of nodes) {
    uMax = Math.max(uMax, node.u + node.w);
    vMax = Math.max(vMax, node.v + node.d);
  }
  return { uMin: 0, uMax, vMin: 0, vMax };
}
function nearestLane(lanes, target) {
  if (lanes.length === 0) return target;
  let best = lanes[0];
  for (const lane of lanes) {
    if (Math.abs(lane - target) < Math.abs(best - target)) best = lane;
  }
  return best;
}
function routeEdge(a, b, bounds, lanes = [], index = 0) {
  const av = round2(a.v + a.d / 2);
  const bv = round2(b.v + b.d / 2);
  if (b.col > a.col) {
    const exit = a.u + a.w;
    const entry = b.u;
    if (b.col === a.col + 1) {
      if (av === bv) return [[exit, av], [entry, bv]];
      const mid = round2(exit + (entry - exit) / 2);
      return [[exit, av], [mid, av], [mid, bv], [entry, bv]];
    }
    const jog = round2(exit + GAP_U / 2);
    const back = round2(entry - GAP_U / 2);
    const lane2 = round2(nearestLane(lanes, (av + bv) / 2) + index % 3 * 0.3);
    if (lane2 === av && lane2 === bv) return [[exit, av], [entry, bv]];
    return [
      [exit, av],
      [jog, av],
      [jog, lane2],
      [back, lane2],
      [back, bv],
      [entry, bv]
    ];
  }
  const lane = round2(bounds.vMax + 2 + a.row % 3 * 0.8);
  const ax = round2(a.u + a.w / 2);
  const bx = round2(b.u + b.w / 2);
  return [
    [ax, a.v + a.d],
    [ax, lane],
    [bx, lane],
    [bx, b.v + b.d]
  ];
}
function scaleHeight(lines, minLines, maxLines) {
  if (maxLines <= 0) return MIN_H;
  const lo = Math.log10(Math.max(minLines, 1) + 1);
  const hi = Math.log10(Math.max(maxLines, 1) + 1);
  if (hi - lo < 1e-9) return round2((MIN_H + MAX_H) / 2);
  const t = (Math.log10(Math.max(lines, 1) + 1) - lo) / (hi - lo);
  return round2(MIN_H + clamp(t, 0, 1) * (MAX_H - MIN_H));
}
function pickKeyFiles(zone, files, linkBase) {
  const seen = /* @__PURE__ */ new Set();
  const picked = [];
  for (const entry of zone.entryPoints.slice(0, 4)) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    picked.push(entry);
  }
  const bySize = [...zone.files].filter((f) => !seen.has(f)).sort(
    (a, b) => (files.get(b)?.lineCount ?? 0) - (files.get(a)?.lineCount ?? 0) || a.localeCompare(b)
  );
  for (const file of bySize) {
    if (picked.length >= 8) break;
    picked.push(file);
  }
  const base = linkBase?.replace(/\/$/, "");
  return picked.map((path) => base ? { path, url: `${base}/${path}` } : { path });
}
function describeGaps(input) {
  const gaps = [...input.meta.extraGaps ?? []];
  if ((input.callEdges?.length ?? 0) > 0) {
    gaps.push(
      "Connectors carry both import counts and runtime call counts. Calls are closer to real behaviour, but they are still resolved statically — a dispatch through a variable or a string key is not counted."
    );
  } else {
    gaps.push(
      'Edges are static import relationships, not runtime data flow. A drawn edge means "this zone imports that one", not "a request travels this way".'
    );
  }
  const infraCount = (input.infrastructure ?? []).length;
  if (infraCount > 0) {
    gaps.push(
      "Runtime infrastructure is shown from declarations, not detection: entries in .n-dx.json and resources found in Terraform. A queue nobody declared is still invisible, and a zone is attributed to a resource by naming it in source, which is weaker evidence than an import."
    );
  } else {
    gaps.push(
      "Runtime infrastructure — queues, caches, buckets, databases, cron — has no static signature and is absent. Declare it under sourcevision.isoMap.infrastructure in .n-dx.json, or add Terraform, and it will be drawn."
    );
  }
  const seamCount = (input.seams ?? []).length;
  if (seamCount > 0) {
    gaps.push(
      "Import edges follow build-time direction. Declared injection seams are drawn separately in the direction control flows at runtime — but only the seams somebody wrote down; an undeclared one still points the wrong way."
    );
  } else {
    gaps.push(
      "Edge direction follows imports. A callback or event seam inverts control at runtime and will appear pointing the wrong way. Declare it under sourcevision.isoMap.injectionSeams in .n-dx.json to draw the runtime direction."
    );
  }
  return gaps;
}

// packages/sourcevision/src/export/iso-map.ts
function esc(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function embedJSON(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function renderIsoMap(model, options = {}) {
  const title = options.title ?? `${model.meta.project} — architecture map`;
  const meta = model.meta;
  const stats = [
    `${meta.shownZones} of ${meta.totalZones} zones`,
    `${meta.totalFiles.toLocaleString("en-US")} files`,
    `${meta.totalLines.toLocaleString("en-US")} lines`,
    meta.origin === "sourcevision" ? "sourcevision analysis" : "direct scan"
  ];
  if (meta.gitBranch) stats.push(esc(meta.gitBranch));
  const legend = model.kinds.map(
    (k) => `<button class="lg" type="button" data-kind="${esc(k.id)}" aria-pressed="false"><i style="background:${esc(k.color)}" aria-hidden="true"></i><span class="gl" aria-hidden="true">${esc(k.glyph)}</span>${esc(k.label)}</button>`
  ).join("");
  const gaps = meta.gaps.map((g) => `<li>${esc(g)}</li>`).join("");
  const omitted = meta.omittedZones.length > 0 ? `<p class="note">${meta.omittedZones.length} smaller zones are not drawn: ${esc(meta.omittedZones.slice(0, 12).join(", "))}${meta.omittedZones.length > 12 ? ", …" : ""}. Raise <code>--max-nodes</code> to include them.</p>` : "";
  const weightToggle = meta.hasCalls ? `<button type="button" id="weight" aria-pressed="false" title="Weight connectors by runtime calls instead of imports">Weight: imports</button>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
<a class="skip" href="#dossier">Skip to details panel</a>
<header class="top">
  <div class="ttl">
    <h1>${esc(meta.project)}</h1>
    <p>${stats.map((s) => `<span>${s}</span>`).join("")}</p>
  </div>
  <div class="tools">
    ${weightToggle}
    <button type="button" id="zout" aria-label="Zoom out">&minus;</button>
    <button type="button" id="zin" aria-label="Zoom in">+</button>
    <button type="button" id="fit">Reset view</button>
  </div>
</header>

<main class="wrap">
  <section class="stage" id="stage" aria-label="Isometric architecture map">
    <svg id="iso" role="img" aria-label="Isometric map of ${esc(meta.project)} architecture zones"></svg>
    <div class="legend" role="group" aria-label="Filter by kind">${legend}</div>
  </section>
  <aside class="dossier" id="dossier" aria-live="polite" tabindex="-1" aria-label="Details">
  </aside>
</main>

<footer class="foot">
  <h2>What this map does and does not show</h2>
  <ul>${gaps}</ul>
  ${omitted}
  <p class="note">Generated ${esc(meta.analyzedAt)}${meta.gitSha ? ` at ${esc(meta.gitSha.slice(0, 8))}` : ""} by sourcevision.</p>
</footer>

<script>
(function(){
"use strict";
var MODEL = ${embedJSON(model)};
${RUNTIME}
})();
</script>
</body>
</html>
`;
}
var STYLES = `
:root{
  --bg:#12122B; --panel:#1A1940; --line:#2C2B60; --ink:#EFEFF7;
  --muted:#9B9BC4; --accent:#7FAE33; --warn:#E0A33E; --crit:#E36262;
  --chip:#232253; --chip-hover:#2C2B66;
  --ground:#171639; --gridline:#222150;
  --wire:#4A4990; --wire-hot:#7FAE33; --seam:#C9789E; --infra:#B0668A;
  --tag-bg:#1B1A45; --tag-ink:#EFEFF7; --tag-ink-on:#12122B;
  --body-ink:#D3D3E8;
}
@media (prefers-color-scheme: light){
  :root{
    --bg:#F4F5FA; --panel:#FFFFFF; --line:#D8DAE8; --ink:#1B1B33;
    --muted:#5C5F7A; --accent:#4E7A16; --warn:#9A6512; --crit:#B3352F;
    --chip:#EFF0F7; --chip-hover:#E3E5F2;
    --ground:#E7E9F5; --gridline:#D2D5E8;
    --wire:#8E93BC; --wire-hot:#4E7A16; --seam:#A2416C; --infra:#8E4467;
    --tag-bg:#FFFFFF; --tag-ink:#1B1B33; --tag-ink-on:#FFFFFF;
    --body-ink:#33344F;
  }
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
}
h1,h2,h3,h4{margin:0;font-weight:650;letter-spacing:-0.01em}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}

.skip{
  position:absolute;left:-9999px;top:0;z-index:10;padding:.5rem .8rem;
  background:var(--panel);color:var(--ink);border:1px solid var(--accent);border-radius:0 0 6px 0;
}
.skip:focus{left:0}

.top{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;
  padding:.85rem 1.15rem;border-bottom:1px solid var(--line);background:var(--panel);
}
.ttl h1{font-size:1.12rem}
.ttl p{margin:.2rem 0 0;color:var(--muted);font-size:.82rem;display:flex;gap:.5rem;flex-wrap:wrap}
.ttl p span:not(:last-child)::after{content:" ·";color:var(--line)}
.tools{display:flex;gap:.4rem}
.tools button,.lg{
  background:var(--chip);color:var(--ink);border:1px solid var(--line);border-radius:6px;
  padding:.4rem .7rem;font:inherit;font-size:.82rem;cursor:pointer;
}
.tools button:hover,.lg:hover{background:var(--chip-hover)}
.tools button[aria-pressed="true"]{border-color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.wrap{display:grid;grid-template-columns:minmax(0,1fr) 360px;min-height:calc(100vh - 60px)}
@media (max-width:1020px){.wrap{grid-template-columns:1fr}}

.stage{position:relative;overflow:hidden;cursor:grab;touch-action:none}
.stage.dragging{cursor:grabbing}
.stage svg{display:block;width:100%;height:100%;min-height:60vh}
.node,.edge{cursor:pointer}
.node polygon,.edge polyline{transition:opacity .12s ease}

/* Themed scene chrome — set here rather than as SVG attributes so the map
   follows the reader's colour-scheme preference with no scripting. */
.ground{fill:var(--ground);stroke:var(--gridline);stroke-width:1}
.grid{stroke:var(--gridline);stroke-width:1}
.wire{stroke:var(--wire);fill:none;stroke-linejoin:round;stroke-linecap:round}
.wire.hot{stroke:var(--wire-hot)}
/* Declared, not inferred: a different hue so nobody reads a human assertion
   as something the analysis proved. */
.wire.seam{stroke:var(--seam)}
.wire.infra{stroke:var(--infra)}
.tagbox{fill:var(--tag-bg)}
.tagtext{fill:var(--tag-ink)}

.legend{
  position:absolute;left:.9rem;bottom:.9rem;display:flex;flex-wrap:wrap;gap:.35rem;
  max-width:calc(100% - 1.8rem);
}
.lg{display:inline-flex;align-items:center;gap:.4rem;background:var(--panel)}
.lg i{width:11px;height:11px;border-radius:2px;display:block}
.lg .gl{font-size:.78rem;color:var(--muted);width:.9em;text-align:center}
.lg[aria-pressed="true"]{border-color:var(--accent);font-weight:650}

.dossier{
  border-left:1px solid var(--line);background:var(--panel);
  padding:1.1rem 1.15rem;overflow-y:auto;max-height:calc(100vh - 60px);
}
@media (max-width:1020px){.dossier{border-left:0;border-top:1px solid var(--line);max-height:none}}
.dossier h3{font-size:1.05rem;margin:.15rem 0 .1rem}
.dossier h4{
  font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);
  margin:1.1rem 0 .35rem;
}
.dossier .sub{color:var(--muted);font-size:.84rem}
.dossier .body{margin:.6rem 0 0;font-size:.9rem;color:var(--body-ink)}
.dossier ul{margin:.3rem 0 0;padding-left:1.05rem;font-size:.86rem;color:var(--body-ink)}
.dossier li{margin:.22rem 0}
.dossier ul.files{list-style:none;padding-left:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem}
.dossier ul.files li{overflow-wrap:anywhere;color:var(--muted)}
.dossier ul.files a{color:var(--muted)}
.kind{display:inline-flex;align-items:center;gap:.4rem;font-size:.75rem;color:var(--muted)}
.kind i{width:10px;height:10px;border-radius:2px;display:block}

.mx{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem}
.mx span{
  background:var(--chip);border:1px solid var(--line);border-radius:5px;
  padding:.2rem .45rem;font-size:.75rem;color:var(--muted);
}
.mx b{color:var(--ink);font-weight:600}
.risk-at-risk{color:var(--warn)}
.risk-critical,.risk-catastrophic{color:var(--crit)}
.sev-warning{color:var(--warn)}
.sev-critical{color:var(--crit)}
.link,.wirelink{
  background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:.86rem;
  cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:2px;
}
.wirelink{font-size:.78rem;color:var(--muted)}

.foot{border-top:1px solid var(--line);padding:1.1rem 1.15rem 2rem;background:var(--panel)}
.foot h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.foot ul{margin:.5rem 0 0;padding-left:1.05rem;max-width:75ch;font-size:.86rem;color:var(--body-ink)}
.foot li{margin:.3rem 0}
.note{color:var(--muted);font-size:.8rem;max-width:75ch;margin:.8rem 0 0}

@media (prefers-reduced-motion: reduce){
  *{transition:none !important;animation:none !important;scroll-behavior:auto !important}
}
`;
var RUNTIME = `
var NS = "http://www.w3.org/2000/svg";
var CELL = 19, CX = 0.866, CY = 0.5, CZ = 0.62;
var NODES = MODEL.nodes, EDGES = MODEL.edges, B = MODEL.bounds;
var COLOR = {}, LABEL = {}, GLYPH = {};
MODEL.kinds.forEach(function(k){ COLOR[k.id] = k.color; LABEL[k.id] = k.label; GLYPH[k.id] = k.glyph; });
var BY = {}; NODES.forEach(function(n){ BY[n.id] = n; });
var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function P(u, v, z){ return [(u - v) * CX * CELL, ((u + v) * CY - (z || 0) * CZ) * CELL]; }
function pts(a){ return a.map(function(p){ return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); }
function el(t, attrs){
  var e = document.createElementNS(NS, t);
  for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
  return e;
}
function shade(hex, amt){
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  function f(c){
    c = Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return Math.max(0, Math.min(255, c));
  }
  return "#" + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}
function esc(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function num(n){ return Number(n).toLocaleString("en-US"); }
function edgeWeight(e){ return byCalls ? e.calls : e.weight; }

/* ---------- scene ---------- */
var svg = document.getElementById("iso");
var defs = el("defs");
["wire", "wirehot"].forEach(function(name){
  var m = el("marker", {
    id: name, viewBox: "0 0 10 10", refX: "8", refY: "5",
    markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse"
  });
  var path = el("path", { d: "M0,1 L9,5 L0,9 z" });
  path.setAttribute("class", name === "wire" ? "arrow" : "arrow hot");
  path.style.fill = name === "wire" ? "var(--wire)" : "var(--wire-hot)";
  m.appendChild(path);
  defs.appendChild(m);
});
svg.appendChild(defs);

var camera = el("g", { id: "camera" });
svg.appendChild(camera);
var gGround = el("g"), gEdge = el("g"), gBlock = el("g"), gTag = el("g");
camera.appendChild(gGround); camera.appendChild(gEdge);
camera.appendChild(gBlock); camera.appendChild(gTag);

var uMin = B.uMin - 3, uMax = B.uMax + 3, vMin = B.vMin - 3, vMax = B.vMax + 5;
var ground = el("polygon", {
  points: pts([P(uMin, vMin, 0), P(uMax, vMin, 0), P(uMax, vMax, 0), P(uMin, vMax, 0)])
});
ground.setAttribute("class", "ground");
gGround.appendChild(ground);
for (var gu = uMin; gu <= uMax; gu += 4) {
  var lineU = el("line", {
    x1: P(gu, vMin, 0)[0], y1: P(gu, vMin, 0)[1],
    x2: P(gu, vMax, 0)[0], y2: P(gu, vMax, 0)[1]
  });
  lineU.setAttribute("class", "grid");
  gGround.appendChild(lineU);
}
for (var gv = vMin; gv <= vMax; gv += 3) {
  var lineV = el("line", {
    x1: P(uMin, gv, 0)[0], y1: P(uMin, gv, 0)[1],
    x2: P(uMax, gv, 0)[0], y2: P(uMax, gv, 0)[1]
  });
  lineV.setAttribute("class", "grid");
  gGround.appendChild(lineV);
}

/* ---------- edges ---------- */
// Each edge gets a fat transparent hit line under the visible one: a 2-4px
// stroke is close to unclickable, and the connectors carry real information.
// They are deliberately NOT in the tab order — a large map has hundreds, which
// would bury the blocks. Keyboard users reach every edge from the panel of
// either zone it touches.
var edgeEls = [];
EDGES.forEach(function(e, index){
  var projected = e.points.map(function(q){ return P(q[0], q[1], 0); });
  var from = BY[e.from], to = BY[e.to];
  var kindWord = e.seam ? "Runtime seam: " : (e.infra ? "Uses infrastructure: " : "Dependency: ");
  var relation = e.seam ? " calls back into " : (e.infra ? " talks to " : " imports ");
  var g = el("g", {
    "class": "edge", tabindex: "-1", role: "button",
    "aria-label": kindWord + (from ? from.name : e.from) + relation +
      (to ? to.name : e.to) + (e.seam || e.infra ? "" : ", " + e.weight + " references")
  });
  var hit = el("polyline", {
    points: pts(projected), fill: "none", stroke: "transparent",
    "stroke-width": "14", "stroke-linejoin": "round", "stroke-linecap": "round"
  });
  var line = el("polyline", { points: pts(projected), "marker-end": "url(#wire)" });
  line.setAttribute("class", "wire" + (e.seam ? " seam" : "") + (e.infra ? " infra" : ""));
  if (e.seam) line.setAttribute("stroke-dasharray", "2 5");
  else if (e.infra) line.setAttribute("stroke-dasharray", "10 4");
  else if (e.back) line.setAttribute("stroke-dasharray", "7 6");
  g.appendChild(hit); g.appendChild(line);
  gEdge.appendChild(g);
  edgeEls.push({ e: e, g: g, node: line });

  g.addEventListener("click", function(ev){
    if (dragMoved) return;
    ev.stopPropagation();
    lastPick = Date.now();
    selectEdge(index);
  });
});

/* ---------- blocks ---------- */
// Painter's algorithm: ascending (u+v) draws far boxes before near ones.
var order = NODES.slice().sort(function(x, y){ return (x.u + x.v) - (y.u + y.v); });
var blockEls = {};
order.forEach(function(n){
  var base = COLOR[n.kind] || "#6F7BA6";
  var g = el("g", {
    "class": "node", tabindex: "0", role: "button",
    "aria-label": n.name + ", " + (LABEL[n.kind] || n.kind) + ", " + n.sub
  });
  var u = n.u, v = n.v, w = n.w, d = n.d, h = n.h;
  var faceL = el("polygon", {
    points: pts([P(u, v + d, h), P(u + w, v + d, h), P(u + w, v + d, 0), P(u, v + d, 0)]),
    fill: shade(base, -0.42)
  });
  var faceR = el("polygon", {
    points: pts([P(u + w, v, h), P(u + w, v + d, h), P(u + w, v + d, 0), P(u + w, v, 0)]),
    fill: shade(base, -0.24)
  });
  var top = el("polygon", {
    points: pts([P(u, v, h), P(u + w, v, h), P(u + w, v + d, h), P(u, v + d, h)]),
    fill: base, stroke: shade(base, 0.28), "stroke-width": "1"
  });
  g.appendChild(faceL); g.appendChild(faceR); g.appendChild(top);
  gBlock.appendChild(g);

  var cTop = P(u + w / 2, v + d / 2, h);
  var tagY = cTop[1] - 28, tagX = cTop[0];
  var label = n.name.toUpperCase();
  var glyph = GLYPH[n.kind] || "";
  var tw = Math.max(74, label.length * 8.4 + 34), th = 22;
  var tg = el("g", { "class": "node", tabindex: "-1", "aria-hidden": "true" });
  tg.appendChild(el("line", {
    x1: tagX, y1: tagY + th / 2, x2: cTop[0], y2: cTop[1],
    stroke: shade(base, 0.1), "stroke-width": "1.3", "stroke-dasharray": "3 3"
  }));
  var rect = el("rect", {
    x: tagX - tw / 2, y: tagY - th / 2, width: tw, height: th, rx: "3",
    stroke: base, "stroke-width": "1.5"
  });
  rect.setAttribute("class", "tagbox");
  tg.appendChild(rect);
  // Kind is carried by a glyph as well as the swatch colour, so the map still
  // reads for anyone who cannot separate the hues.
  var mark = el("text", {
    x: tagX - tw / 2 + 11, y: tagY, "text-anchor": "middle", "dominant-baseline": "central",
    "font-family": "ui-sans-serif,system-ui,sans-serif", "font-size": "10"
  });
  mark.setAttribute("class", "tagtext");
  mark.style.fill = base;
  mark.textContent = glyph;
  tg.appendChild(mark);
  var t = el("text", {
    x: tagX + 9, y: tagY, "text-anchor": "middle", "dominant-baseline": "central",
    "font-family": "ui-sans-serif,system-ui,sans-serif",
    "font-size": "11", "font-weight": "600", "letter-spacing": "0.04em"
  });
  t.setAttribute("class", "tagtext");
  t.textContent = label;
  tg.appendChild(t);
  gTag.appendChild(tg);

  blockEls[n.id] = { g: g, tag: tg, rect: rect, text: t, top: top, base: base };

  // Only "click" — listening on pointerup as well fires pick twice per press.
  function pick(ev){
    if (dragMoved) return;
    ev.stopPropagation();
    lastPick = Date.now();
    selectNode(n.id);
  }
  g.addEventListener("click", pick);
  tg.addEventListener("click", pick);
  g.addEventListener("keydown", function(ev){
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectNode(n.id); }
  });
});

/* ---------- viewBox ---------- */
var xs = [], ys = [];
[[uMin, vMin], [uMax, vMin], [uMax, vMax], [uMin, vMax]].forEach(function(q){
  var p = P(q[0], q[1], 0); xs.push(p[0]); ys.push(p[1]);
});
NODES.forEach(function(n){
  var p = P(n.u + n.w / 2, n.v + n.d / 2, n.h); ys.push(p[1] - 46);
});
var minX = Math.min.apply(null, xs) - 20, maxX = Math.max.apply(null, xs) + 20;
var minY = Math.min.apply(null, ys) - 14, maxY = Math.max.apply(null, ys) + 20;
svg.setAttribute("viewBox", minX + " " + minY + " " + (maxX - minX) + " " + (maxY - minY));
svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

/* ---------- detail panel ---------- */
var dossier = document.getElementById("dossier");
var INTRO =
  '<h3>' + esc(MODEL.meta.project) + '</h3>' +
  '<div class="sub">' + num(MODEL.meta.shownZones) + ' zones &middot; ' +
  (MODEL.meta.origin === "sourcevision" ? 'from sourcevision analysis' : 'from a direct scan') + '</div>' +
  '<div class="body">Each block is a zone of the codebase. Footprint scales with file count and ' +
  'height with line count, so the tall wide blocks are where the code actually is. Colour and glyph ' +
  'show what the zone mostly does. Solid lines are import dependencies pointing from the importer ' +
  'to what it imports; dashed lines run backwards through the layering and mark a dependency cycle.</div>' +
  '<h4>Try this</h4><ul>' +
  '<li>Click a block to see its files and cross-zone edges.</li>' +
  '<li>Click a connector, or a reference count in a panel, to inspect one dependency.</li>' +
  (MODEL.meta.seamCount || MODEL.meta.infraCount
    ? '<li>Pink connectors are <b>declared</b>, not inferred: runtime seams and infrastructure ' +
      'that no import can show. They are assertions from <code>.n-dx.json</code> or IaC.</li>'
    : '') +
  '<li>Use the legend to isolate one kind of zone.</li>' +
  '<li>Drag to pan, scroll to zoom, <b>Reset view</b> to recentre. <b>Esc</b> clears.</li>' +
  '</ul>';

/** Index of the edge joining two zones, or -1. */
function edgeIndex(fromId, toId){
  for (var i = 0; i < EDGES.length; i++) {
    if (EDGES[i].from === fromId && EDGES[i].to === toId) return i;
  }
  return -1;
}

function linkList(items, selfId, incoming){
  if (!items.length) return '<p class="sub">None.</p>';
  return '<ul>' + items.map(function(l){
    var idx = incoming ? edgeIndex(l.id, selfId) : edgeIndex(selfId, l.id);
    var count = '<span class="sub">&times;' + num(l.weight) + '</span>';
    if (idx >= 0) {
      count = '<button type="button" class="wirelink" data-edge="' + idx +
        '" title="Inspect this dependency">&times;' + num(l.weight) + '</button>';
    }
    return '<li><button type="button" class="link" data-goto="' + esc(l.id) + '">' +
      esc(l.name) + '</button> ' + count + '</li>';
  }).join("") + '</ul>';
}

function renderNode(n){
  var color = COLOR[n.kind] || "#6F7BA6";
  var h = '<div class="kind"><i style="background:' + esc(color) + '"></i>' +
    esc(GLYPH[n.kind] || "") + ' ' + esc(n.stage) + ' &middot; ' + esc(LABEL[n.kind] || n.kind) + '</div>';
  h += '<h3>' + esc(n.name) + '</h3>';
  h += '<div class="sub">' + esc(n.sub) + '</div>';

  if (n.kind !== "external") {
    h += '<div class="mx">' +
      '<span>cohesion <b>' + n.metrics.cohesion.toFixed(2) + '</b></span>' +
      '<span>coupling <b>' + n.metrics.coupling.toFixed(2) + '</b></span>' +
      (n.metrics.riskLevel !== "unscored"
        ? '<span class="risk-' + esc(n.metrics.riskLevel) + '">risk <b>' + esc(n.metrics.riskLevel) + '</b></span>'
        : '') +
      (n.metrics.routes ? '<span>routes <b>' + num(n.metrics.routes) + '</b></span>' : '') +
      '</div>';
  }
  if (n.body) h += '<div class="body">' + esc(n.body) + '</div>';
  if (n.mix.length) {
    h += '<h4>Contents</h4><div class="mx">' + n.mix.map(function(a){
      return '<span>' + esc(LABEL[a[0]] || a[0]) + ' <b>' + num(a[1]) + '</b></span>';
    }).join("") + '</div>';
  }
  if (n.insights.length) {
    h += '<h4>Insights</h4><ul>' + n.insights.map(function(i){
      return '<li>' + esc(i) + '</li>';
    }).join("") + '</ul>';
  }
  if (n.findings.length) {
    h += '<h4>Findings</h4><ul>' + n.findings.map(function(f){
      return '<li class="sev-' + esc(f.severity) + '">' + esc(f.text) + '</li>';
    }).join("") + '</ul>';
  }
  if (n.keyFiles.length) {
    h += '<h4>Key files</h4><ul class="files">' + n.keyFiles.map(function(f){
      return '<li>' + (f.url
        ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' + esc(f.path) + '</a>'
        : esc(f.path)) + '</li>';
    }).join("") + '</ul>';
  }
  h += '<h4>Imported by</h4>' + linkList(n.inbound, n.id, true);
  h += '<h4>Imports</h4>' + linkList(n.outbound, n.id, false);
  return h;
}

function renderEdge(e){
  var from = BY[e.from], to = BY[e.to];
  var fromName = from ? from.name : e.from, toName = to ? to.name : e.to;
  var h, sub, body;

  if (e.seam) {
    // A declared seam is an assertion by a person, and the panel says so —
    // it is not something the analysis proved.
    h = '<div class="kind">Runtime seam &middot; declared</div>';
    sub = e.seam.callbacks.length
      ? e.seam.callbacks.length + ' injected ' + (e.seam.callbacks.length === 1 ? 'callback' : 'callbacks')
      : 'declared in .n-dx.json';
    body = esc(fromName) + ' injects into ' + esc(toName) + ', so at runtime control flows ' +
      'this way even though the import points the other way. Static analysis cannot see this &mdash; ' +
      'it is declared under <code>sourcevision.isoMap.injectionSeams</code> and is only as accurate ' +
      'as that declaration.';
  } else if (e.infra) {
    h = '<div class="kind">Infrastructure &middot; declared</div>';
    sub = to ? esc(to.sub) : 'runtime resource';
    body = esc(fromName) + ' uses ' + esc(toName) + '. This relationship has no import signature; ' +
      'it comes from a declaration or from infrastructure-as-code.';
  } else {
    h = '<div class="kind">Dependency</div>';
    sub = num(e.weight) + ' cross-zone import ' + (e.weight === 1 ? 'reference' : 'references') +
      (MODEL.meta.hasCalls ? ' &middot; ' + num(e.calls) + ' runtime calls' : '');
    body = esc(fromName) + ' imports from ' + esc(toName) + '. ' +
      (e.back
        ? 'This edge runs backwards through the layering, so these two zones sit in a dependency cycle &mdash; the arrow is drawn through the return lane below the scene.'
        : 'The arrow points from the importer to what it imports.') +
      (e.weight === 0 && e.calls > 0
        ? ' No import resolves this edge &mdash; it exists only in the call graph, which is the signature of an injected or event-driven seam.'
        : '');
  }

  h += '<h3>' + esc(fromName) + ' &rarr; ' + esc(toName) + '</h3>';
  h += '<div class="sub">' + sub + '</div>';
  h += '<div class="body">' + body + '</div>';
  if (e.seam && e.seam.callbacks.length) {
    h += '<h4>Injected</h4><ul>' + e.seam.callbacks.map(function(c){
      return '<li><code>' + esc(c) + '</code></li>';
    }).join("") + '</ul>';
  }
  if (e.seam && e.seam.note) h += '<h4>Why</h4><div class="body">' + esc(e.seam.note) + '</div>';
  h += '<h4>Both ends</h4><ul>' +
    '<li><button type="button" class="link" data-goto="' + esc(e.from) + '">' + esc(fromName) + '</button>' +
    (from ? ' <span class="sub">' + esc(from.sub) + '</span>' : '') + '</li>' +
    '<li><button type="button" class="link" data-goto="' + esc(e.to) + '">' + esc(toName) + '</button>' +
    (to ? ' <span class="sub">' + esc(to.sub) + '</span>' : '') + '</li>' +
    '</ul>';
  return h;
}

function bindPanel(){
  var gotos = dossier.querySelectorAll("[data-goto]");
  for (var i = 0; i < gotos.length; i++) {
    gotos[i].addEventListener("click", function(ev){
      selectNode(ev.currentTarget.getAttribute("data-goto"));
    });
  }
  var wires = dossier.querySelectorAll("[data-edge]");
  for (var j = 0; j < wires.length; j++) {
    wires[j].addEventListener("click", function(ev){
      selectEdge(parseInt(ev.currentTarget.getAttribute("data-edge"), 10));
    });
  }
}

/* ---------- selection & filtering ---------- */
var curNode = null, curEdge = null, byCalls = false;
var activeKinds = {};

function kindVisible(kind){
  var any = false;
  for (var k in activeKinds) if (activeKinds[k]) { any = true; break; }
  return !any || !!activeKinds[kind];
}

function highlighted(){
  var set = {};
  if (curNode) {
    set[curNode] = true;
    EDGES.forEach(function(e){
      if (e.from === curNode) set[e.to] = true;
      if (e.to === curNode) set[e.from] = true;
    });
  } else if (curEdge !== null) {
    var e = EDGES[curEdge];
    set[e.from] = true; set[e.to] = true;
  }
  return set;
}

function refresh(scrollPanel){
  var focused = (curNode !== null || curEdge !== null);
  var near = highlighted();

  NODES.forEach(function(n){
    var b = blockEls[n.id];
    var shown = kindVisible(n.kind);
    var on = (n.id === curNode);
    var linked = focused ? !!near[n.id] : true;
    b.g.setAttribute("opacity", String(!shown ? 0.08 : (on ? 1 : (linked ? 0.85 : 0.28))));
    b.tag.setAttribute("opacity", String(!shown ? 0.05 : (on ? 1 : (linked ? 0.8 : 0.22))));
    // Inline style wins over the themed class while selected, and clearing it
    // hands the colour back to CSS so the theme still applies.
    b.rect.style.fill = on ? b.base : "";
    b.text.style.fill = on ? "var(--tag-ink-on)" : "";
    b.top.setAttribute("stroke", on ? "var(--ink)" : shade(b.base, 0.28));
    b.top.setAttribute("stroke-width", on ? "2.4" : "1");
    b.g.setAttribute("tabindex", shown ? "0" : "-1");
    b.g.setAttribute("aria-pressed", on ? "true" : "false");
  });

  edgeEls.forEach(function(x, i){
    var hot = (i === curEdge) || (curNode !== null && (x.e.from === curNode || x.e.to === curNode));
    var ends = kindVisible((BY[x.e.from] || {}).kind) && kindVisible((BY[x.e.to] || {}).kind);
    var weight = edgeWeight(x.e);
    var declared = (x.e.seam ? " seam" : "") + (x.e.infra ? " infra" : "");
    x.node.setAttribute("class", "wire" + declared + (hot ? " hot" : ""));
    x.node.setAttribute("marker-end", hot ? "url(#wirehot)" : "url(#wire)");
    x.node.setAttribute("stroke-width", String(Math.min(4.5, 1.6 + Math.log(weight + 1))));
    x.node.setAttribute("opacity", !ends ? "0.05" : (focused ? (hot ? "1" : "0.18") : (weight === 0 ? "0.35" : "0.85")));
  });

  if (curNode !== null && BY[curNode]) dossier.innerHTML = renderNode(BY[curNode]);
  else if (curEdge !== null) dossier.innerHTML = renderEdge(EDGES[curEdge]);
  else dossier.innerHTML = INTRO;
  bindPanel();
  dossier.scrollTop = 0;

  // On a narrow layout the panel sits below the map, so a selection would
  // otherwise update off-screen and read as "clicking does nothing".
  if (scrollPanel && window.innerWidth <= 1020 && dossier.scrollIntoView) {
    try {
      dossier.scrollIntoView(reduceMotion ? true : { behavior: "smooth", block: "nearest" });
    } catch (err) { /* older browsers */ }
  }
}

function selectNode(id){
  if (!BY[id]) return;
  curNode = id; curEdge = null;
  refresh(true);
}
function selectEdge(index){
  if (!EDGES[index]) return;
  curEdge = index; curNode = null;
  refresh(true);
}
function clearSelection(){
  if (curNode === null && curEdge === null) return;
  curNode = null; curEdge = null;
  refresh(false);
}

var legendButtons = document.querySelectorAll(".lg");
for (var li = 0; li < legendButtons.length; li++) {
  legendButtons[li].addEventListener("click", function(ev){
    var btn = ev.currentTarget, kind = btn.getAttribute("data-kind");
    activeKinds[kind] = !activeKinds[kind];
    btn.setAttribute("aria-pressed", activeKinds[kind] ? "true" : "false");
    refresh(false);
  });
}

var weightBtn = document.getElementById("weight");
if (weightBtn) {
  weightBtn.addEventListener("click", function(){
    byCalls = !byCalls;
    weightBtn.setAttribute("aria-pressed", byCalls ? "true" : "false");
    weightBtn.textContent = byCalls ? "Weight: calls" : "Weight: imports";
    refresh(false);
  });
}

/* ---------- pan & zoom ---------- */
var k = 1, tx = 0, ty = 0, dragging = false, dragMoved = false;
var sx = 0, sy = 0, stx = 0, sty = 0, lastPick = 0;
var stage = document.getElementById("stage");

function apply(){ camera.setAttribute("transform", "translate(" + tx + " " + ty + ") scale(" + k + ")"); }
function toVB(ev){
  if (!svg.createSVGPoint) return { x: ev.clientX, y: ev.clientY };
  var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  var m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
  var p = pt.matrixTransform(m.inverse()); return { x: p.x, y: p.y };
}

stage.addEventListener("wheel", function(ev){
  ev.preventDefault();
  var p = toVB(ev), wx = (p.x - tx) / k, wy = (p.y - ty) / k;
  var nk = Math.max(0.4, Math.min(5, k * Math.exp(-ev.deltaY * 0.0016)));
  tx = p.x - wx * nk; ty = p.y - wy * nk; k = nk; apply();
}, { passive: false });

// No setPointerCapture: capturing on the container retargets the follow-up
// click away from the SVG children, which kills block selection.
stage.addEventListener("pointerdown", function(ev){
  if (ev.button !== undefined && ev.button !== 0) return;
  dragging = true; dragMoved = false;
  var p = toVB(ev); sx = p.x; sy = p.y; stx = tx; sty = ty;
});
window.addEventListener("pointermove", function(ev){
  if (!dragging) return;
  var p = toVB(ev), dx = p.x - sx, dy = p.y - sy;
  if (!dragMoved) {
    if (Math.abs(dx) * k < 6 && Math.abs(dy) * k < 6) return;
    dragMoved = true; stage.classList.add("dragging");
  }
  tx = stx + dx; ty = sty + dy; apply();
});
window.addEventListener("pointerup", function(){
  dragging = false; stage.classList.remove("dragging");
});
window.addEventListener("pointercancel", function(){
  dragging = false; dragMoved = false; stage.classList.remove("dragging");
});
stage.addEventListener("click", function(){
  if (dragMoved) return;
  if (Date.now() - lastPick < 350) return; // a block or edge already handled this
  clearSelection();
});

function zoomBy(f){
  var cx = minX + (maxX - minX) / 2, cy = minY + (maxY - minY) / 2;
  var wx = (cx - tx) / k, wy = (cy - ty) / k;
  var nk = Math.max(0.4, Math.min(5, k * f));
  tx = cx - wx * nk; ty = cy - wy * nk; k = nk; apply();
}
document.getElementById("zin").addEventListener("click", function(){ zoomBy(1.28); });
document.getElementById("zout").addEventListener("click", function(){ zoomBy(1 / 1.28); });
document.getElementById("fit").addEventListener("click", function(){
  k = 1; tx = 0; ty = 0; apply();
});
document.addEventListener("keydown", function(ev){
  if (ev.key === "Escape") clearSelection();
});

apply();
refresh(false);
`;

// packages/sourcevision/src/export/iso-sources.ts
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "node:fs";
import { join as join3, basename as basename2, resolve as resolve2 } from "node:path";
import { execFileSync } from "node:child_process";

// packages/sourcevision/src/export/iso-scan.ts
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, extname, basename, resolve, sep } from "node:path";
var LANGUAGES = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rb": "Ruby",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rs": "Rust",
  ".php": "PHP",
  ".cs": "C#",
  ".swift": "Swift",
  ".scala": "Scala",
  ".c": "C",
  ".h": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".hpp": "C++",
  ".m": "Objective-C",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang"
};
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "vendor",
  "third_party",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "bower_components",
  "Pods",
  ".gradle",
  ".idea",
  ".vscode",
  ".terraform",
  "tmp",
  "temp",
  "site-packages"
]);
var WORKSPACE_CONTAINERS = /* @__PURE__ */ new Set([
  "packages",
  "apps",
  "services",
  "libs",
  "modules",
  "projects",
  "crates"
]);
var SOURCE_ROOTS = /* @__PURE__ */ new Set([
  "src",
  "lib",
  "app",
  "source",
  "internal",
  "pkg",
  "cmd"
]);
var STDLIB = /* @__PURE__ */ new Set([
  "fs",
  "path",
  "os",
  "url",
  "util",
  "events",
  "stream",
  "crypto",
  "http",
  "https",
  "net",
  "zlib",
  "buffer",
  "child_process",
  "worker_threads",
  "readline",
  "assert",
  "tty",
  "timers",
  "process",
  "querystring",
  "string_decoder",
  "perf_hooks",
  "vm",
  "dns",
  "cluster",
  "console",
  "module",
  "v8",
  "async_hooks",
  "diagnostics_channel",
  "sys",
  "json",
  "re",
  "typing",
  "dataclasses",
  "collections",
  "itertools",
  "functools",
  "logging",
  "datetime",
  "abc",
  "enum",
  "math",
  "random",
  "subprocess",
  "shutil",
  "tempfile",
  "unittest",
  "argparse",
  "io",
  "time",
  "copy",
  "hashlib",
  "base64",
  "context",
  "errors",
  "strings",
  "strconv",
  "sync",
  "testing",
  "sort",
  "bytes",
  "fmt",
  "encoding",
  "log",
  "regexp",
  "bufio",
  "flag",
  "reflect",
  "runtime",
  "unicode",
  "text",
  "html",
  "database",
  "container",
  "compress",
  "archive",
  "hash",
  "image",
  "mime",
  "syscall",
  "unsafe",
  "embed",
  "iter",
  "maps",
  "slices"
]);
function extraSkips(dir) {
  const skips = /* @__PURE__ */ new Set();
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) return skips;
  try {
    for (const raw of readFileSync(path, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      if (line.includes("*") || line.includes("?")) continue;
      const name = line.replace(/^\/+/, "").replace(/\/+$/, "");
      if (name && !name.includes("/")) skips.add(name);
    }
  } catch {
  }
  return skips;
}
function walkSources(root) {
  const skip = /* @__PURE__ */ new Set([...SKIP_DIRS, ...extraSkips(root)]);
  const files = [];
  function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (!LANGUAGES[ext]) continue;
        try {
          if (statSync(full).size > 2e6) continue;
        } catch {
          continue;
        }
        files.push({ path: relative(root, full).split(sep).join("/"), ext });
      }
    }
  }
  walk(root, 0);
  return files;
}
var JS_PATTERNS = [
  /\bimport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bexport\s+[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];
var PY_PATTERNS = [
  /^\s*from\s+([.\w]+)\s+import\s+/gm,
  /^\s*import\s+([.\w]+)/gm
];
var GO_SINGLE = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/gm;
var GO_BLOCK = /^\s*import\s*\(([\s\S]*?)^\s*\)/gm;
var GO_BLOCK_ENTRY = /^\s*(?:[\w.]+\s+)?"([^"]+)"/gm;
function extractGoSpecs(content) {
  const specs = /* @__PURE__ */ new Set();
  GO_SINGLE.lastIndex = 0;
  let match;
  while ((match = GO_SINGLE.exec(content)) !== null) specs.add(match[1]);
  GO_BLOCK.lastIndex = 0;
  while ((match = GO_BLOCK.exec(content)) !== null) {
    const body = match[1];
    GO_BLOCK_ENTRY.lastIndex = 0;
    let entry;
    while ((entry = GO_BLOCK_ENTRY.exec(body)) !== null) specs.add(entry[1]);
  }
  return specs;
}
function looksLikeSpec(spec) {
  if (!spec || spec.length > 200) return false;
  return /^[@\w][\w@./~+-]*$/.test(spec) || /^[./~]/.test(spec);
}
function extractSpecs(content, ext) {
  let specs;
  if (ext === ".go") {
    specs = extractGoSpecs(content);
  } else {
    specs = /* @__PURE__ */ new Set();
    const patterns = ext === ".py" ? PY_PATTERNS : JS_PATTERNS;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) specs.add(match[1]);
      }
    }
  }
  return [...specs].filter(looksLikeSpec);
}
var RESOLVE_EXTS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".go",
  ".vue",
  ".svelte"
];
function resolvePath(base, fileSet) {
  const stripped = base.replace(/\.(js|mjs|cjs)$/, "");
  for (const ext of RESOLVE_EXTS) {
    for (const candidate of [base + ext, stripped + ext, `${base}/index${ext}`, `${stripped}/index${ext}`]) {
      const normal = candidate.replace(/\/\.\//g, "/").replace(/^\.\//, "");
      if (fileSet.has(normal)) return normal;
    }
  }
  return null;
}
function resolveRelative(fromFile, spec, fileSet) {
  return resolvePath(join(dirname(fromFile), spec).split(sep).join("/"), fileSet);
}
function isStdlib(spec) {
  if (spec.startsWith("node:")) return true;
  return STDLIB.has(spec.split("/")[0]);
}
function packageName(spec) {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  if (spec.startsWith("@") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  if (parts.length >= 3 && parts[0].includes(".")) return parts.slice(0, 3).join("/");
  return parts[0];
}
function readJsonLoose(path) {
  try {
    const raw = readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function buildAliasMap(root, files) {
  const prefixes = [];
  for (const name of ["tsconfig.json", "tsconfig.base.json", "jsconfig.json"]) {
    const config = readJsonLoose(join(root, name));
    const paths = config?.compilerOptions?.paths;
    if (!paths) continue;
    const baseUrl = (config?.compilerOptions?.baseUrl ?? ".").replace(/^\.\//, "").replace(/\/$/, "");
    for (const [alias, targets] of Object.entries(paths)) {
      const target = targets?.[0];
      if (!target) continue;
      const from = alias.replace(/\*$/, "").replace(/\/$/, "");
      let to = target.replace(/\*$/, "").replace(/^\.\//, "");
      if (baseUrl && baseUrl !== ".") to = `${baseUrl}/${to}`;
      prefixes.push({ from, to: to.replace(/\/$/, "") });
    }
  }
  const dirs = /* @__PURE__ */ new Set();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length >= 2 && WORKSPACE_CONTAINERS.has(parts[0])) {
      dirs.add(`${parts[0]}/${parts[1]}`);
    }
  }
  for (const dir of [...dirs].sort()) {
    const pkg = readJsonLoose(join(root, dir, "package.json"));
    if (pkg?.name) prefixes.push({ from: pkg.name, to: dir });
  }
  prefixes.sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from));
  return { prefixes };
}
function resolveAlias(spec, aliases, fileSet, dirRep) {
  for (const { from, to } of aliases.prefixes) {
    if (spec !== from && !spec.startsWith(`${from}/`)) continue;
    const rest = spec.slice(from.length).replace(/^\//, "");
    const base = rest ? `${to}/${rest}` : to;
    const direct = resolvePath(base, fileSet);
    if (direct) return direct;
    for (const candidate of [`${to}/src`, to]) {
      const rep = dirRep.get(candidate);
      if (rep) return rep;
      const viaIndex = resolvePath(`${candidate}/index`, fileSet);
      if (viaIndex) return viaIndex;
    }
    return null;
  }
  return null;
}
function goModulePath(root) {
  const path = join(root, "go.mod");
  if (!existsSync(path)) return null;
  try {
    const match = readFileSync(path, "utf-8").match(/^\s*module\s+(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
var MAX_ZONE_FILES = 90;
var MIN_ZONE_FILES = 3;
function zoneKeyFor(path, depthBoost) {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";
  let take = 1;
  if (WORKSPACE_CONTAINERS.has(parts[0])) take = 2;
  else if (SOURCE_ROOTS.has(parts[0])) take = 2;
  take += depthBoost;
  take = Math.min(take, parts.length - 1);
  return parts.slice(0, take).join("/") || "(root)";
}
function groupZones(files) {
  let groups = /* @__PURE__ */ new Map();
  for (const file of files) {
    const key = zoneKeyFor(file.path, 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const split = /* @__PURE__ */ new Map();
  for (const [key, members] of groups) {
    if (members.length <= MAX_ZONE_FILES) {
      split.set(key, members);
      continue;
    }
    const sub = /* @__PURE__ */ new Map();
    for (const file of members) {
      const subKey = zoneKeyFor(file.path, 1);
      if (!sub.has(subKey)) sub.set(subKey, []);
      sub.get(subKey).push(file);
    }
    if (sub.size > 1) for (const [k, v] of sub) split.set(k, v);
    else split.set(key, members);
  }
  groups = split;
  const folded = /* @__PURE__ */ new Map();
  for (const [key, members] of groups) {
    let target = key;
    if (members.length < MIN_ZONE_FILES) {
      const parent = key.split("/").slice(0, -1).join("/");
      target = parent && groups.has(parent) ? parent : key.includes("/") ? parent || "(root)" : "(root)";
    }
    if (!folded.has(target)) folded.set(target, []);
    folded.get(target).push(...members);
  }
  for (const [key, members] of [...folded]) {
    if (members.length >= MIN_ZONE_FILES * 2) continue;
    const children = [...folded.keys()].filter((k) => k !== key && k.startsWith(`${key}/`));
    if (children.length === 0) continue;
    children.sort((a, b) => folded.get(b).length - folded.get(a).length || a.localeCompare(b));
    folded.get(children[0]).push(...members);
    folded.delete(key);
  }
  return folded;
}
function zoneName(key) {
  if (key === "(root)") return "Root";
  const segments = key.split("/");
  const parts = segments.filter(
    (p) => !(WORKSPACE_CONTAINERS.has(p) || SOURCE_ROOTS.has(p)) || segments.length === 1
  );
  const label = (parts.length ? parts : segments).join(" ");
  return label.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
var KIND_HINTS = [
  ["tests", ["test", "tests", "__tests__", "spec", "specs", "e2e", "fixtures", "testing"]],
  ["entry", ["route", "routes", "api", "pages", "page", "handler", "handlers", "controller", "controllers", "endpoint", "endpoints", "cmd", "bin", "server", "cli", "main"]],
  ["ui", ["component", "components", "ui", "view", "views", "screen", "screens", "widget", "widgets", "hook", "hooks", "styles", "layout", "layouts"]],
  ["data", ["model", "models", "schema", "schemas", "store", "stores", "db", "database", "entity", "entities", "repository", "repositories", "migration", "migrations", "dao", "types"]],
  ["gateway", ["gateway", "gateways", "adapter", "adapters", "client", "clients", "integration", "integrations", "provider", "providers", "connector", "connectors"]],
  ["logic", ["service", "services", "core", "domain", "usecase", "usecases", "logic", "engine", "workflow", "workflows", "analyzer", "analyzers", "generator", "generators"]],
  ["support", ["util", "utils", "helper", "helpers", "config", "configs", "constant", "constants", "shared", "common", "lib", "internal", "support"]]
];
function inferFileKind(path) {
  const lower = path.toLowerCase();
  if (/(^|\/)(tests?|specs?|__tests__)(\/|$)/.test(lower)) return "tests";
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) return "tests";
  if (/_test\.[a-z]+$/.test(lower)) return "tests";
  const segments = lower.split("/").slice(0, -1);
  for (const [kind, words] of KIND_HINTS) {
    for (const segment of segments) {
      if (words.includes(segment)) return kind;
    }
  }
  const file = basename(lower, extname(lower));
  for (const [kind, words] of KIND_HINTS) {
    if (words.includes(file)) return kind;
  }
  return "support";
}
function scanProject(root) {
  const files = walkSources(root);
  if (files.length === 0) {
    return {
      zones: [],
      crossings: [],
      fileMeta: /* @__PURE__ */ new Map(),
      external: [],
      totalFiles: 0,
      totalLines: 0,
      aliasCount: 0
    };
  }
  const fileSet = new Set(files.map((f) => f.path));
  const goModule = goModulePath(root);
  const dirRep = /* @__PURE__ */ new Map();
  for (const file of files) {
    const dir = file.path.split("/").slice(0, -1).join("/");
    if (!dirRep.has(dir)) dirRep.set(dir, file.path);
  }
  const aliases = buildAliasMap(root, files);
  const meta = /* @__PURE__ */ new Map();
  const edges = [];
  const externalUsers = /* @__PURE__ */ new Map();
  let aliasCount = 0;
  for (const file of files) {
    let content = "";
    try {
      content = readFileSync(join(root, file.path), "utf-8");
    } catch {
      content = "";
    }
    meta.set(file.path, {
      path: file.path,
      lineCount: content ? content.split("\n").length : 0,
      language: LANGUAGES[file.ext] ?? "Other",
      kind: inferFileKind(file.path)
    });
    for (const spec of extractSpecs(content, file.ext)) {
      if (goModule && (spec === goModule || spec.startsWith(`${goModule}/`))) {
        const inner = spec.slice(goModule.length).replace(/^\//, "");
        const target = dirRep.get(inner);
        if (target && target !== file.path) edges.push({ from: file.path, to: target });
        continue;
      }
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~")) {
        const target = resolveRelative(file.path, spec, fileSet);
        if (target && target !== file.path) edges.push({ from: file.path, to: target });
        continue;
      }
      const aliased = resolveAlias(spec, aliases, fileSet, dirRep);
      if (aliased) {
        aliasCount++;
        if (aliased !== file.path) edges.push({ from: file.path, to: aliased });
        continue;
      }
      if (!isStdlib(spec)) {
        const pkg = packageName(spec);
        if (!externalUsers.has(pkg)) externalUsers.set(pkg, /* @__PURE__ */ new Set());
        externalUsers.get(pkg).add(file.path);
      }
    }
  }
  const groups = groupZones(files);
  const zoneOf = /* @__PURE__ */ new Map();
  const zones = [];
  const nameCounts = /* @__PURE__ */ new Map();
  for (const key of groups.keys()) {
    const name = zoneName(key);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const [key, members] of [...groups.entries()].sort()) {
    const paths = members.map((m) => m.path).sort();
    for (const p of paths) zoneOf.set(p, key);
    const short = zoneName(key);
    const name = (nameCounts.get(short) ?? 0) > 1 ? key : short;
    zones.push({
      id: key,
      name,
      files: paths,
      entryPoints: [],
      cohesion: 0,
      coupling: 0,
      description: "",
      insights: []
    });
  }
  const crossings = [];
  const internal = /* @__PURE__ */ new Map();
  const outgoing = /* @__PURE__ */ new Map();
  for (const zone of zones) {
    internal.set(zone.id, 0);
    outgoing.set(zone.id, 0);
  }
  for (const edge of edges) {
    const from = zoneOf.get(edge.from);
    const to = zoneOf.get(edge.to);
    if (from === void 0 || to === void 0) continue;
    if (from === to) internal.set(from, internal.get(from) + 1);
    else {
      outgoing.set(from, outgoing.get(from) + 1);
      crossings.push({ fromZone: from, toZone: to });
    }
  }
  const inbound = new Set(edges.map((e) => e.to));
  for (const zone of zones) {
    const inside = internal.get(zone.id);
    const out = outgoing.get(zone.id);
    const total = inside + out;
    zone.cohesion = total === 0 ? 0 : Math.round(inside / total * 100) / 100;
    zone.coupling = total === 0 ? 0 : Math.round(out / total * 100) / 100;
    zone.entryPoints = zone.files.filter((f) => !inbound.has(f)).slice(0, 6);
    const langs = /* @__PURE__ */ new Map();
    for (const f of zone.files) {
      const lang = meta.get(f).language;
      langs.set(lang, (langs.get(lang) ?? 0) + 1);
    }
    const topLang = [...langs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    zone.description = `${zone.files.length} files, primarily ${topLang ? topLang[0] : "Other"}`;
  }
  const external = [...externalUsers.entries()].map(([pkg, users]) => ({ package: pkg, importedBy: [...users].sort() })).sort((a, b) => b.importedBy.length - a.importedBy.length || a.package.localeCompare(b.package));
  return {
    zones,
    crossings,
    fileMeta: meta,
    external,
    totalFiles: files.length,
    totalLines: [...meta.values()].reduce((sum, m) => sum + m.lineCount, 0),
    aliasCount
  };
}

// packages/sourcevision/src/export/iso-declared.ts
import { readFileSync as readFileSync2, existsSync as existsSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { join as join2, relative as relative2, extname as extname2, sep as sep2 } from "node:path";
function readJson(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf-8"));
  } catch {
    return null;
  }
}
function readDeclaredConfig(root) {
  const config = readJson(join2(root, ".n-dx.json"));
  const isoMap = config?.sourcevision?.isoMap;
  if (!isoMap) return { seams: [], infrastructure: [] };
  const seams = (isoMap.injectionSeams ?? []).filter(
    (s) => Boolean(s && typeof s.from === "string" && typeof s.to === "string")
  );
  const infrastructure = (isoMap.infrastructure ?? []).filter((i) => i && typeof i.id === "string" && typeof i.name === "string").map((i) => ({ ...i, kind: i.kind || "service", origin: "config" }));
  return { seams, infrastructure };
}
var IAC_KINDS = [
  [/bucket|blob_container|storage_account/, "bucket"],
  [/sqs|_queue|servicebus_queue|pubsub_subscription/, "queue"],
  [/sns|pubsub_topic|eventgrid|event_bus|eventbridge/, "topic"],
  [/dynamodb|rds|_sql|spanner|firestore|bigtable|cosmosdb|documentdb|database/, "database"],
  [/elasticache|redis|memcache/, "cache"],
  [/kinesis|kafka|msk|firehose/, "stream"],
  [/cloudwatch_event_rule|scheduler|cron|eventbridge_rule/, "scheduler"],
  [/secret|kms|vault|parameter/, "secrets"],
  [/lambda_function|cloud_run|cloudfunctions|container_app/, "compute"]
];
function classifyResource(type) {
  const lower = type.toLowerCase();
  for (const [pattern, kind] of IAC_KINDS) {
    if (pattern.test(lower)) return kind;
  }
  return null;
}
var IAC_SKIP = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".terraform",
  "dist",
  "build",
  "vendor",
  "coverage"
]);
function findTerraform(root, limit = 400) {
  const found = [];
  function walk(dir, depth) {
    if (depth > 8 || found.length >= limit) return;
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= limit) return;
      const full = join2(dir, entry.name);
      if (entry.isDirectory()) {
        if (IAC_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (extname2(entry.name) === ".tf") {
        found.push(relative2(root, full).split(sep2).join("/"));
      }
    }
  }
  walk(root, 0);
  return found;
}
var TF_RESOURCE = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
var TF_NAME_ATTR = /^\s*(?:name|bucket|queue_name|topic_name|function_name|identifier|table_name)\s*=\s*"([^"]+)"/gm;
function discoverFromIaC(root) {
  const files = findTerraform(root);
  if (files.length === 0) return { infrastructure: [], sawIaC: false };
  const infrastructure = [];
  const seen = /* @__PURE__ */ new Set();
  for (const file of files) {
    let content;
    try {
      content = readFileSync2(join2(root, file), "utf-8");
    } catch {
      continue;
    }
    TF_RESOURCE.lastIndex = 0;
    let match;
    while ((match = TF_RESOURCE.exec(content)) !== null) {
      const [, type, localName] = match;
      const kind = classifyResource(type);
      if (!kind) continue;
      const id = `infra:${type}.${localName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const block = content.slice(match.index, match.index + 800);
      TF_NAME_ATTR.lastIndex = 0;
      const literals = /* @__PURE__ */ new Set([localName]);
      let attr;
      while ((attr = TF_NAME_ATTR.exec(block)) !== null) literals.add(attr[1]);
      infrastructure.push({
        id,
        name: localName,
        kind,
        usedBy: [],
        note: `${type} declared in ${file}`,
        origin: file,
        literals: [...literals].sort()
      });
    }
  }
  infrastructure.sort((a, b) => a.id.localeCompare(b.id));
  return { infrastructure, sawIaC: true };
}
var TOO_GENERIC = /* @__PURE__ */ new Set([
  "main",
  "default",
  "this",
  "test",
  "app",
  "api",
  "web",
  "data",
  "config",
  "name",
  "id",
  "key",
  "value",
  "type",
  "input",
  "output",
  "queue",
  "bucket"
]);
function usableLiterals(infra) {
  return (infra.literals ?? [infra.name]).filter(
    (l) => l.length >= 5 && !TOO_GENERIC.has(l.toLowerCase())
  );
}
function linkInfrastructure(infrastructure, filePaths, readFile) {
  const candidates = infrastructure.filter(
    (i) => i.origin !== "config" && (i.usedBy ?? []).length === 0
  );
  if (candidates.length === 0) return infrastructure;
  const literalsById = /* @__PURE__ */ new Map();
  for (const infra of candidates) {
    const literals = usableLiterals(infra);
    if (literals.length > 0) literalsById.set(infra.id, literals);
  }
  if (literalsById.size === 0) return infrastructure;
  const hits = /* @__PURE__ */ new Map();
  for (const path of filePaths) {
    const content = readFile(path);
    if (!content) continue;
    for (const [id, literals] of literalsById) {
      if (literals.some((l) => content.includes(l))) {
        if (!hits.has(id)) hits.set(id, /* @__PURE__ */ new Set());
        hits.get(id).add(path);
      }
    }
  }
  return infrastructure.map((infra) => {
    const found = hits.get(infra.id);
    if (!found) return infra;
    return { ...infra, usedBy: [...found].sort() };
  });
}
function loadDeclaredArchitecture(root, filePaths, readFile) {
  const config = readDeclaredConfig(root);
  const iac = discoverFromIaC(root);
  const read = readFile ?? ((path) => {
    try {
      const full = join2(root, path);
      if (!existsSync2(full) || statSync2(full).size > 1e6) return null;
      return readFileSync2(full, "utf-8");
    } catch {
      return null;
    }
  });
  const infrastructure = linkInfrastructure(
    [...config.infrastructure, ...iac.infrastructure],
    filePaths,
    read
  );
  return { seams: config.seams, infrastructure, sawIaC: iac.sawIaC };
}

// packages/sourcevision/src/export/iso-sources.ts
var ARCHETYPE_KIND = {
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
  "test-helper": "support"
};
function git(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5e3
    }).trim();
  } catch {
    return void 0;
  }
}
function remoteToWebUrl(remote) {
  const cleaned = remote.trim().replace(/\.git$/, "");
  const ssh = cleaned.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = cleaned.match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+\/.+)$/);
  if (https) return `https://${https[1]}`;
  return void 0;
}
function readGitInfo(root) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return {};
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  return {
    sha: git(root, ["rev-parse", "HEAD"]),
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    committedAt: git(root, ["log", "-1", "--format=%cI"]),
    webUrl: remote ? remoteToWebUrl(remote) : void 0
  };
}
function deriveLinkBase(info) {
  if (!info.webUrl || !info.sha) return void 0;
  return `${info.webUrl}/blob/${info.sha}`;
}
function resolveTimestamp(options, info, fallback) {
  return options.analyzedAt ?? fallback ?? info.committedAt ?? (/* @__PURE__ */ new Date()).toISOString();
}
function aggregateCallEdges(callGraph, zoneOfFile) {
  const counts = /* @__PURE__ */ new Map();
  for (const edge of callGraph.edges) {
    if (!edge.calleeFile) continue;
    const from = zoneOfFile.get(edge.callerFile);
    const to = zoneOfFile.get(edge.calleeFile);
    if (!from || !to || from === to) continue;
    const key = `${from}	${to}`;
    const existing = counts.get(key);
    if (existing) existing.weight += 1;
    else counts.set(key, { fromZone: from, toZone: to, weight: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => b.weight - a.weight || a.fromZone.localeCompare(b.fromZone) || a.toZone.localeCompare(b.toZone)
  );
}
function toZoneId(ref, zoneIds, zoneOfFile) {
  if (zoneIds.has(ref)) return ref;
  const exact = zoneOfFile.get(ref);
  if (exact) return exact;
  const prefix = ref.replace(/\/+$/, "") + "/";
  for (const [file, zone] of zoneOfFile) {
    if (file.startsWith(prefix)) return zone;
  }
  return null;
}
function resolveSeams(seams, zoneIds, zoneOfFile) {
  const resolved = [];
  const internal = [];
  const unresolved = [];
  for (const seam of seams) {
    const label = `${seam.from} → ${seam.to}`;
    const fromZone = toZoneId(seam.from, zoneIds, zoneOfFile);
    const toZone = toZoneId(seam.to, zoneIds, zoneOfFile);
    if (!fromZone || !toZone) {
      unresolved.push(label);
      continue;
    }
    if (fromZone === toZone) {
      internal.push(label);
      continue;
    }
    resolved.push({ fromZone, toZone, callbacks: seam.callbacks, note: seam.note });
  }
  return { seams: resolved, internal, unresolved };
}
function seamGaps(resolution) {
  const gaps = [];
  if (resolution.internal.length > 0) {
    gaps.push(
      `${resolution.internal.length} declared seam${resolution.internal.length === 1 ? " has" : "s have"} both ends inside one zone, so there is nothing to draw between blocks: ${resolution.internal.join(", ")}.`
    );
  }
  if (resolution.unresolved.length > 0) {
    gaps.push(
      `${resolution.unresolved.length} declared seam${resolution.unresolved.length === 1 ? "" : "s"} could not be placed — the named file or zone is not in the map: ${resolution.unresolved.join(", ")}.`
    );
  }
  return gaps;
}
function resolveInfrastructure(infrastructure, zoneIds, zoneOfFile) {
  return infrastructure.map((infra) => {
    const consumers = /* @__PURE__ */ new Set();
    for (const ref of infra.usedBy ?? []) {
      const zone = toZoneId(ref, zoneIds, zoneOfFile);
      if (zone) consumers.add(zone);
    }
    return {
      id: infra.id,
      name: infra.name,
      kind: infra.kind,
      note: infra.note,
      origin: infra.origin,
      consumers: [...consumers].sort()
    };
  });
}
var REQUIRED_FILES = ["zones.json", "inventory.json", "imports.json"];
function hasSourcevision(root) {
  const svDir = join3(root, ".sourcevision");
  return existsSync3(svDir) && REQUIRED_FILES.every((f) => existsSync3(join3(svDir, f)));
}
function readJson2(path) {
  try {
    return JSON.parse(readFileSync3(path, "utf-8"));
  } catch {
    return null;
  }
}
function loadFromSourcevision(root, options = {}) {
  const svDir = join3(root, ".sourcevision");
  if (!hasSourcevision(root)) return null;
  const zonesData = readJson2(join3(svDir, "zones.json"));
  const inventory = readJson2(join3(svDir, "inventory.json"));
  const imports = readJson2(join3(svDir, "imports.json"));
  if (!zonesData || !inventory || !imports) return null;
  const classifications = readJson2(join3(svDir, "classifications.json"));
  const components = readJson2(join3(svDir, "components.json"));
  const manifest = readJson2(join3(svDir, "manifest.json"));
  const callGraph = readJson2(join3(svDir, "callgraph.json"));
  const archetypeOf = /* @__PURE__ */ new Map();
  for (const entry of classifications?.files ?? []) {
    if (entry.archetype) archetypeOf.set(entry.path, entry.archetype);
  }
  const routesOf = /* @__PURE__ */ new Map();
  for (const group of components?.serverRoutes ?? []) {
    for (const route of group.routes ?? []) {
      routesOf.set(route.file, (routesOf.get(route.file) ?? 0) + 1);
    }
  }
  const files = /* @__PURE__ */ new Map();
  for (const file of inventory.files) {
    const archetype = archetypeOf.get(file.path);
    files.set(file.path, {
      lineCount: file.lineCount ?? 0,
      // Role is the more honest signal for tests: test files usually classify
      // as utility or test-helper, which would sink them into "support".
      kind: file.role === "test" ? "tests" : asKind(archetype ? ARCHETYPE_KIND[archetype] : void 0),
      label: archetype ?? void 0,
      routes: routesOf.get(file.path)
    });
  }
  const zones = (zonesData.zones ?? []).filter((z) => (z.files?.length ?? 0) > 0 && z.detectionQuality !== "artifact").map((z) => ({
    id: z.id,
    name: z.name,
    description: z.description ?? "",
    files: z.files,
    entryPoints: z.entryPoints ?? [],
    cohesion: z.cohesion ?? 0,
    coupling: z.coupling ?? 0,
    riskLevel: z.riskMetrics?.riskLevel,
    insights: z.insights ?? []
  }));
  const zoneOfFile = /* @__PURE__ */ new Map();
  for (const zone of zones) for (const f of zone.files) zoneOfFile.set(f, zone.id);
  const info = options.useGit === false ? {} : readGitInfo(root);
  const extraGaps = [];
  if (!classifications) {
    extraGaps.push(
      "No classifications.json — block colours fall back to a single support kind. Run a full analyze to classify archetypes."
    );
  }
  if (!components || (components.serverRoutes ?? []).length === 0) {
    extraGaps.push(
      "No server routes detected — inbound entry points are inferred from zone entry files rather than real HTTP surfaces."
    );
  }
  const zoneIds = new Set(zones.map((z) => z.id));
  const declared = loadDeclaredArchitecture(root, [...files.keys()]);
  const seamResolution = resolveSeams(declared.seams, zoneIds, zoneOfFile);
  extraGaps.push(...seamGaps(seamResolution));
  return {
    zones,
    crossings: (zonesData.crossings ?? []).map((c) => ({ fromZone: c.fromZone, toZone: c.toZone })),
    seams: seamResolution.seams,
    infrastructure: resolveInfrastructure(declared.infrastructure, zoneIds, zoneOfFile),
    files,
    external: (imports.external ?? []).map((e) => ({
      package: e.package,
      importedBy: e.importedBy ?? []
    })),
    findings: (zonesData.findings ?? []).map((f) => ({
      scope: f.scope,
      text: f.text,
      severity: f.severity
    })),
    callEdges: callGraph ? aggregateCallEdges(callGraph, zoneOfFile) : void 0,
    linkBase: options.linkBase ?? deriveLinkBase(info),
    meta: {
      project: basename2(resolve2(root)),
      analyzedAt: resolveTimestamp(options, info, manifest?.analyzedAt),
      gitBranch: manifest?.gitBranch ?? info.branch,
      gitSha: manifest?.gitSha ?? info.sha,
      origin: "sourcevision",
      totalFiles: inventory.summary?.totalFiles ?? inventory.files.length,
      totalLines: inventory.summary?.totalLines ?? 0,
      extraGaps
    }
  };
}
function loadFromScan(root, options = {}) {
  const scan = scanProject(root);
  const info = options.useGit === false ? {} : readGitInfo(root);
  const files = /* @__PURE__ */ new Map();
  for (const [path, meta] of scan.fileMeta) {
    files.set(path, { lineCount: meta.lineCount, kind: asKind(meta.kind) });
  }
  const extraGaps = [
    "Zones were inferred from directory structure, not from community detection. They reflect how the code is filed, which is not always how it is organised.",
    "Imports were extracted with regular expressions. Dynamic requires and build-tool path mapping beyond tsconfig paths and workspace names may be missed."
  ];
  const zoneOfFile = /* @__PURE__ */ new Map();
  for (const zone of scan.zones) for (const f of zone.files) zoneOfFile.set(f, zone.id);
  const zoneIds = new Set(scan.zones.map((z) => z.id));
  const declared = loadDeclaredArchitecture(root, [...files.keys()]);
  const seamResolution = resolveSeams(declared.seams, zoneIds, zoneOfFile);
  extraGaps.push(...seamGaps(seamResolution));
  return {
    seams: seamResolution.seams,
    infrastructure: resolveInfrastructure(declared.infrastructure, zoneIds, zoneOfFile),
    zones: scan.zones.map((z) => ({
      id: z.id,
      name: z.name,
      description: z.description,
      files: z.files,
      entryPoints: z.entryPoints,
      cohesion: z.cohesion,
      coupling: z.coupling,
      insights: z.insights
    })),
    crossings: scan.crossings,
    files,
    external: scan.external,
    findings: [],
    linkBase: options.linkBase ?? deriveLinkBase(info),
    meta: {
      project: basename2(resolve2(root)),
      analyzedAt: resolveTimestamp(options, info),
      gitBranch: info.branch,
      gitSha: info.sha,
      origin: "scan",
      totalFiles: scan.totalFiles,
      totalLines: scan.totalLines,
      extraGaps
    }
  };
}
function loadIsoInput(root, mode = "auto", options = {}) {
  if (mode === "scan") return loadFromScan(root, options);
  const fromAnalysis = loadFromSourcevision(root, options);
  if (mode === "sourcevision") return fromAnalysis;
  if (fromAnalysis && fromAnalysis.zones.length > 0) return fromAnalysis;
  return loadFromScan(root, options);
}

// packages/sourcevision/src/export/iso-standalone.ts
var HELP = `iso-map — standalone isometric map of a codebase

  node iso-map.mjs [dir] [options]

  --out=<path>       Output file (default: <dir>/iso-map.html)
  --max-nodes=<n>    Cap drawn zones, largest first (default 40)
  --no-externals     Omit the shared third-party dependency column
  --source=<mode>    auto | sourcevision | scan (default auto)
  --title=<text>     Override the page title
  --link-base=<url>  Base URL for source links (default: the git remote)
  --analyzed-at=<t>  Timestamp to stamp (default: the HEAD commit time)
  --json             Print the model as JSON to stdout as well
  --help

Uses .sourcevision/ output when present; otherwise scans the project directly.
`;
var UsageError = class extends Error {
};
function parseStandaloneArgs(argv) {
  const opts = {
    dir: ".",
    out: null,
    maxNodes: 40,
    externals: true,
    source: "auto",
    title: null,
    linkBase: null,
    analyzedAt: null,
    json: false,
    help: false
  };
  let sawDir = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--no-externals") opts.externals = false;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--out=")) opts.out = arg.slice(6);
    else if (arg.startsWith("--title=")) opts.title = arg.slice(8);
    else if (arg.startsWith("--link-base=")) opts.linkBase = arg.slice(12);
    else if (arg.startsWith("--analyzed-at=")) opts.analyzedAt = arg.slice(14);
    else if (arg.startsWith("--source=")) {
      const mode = arg.slice(9);
      if (mode !== "auto" && mode !== "sourcevision" && mode !== "scan") {
        throw new UsageError(`Invalid --source: ${mode} (expected auto, sourcevision or scan)`);
      }
      opts.source = mode;
    } else if (arg.startsWith("--max-nodes=")) {
      const raw = arg.slice(12);
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new UsageError(`Invalid --max-nodes: ${raw}`);
      }
      opts.maxNodes = value;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (!sawDir) {
      opts.dir = arg;
      sawDir = true;
    }
  }
  return opts;
}
function runStandalone(argv, io) {
  let opts;
  try {
    opts = parseStandaloneArgs(argv);
  } catch (err) {
    io.err(`iso-map: ${err.message}
`);
    return 1;
  }
  if (opts.help) {
    io.out(HELP);
    return 0;
  }
  const root = resolve3(opts.dir);
  if (!existsSync4(root)) {
    io.err(`iso-map: Directory not found: ${root}
`);
    return 1;
  }
  const input = loadIsoInput(root, opts.source, {
    analyzedAt: opts.analyzedAt ?? void 0,
    linkBase: opts.linkBase ?? void 0
  });
  if (!input) {
    io.err(
      `iso-map: No usable .sourcevision/ output in ${root}. Run 'sourcevision analyze', or use --source=scan.
`
    );
    return 1;
  }
  if (input.zones.length === 0) {
    io.err(
      opts.source === "scan" || input.meta.origin === "scan" ? `iso-map: No source files found under ${root}. Is this the right directory?
` : `iso-map: No zones could be derived — nothing to draw.
`
    );
    return 1;
  }
  const out = resolve3(opts.out ?? join4(root, "iso-map.html"));
  if (!existsSync4(dirname2(out))) {
    io.err(`iso-map: Output directory does not exist: ${dirname2(out)}
`);
    return 1;
  }
  const model = buildIsoModel(input, {
    maxNodes: opts.maxNodes,
    includeExternals: opts.externals
  });
  writeFileSync(out, renderIsoMap(model, { title: opts.title ?? void 0 }), "utf-8");
  if (opts.json) io.out(`${JSON.stringify(model, null, 2)}
`);
  io.err(
    `iso-map: wrote ${out} — ${model.meta.shownZones} zones, ${model.edges.length} edges (${model.meta.origin})
`
  );
  return 0;
}
export {
  HELP,
  parseStandaloneArgs,
  runStandalone
};

// ── entry ───────────────────────────────────────────────────────────────────
process.exitCode = runStandalone(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
});
