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
 *
 * Everything themeable is expressed as a CSS custom property and applied
 * through classes rather than SVG presentation attributes, so the page follows
 * the reader's light/dark preference without any scripting.
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
    meta.origin === "sourcevision" ? "sourcevision analysis" : "direct scan",
  ];
  if (meta.gitBranch) stats.push(esc(meta.gitBranch));

  const legend = model.kinds
    .map(
      (k) =>
        `<button class="lg" type="button" data-kind="${esc(k.id)}" aria-pressed="false">` +
        `<i style="background:${esc(k.color)}" aria-hidden="true"></i>` +
        `<span class="gl" aria-hidden="true">${esc(k.glyph)}</span>${esc(k.label)}</button>`,
    )
    .join("");

  const gaps = meta.gaps.map((g) => `<li>${esc(g)}</li>`).join("");

  const omitted =
    meta.omittedZones.length > 0
      ? `<p class="note">${meta.omittedZones.length} smaller zones are not drawn: ` +
        `${esc(meta.omittedZones.slice(0, 12).join(", "))}` +
        `${meta.omittedZones.length > 12 ? ", …" : ""}. Raise <code>--max-nodes</code> to include them.</p>`
      : "";

  const weightToggle = meta.hasCalls
    ? `<button type="button" id="weight" aria-pressed="false" title="Weight connectors by runtime calls instead of imports">Weight: imports</button>`
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

// ── Styles ──────────────────────────────────────────────────────────────────

const STYLES = `
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
