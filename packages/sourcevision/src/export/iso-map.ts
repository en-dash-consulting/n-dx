/**
 * Isometric map renderer.
 *
 * Emits a single self-contained HTML document: no scripts, styles, fonts or
 * data are fetched at runtime, so the file can be opened from disk, committed,
 * or attached to a review without anything else travelling with it.
 *
 * All geometry arrives precomputed from `iso-model.ts` in grid units. The
 * runtime script projects those to screen space and handles interaction only —
 * it makes no layout decisions of its own.
 */

import type { IsoModel } from "./iso-model.js";

export interface RenderIsoMapOptions {
  /** Document title. Defaults to "<project> — architecture map". */
  title?: string;
}

/** Escape text for interpolation into HTML markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Embed a value as JSON inside a <script> block.
 *
 * `</script` must be broken up or the parser ends the block early, and the
 * line/paragraph separators are valid JSON but invalid JavaScript string
 * literals, so both are escaped.
 */
function embedJSON(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderIsoMap(model: IsoModel, options: RenderIsoMapOptions = {}): string {
  const title = options.title ?? `${model.meta.project} — architecture map`;
  const meta = model.meta;

  const stats = [
    `${meta.shownZones} of ${meta.totalZones} zones`,
    `${meta.totalFiles.toLocaleString("en-US")} files`,
    `${meta.totalLines.toLocaleString("en-US")} lines`,
  ];
  if (meta.gitBranch) stats.push(esc(meta.gitBranch));

  const legend = model.kinds
    .map(
      (k) =>
        `<button class="lg" type="button" data-kind="${esc(k.id)}" aria-pressed="false">` +
        `<i style="background:${esc(k.color)}"></i>${esc(k.label)}</button>`,
    )
    .join("");

  const gaps = meta.gaps.map((g) => `<li>${esc(g)}</li>`).join("");

  const omitted =
    meta.omittedZones.length > 0
      ? `<p class="note">${meta.omittedZones.length} smaller zones are not drawn: ` +
        `${esc(meta.omittedZones.slice(0, 12).join(", "))}` +
        `${meta.omittedZones.length > 12 ? ", …" : ""}. Raise <code>--max-nodes</code> to include them.</p>`
      : "";

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
<header class="top">
  <div class="ttl">
    <h1>${esc(meta.project)}</h1>
    <p>${stats.map((s) => `<span>${s}</span>`).join("")}</p>
  </div>
  <div class="tools">
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
  <aside class="dossier" id="dossier" aria-live="polite" tabindex="0"></aside>
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

// ── Styles ──────────────────────────────────────────────────────────────────

const STYLES = `
:root{
  --bg:#12122B; --panel:#1A1940; --line:#2C2B60; --ink:#EFEFF7;
  --muted:#9B9BC4; --accent:#7FAE33; --warn:#E0A33E; --crit:#E36262;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
}
h1,h2,h3,h4{margin:0;font-weight:650;letter-spacing:-0.01em}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}

.top{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;
  padding:.85rem 1.15rem;border-bottom:1px solid var(--line);background:var(--panel);
}
.ttl h1{font-size:1.12rem}
.ttl p{margin:.2rem 0 0;color:var(--muted);font-size:.82rem;display:flex;gap:.5rem;flex-wrap:wrap}
.ttl p span:not(:last-child)::after{content:" ·";color:var(--line)}
.tools{display:flex;gap:.4rem}
.tools button,.lg{
  background:#232253;color:var(--ink);border:1px solid var(--line);border-radius:6px;
  padding:.4rem .7rem;font:inherit;font-size:.82rem;cursor:pointer;
}
.tools button:hover,.lg:hover{background:#2C2B66}
.tools button:focus-visible,.lg:focus-visible,.node:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.wrap{display:grid;grid-template-columns:minmax(0,1fr) 360px;min-height:calc(100vh - 60px)}
@media (max-width:1020px){.wrap{grid-template-columns:1fr}}

.stage{position:relative;overflow:hidden;cursor:grab;touch-action:none}
.stage.dragging{cursor:grabbing}
.stage svg{display:block;width:100%;height:100%;min-height:60vh}
.node,.edge{cursor:pointer}
.node polygon{transition:opacity .12s ease}
.edge polyline{transition:opacity .12s ease}
.edge:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.legend{
  position:absolute;left:.9rem;bottom:.9rem;display:flex;flex-wrap:wrap;gap:.35rem;
  max-width:calc(100% - 1.8rem);
}
.lg{display:inline-flex;align-items:center;gap:.4rem;background:rgba(26,25,64,.9)}
.lg i{width:11px;height:11px;border-radius:2px;display:block}
.lg[aria-pressed="true"]{border-color:var(--accent);background:#2E3A20}

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
.dossier .body{margin:.6rem 0 0;font-size:.9rem;color:#D3D3E8}
.dossier ul{margin:.3rem 0 0;padding-left:1.05rem;font-size:.86rem;color:#D3D3E8}
.dossier li{margin:.22rem 0}
.dossier ul.files{list-style:none;padding-left:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem}
.dossier ul.files li{overflow-wrap:anywhere;color:var(--muted)}
.kind{display:inline-flex;align-items:center;gap:.4rem;font-size:.75rem;color:var(--muted)}
.kind i{width:10px;height:10px;border-radius:2px;display:block}

.mx{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem}
.mx span{
  background:#232253;border:1px solid var(--line);border-radius:5px;
  padding:.2rem .45rem;font-size:.75rem;color:var(--muted);
}
.mx b{color:var(--ink);font-weight:600}
.risk-at-risk{color:var(--warn)}
.risk-critical,.risk-catastrophic{color:var(--crit)}
.sev-warning{color:var(--warn)}
.sev-critical{color:var(--crit)}
.link{
  background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:.86rem;
  cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:2px;
}

.foot{border-top:1px solid var(--line);padding:1.1rem 1.15rem 2rem;background:var(--panel)}
.foot h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.foot ul{margin:.5rem 0 0;padding-left:1.05rem;max-width:75ch;font-size:.86rem;color:#D3D3E8}
.foot li{margin:.3rem 0}
.note{color:var(--muted);font-size:.8rem;max-width:75ch;margin:.8rem 0 0}
`;

// ── Runtime ─────────────────────────────────────────────────────────────────

/**
 * Browser runtime. Written without template literals so it can sit inside the
 * TypeScript template literal above without escaping games, and without modern
 * syntax so the emitted file opens in whatever browser the reader has.
 */
const RUNTIME = `
var NS = "http://www.w3.org/2000/svg";
var CELL = 19, CX = 0.866, CY = 0.5, CZ = 0.62;
var NODES = MODEL.nodes, EDGES = MODEL.edges, B = MODEL.bounds;
var COLOR = {}, LABEL = {};
MODEL.kinds.forEach(function(k){ COLOR[k.id] = k.color; LABEL[k.id] = k.label; });
var BY = {}; NODES.forEach(function(n){ BY[n.id] = n; });

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

/* ---------- scene ---------- */
var svg = document.getElementById("iso");
var defs = el("defs");
["#4A4990", "#7FAE33"].forEach(function(col, i){
  var m = el("marker", {
    id: "arw" + i, viewBox: "0 0 10 10", refX: "8", refY: "5",
    markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse"
  });
  m.appendChild(el("path", { d: "M0,1 L9,5 L0,9 z", fill: col }));
  defs.appendChild(m);
});
svg.appendChild(defs);

var camera = el("g", { id: "camera" });
svg.appendChild(camera);
var gGround = el("g"), gEdge = el("g"), gBlock = el("g"), gTag = el("g");
camera.appendChild(gGround); camera.appendChild(gEdge);
camera.appendChild(gBlock); camera.appendChild(gTag);

var uMin = B.uMin - 3, uMax = B.uMax + 3, vMin = B.vMin - 3, vMax = B.vMax + 5;
gGround.appendChild(el("polygon", {
  points: pts([P(uMin, vMin, 0), P(uMax, vMin, 0), P(uMax, vMax, 0), P(uMin, vMax, 0)]),
  fill: "#171639", stroke: "#2C2B60", "stroke-width": "1"
}));
for (var gu = uMin; gu <= uMax; gu += 4) {
  gGround.appendChild(el("line", {
    x1: P(gu, vMin, 0)[0], y1: P(gu, vMin, 0)[1],
    x2: P(gu, vMax, 0)[0], y2: P(gu, vMax, 0)[1],
    stroke: "#222150", "stroke-width": "1"
  }));
}
for (var gv = vMin; gv <= vMax; gv += 3) {
  gGround.appendChild(el("line", {
    x1: P(uMin, gv, 0)[0], y1: P(uMin, gv, 0)[1],
    x2: P(uMax, gv, 0)[0], y2: P(uMax, gv, 0)[1],
    stroke: "#222150", "stroke-width": "1"
  }));
}

/* ---------- edges ---------- */
// Each edge gets a fat transparent hit line under the visible one: a 2-4px
// stroke is close to unclickable, and the connectors carry real information.
var edgeEls = [];
EDGES.forEach(function(e, index){
  var projected = e.points.map(function(q){ return P(q[0], q[1], 0); });
  var from = BY[e.from], to = BY[e.to];
  var g = el("g", {
    "class": "edge", tabindex: "0", role: "button",
    "aria-label": "Dependency: " + (from ? from.name : e.from) + " imports " +
      (to ? to.name : e.to) + ", " + e.weight + " references"
  });
  var hit = el("polyline", {
    points: pts(projected), fill: "none", stroke: "transparent",
    "stroke-width": "14", "stroke-linejoin": "round", "stroke-linecap": "round"
  });
  var line = el("polyline", {
    points: pts(projected), fill: "none", stroke: "#4A4990",
    "stroke-width": Math.min(4.5, 1.6 + Math.log(e.weight + 1)),
    "stroke-linejoin": "round", "stroke-linecap": "round",
    "marker-end": "url(#arw0)"
  });
  if (e.back) line.setAttribute("stroke-dasharray", "7 6");
  g.appendChild(hit); g.appendChild(line);
  gEdge.appendChild(g);
  edgeEls.push({ e: e, g: g, node: line });

  g.addEventListener("click", function(ev){
    if (dragMoved) return;
    ev.stopPropagation();
    lastPick = Date.now();
    selectEdge(index);
  });
  g.addEventListener("keydown", function(ev){
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectEdge(index); }
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
  var tw = Math.max(70, label.length * 8.4 + 26), th = 22;
  var tg = el("g", { "class": "node", tabindex: "-1", "aria-hidden": "true" });
  tg.appendChild(el("line", {
    x1: tagX, y1: tagY + th / 2, x2: cTop[0], y2: cTop[1],
    stroke: shade(base, 0.1), "stroke-width": "1.3", "stroke-dasharray": "3 3"
  }));
  var rect = el("rect", {
    x: tagX - tw / 2, y: tagY - th / 2, width: tw, height: th, rx: "3",
    fill: "#1B1A45", stroke: base, "stroke-width": "1.5"
  });
  tg.appendChild(rect);
  tg.appendChild(el("rect", { x: tagX - tw / 2 + 6, y: tagY - 4, width: 8, height: 8, rx: "2", fill: base }));
  var t = el("text", {
    x: tagX + 7, y: tagY, "text-anchor": "middle", "dominant-baseline": "central",
    fill: "#EFEFF7", "font-family": "ui-sans-serif,system-ui,sans-serif",
    "font-size": "11", "font-weight": "600", "letter-spacing": "0.04em"
  });
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
  '<div class="sub">' + num(MODEL.meta.shownZones) + ' zones drawn from static analysis</div>' +
  '<div class="body">Each block is an architectural zone. Footprint scales with file count and ' +
  'height with line count, so the tall wide blocks are where the code actually is. Colour is the ' +
  'zone&rsquo;s dominant archetype. Solid lines are import dependencies pointing from the importer ' +
  'to what it imports; dashed lines run backwards through the layering and mark a dependency cycle.</div>' +
  '<h4>Try this</h4><ul>' +
  '<li>Click a block to see its files, findings and cross-zone edges.</li>' +
  '<li>Click a connector to see what the dependency is made of.</li>' +
  '<li>Use the legend to isolate one kind of zone.</li>' +
  '<li>Drag to pan, scroll to zoom, <b>Reset view</b> to recentre. <b>Esc</b> clears.</li>' +
  '</ul>';

function linkList(items){
  if (!items.length) return '<p class="sub">None.</p>';
  return '<ul>' + items.map(function(l){
    return '<li><button type="button" class="link" data-goto="' + esc(l.id) + '">' +
      esc(l.name) + '</button> <span class="sub">&times;' + num(l.weight) + '</span></li>';
  }).join("") + '</ul>';
}

function renderNode(n){
  var color = COLOR[n.kind] || "#6F7BA6";
  var h = '<div class="kind"><i style="background:' + esc(color) + '"></i>' +
    esc(n.stage) + ' &middot; ' + esc(LABEL[n.kind] || n.kind) + '</div>';
  h += '<h3>' + esc(n.name) + '</h3>';
  h += '<div class="sub">' + esc(n.sub) + '</div>';

  if (n.kind !== "external") {
    h += '<div class="mx">' +
      '<span>cohesion <b>' + n.metrics.cohesion.toFixed(2) + '</b></span>' +
      '<span>coupling <b>' + n.metrics.coupling.toFixed(2) + '</b></span>' +
      '<span class="risk-' + esc(n.metrics.riskLevel) + '">risk <b>' + esc(n.metrics.riskLevel) + '</b></span>' +
      (n.metrics.routes ? '<span>routes <b>' + num(n.metrics.routes) + '</b></span>' : '') +
      '</div>';
  }
  if (n.body) h += '<div class="body">' + esc(n.body) + '</div>';
  if (n.archetypes.length) {
    h += '<h4>Archetype mix</h4><div class="mx">' + n.archetypes.map(function(a){
      return '<span>' + esc(a[0]) + ' <b>' + num(a[1]) + '</b></span>';
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
      return '<li>' + esc(f) + '</li>';
    }).join("") + '</ul>';
  }
  h += '<h4>Imported by</h4>' + linkList(n.inbound);
  h += '<h4>Imports</h4>' + linkList(n.outbound);
  return h;
}

function renderEdge(e){
  var from = BY[e.from], to = BY[e.to];
  var fromName = from ? from.name : e.from, toName = to ? to.name : e.to;
  var h = '<div class="kind">Dependency</div>';
  h += '<h3>' + esc(fromName) + ' &rarr; ' + esc(toName) + '</h3>';
  h += '<div class="sub">' + num(e.weight) + ' cross-zone import ' +
    (e.weight === 1 ? 'reference' : 'references') + '</div>';
  h += '<div class="body">' + esc(fromName) + ' imports from ' + esc(toName) + '. ' +
    (e.back
      ? 'This edge runs backwards through the layering, so these two zones sit in a dependency cycle &mdash; the arrow is drawn through the return lane below the scene.'
      : 'The arrow points from the importer to what it imports.') +
    '</div>';
  h += '<h4>Both ends</h4><ul>' +
    '<li><button type="button" class="link" data-goto="' + esc(e.from) + '">' + esc(fromName) + '</button>' +
    (from ? ' <span class="sub">' + esc(from.sub) + '</span>' : '') + '</li>' +
    '<li><button type="button" class="link" data-goto="' + esc(e.to) + '">' + esc(toName) + '</button>' +
    (to ? ' <span class="sub">' + esc(to.sub) + '</span>' : '') + '</li>' +
    '</ul>';
  return h;
}

function bindLinks(){
  var links = dossier.querySelectorAll("[data-goto]");
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener("click", function(ev){
      selectNode(ev.currentTarget.getAttribute("data-goto"));
    });
  }
}

/* ---------- selection & filtering ---------- */
var curNode = null, curEdge = null;
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
    b.rect.setAttribute("fill", on ? b.base : "#1B1A45");
    b.text.setAttribute("fill", on ? "#12122B" : "#EFEFF7");
    b.top.setAttribute("stroke", on ? "#FFFFFF" : shade(b.base, 0.28));
    b.top.setAttribute("stroke-width", on ? "2.4" : "1");
    b.g.setAttribute("tabindex", shown ? "0" : "-1");
  });

  edgeEls.forEach(function(x, i){
    var hot = (i === curEdge) ||
      (curNode !== null && (x.e.from === curNode || x.e.to === curNode));
    var ends = kindVisible((BY[x.e.from] || {}).kind) && kindVisible((BY[x.e.to] || {}).kind);
    x.node.setAttribute("stroke", hot ? "#7FAE33" : "#4A4990");
    x.node.setAttribute("marker-end", hot ? "url(#arw1)" : "url(#arw0)");
    x.node.setAttribute("opacity", !ends ? "0.05" : (focused ? (hot ? "1" : "0.18") : "0.85"));
    x.g.setAttribute("tabindex", ends ? "0" : "-1");
  });

  if (curNode !== null && BY[curNode]) dossier.innerHTML = renderNode(BY[curNode]);
  else if (curEdge !== null) dossier.innerHTML = renderEdge(EDGES[curEdge]);
  else dossier.innerHTML = INTRO;
  bindLinks();
  dossier.scrollTop = 0;

  // On a narrow layout the panel sits below the map, so a selection would
  // otherwise update off-screen and read as "clicking does nothing".
  if (scrollPanel && window.innerWidth <= 1020 && dossier.scrollIntoView) {
    try { dossier.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (err) { /* older browsers */ }
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
