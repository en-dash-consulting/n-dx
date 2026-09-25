#!/usr/bin/env node
/**
 * Export the option 1 demo page as a static, self-contained HTML file.
 *
 *   node scripts/export-preview-demo.mjs [out.html]
 *   (default: ~/Desktop/n-dx-option1-demo.html)
 *
 * The demo page builds every panel with JavaScript at load time. That is fine
 * on a dev server and wrong for a file that gets mailed around: any viewer
 * that blocks or stops scripts — a mail or Slack preview, Drive, reader mode,
 * a browser restoring a sleeping tab — shows the frame with nothing in it.
 *
 * So this runs the page once in headless Chromium, walks every destination
 * in the shell (the three stage tabs, the Commands sheet, the settings
 * pages), and writes what the renderer PRODUCED into the markup: all pages
 * present as static HTML in their own hosts, the inactive ones hidden, both
 * zone-graph projections present with one hidden. The exported file's own
 * script is a few lines of show/hide — navigation, the sheet and overlay,
 * section collapse, the 2D/3D toggle, theme — and the numbers no longer
 * depend on it. With scripts disabled the landing page reads in full — the
 * three stage cards with their headline numbers — and every other page is
 * present in the markup, hidden, for a reader who can flip them on.
 *
 * Needs the web package's Playwright Chromium (`npx playwright install chromium`
 * in packages/web if it is missing).
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "packages/web");
const SOURCE = join(WEB, "src/preview/option1-demo.html");
const out = resolve(process.argv[2] ?? join(homedir(), "Desktop", "n-dx-option1-demo.html"));

const { chromium } = createRequire(join(WEB, "package.json"))("@playwright/test");

const source = readFileSync(SOURCE, "utf-8");
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(pathToFileURL(SOURCE).href + "#analysis", { waitUntil: "load" });

// Every destination in the shell, in document order: the three stage tabs,
// the Commands button, then the settings pages. The stage links repeat the
// stage ids, hence the Set.
const pageIds = [...new Set(await page.$$eval("[data-page]", (els) => els.map((el) => el.dataset.page)))];

// Stage pages render into #content; settings and commands into their own
// hosts (an overlay and a sheet over the stage). Same split as the page's go().
const kindOf = (id) => (id.startsWith("s-") ? "settings" : id === "commands" ? "commands" : "main");
const HOSTS = {
  main: '<div class="content" id="content"></div>',
  settings: '<div class="overlay-content" id="settings-body"></div>',
  commands: '<div class="sheet-body" id="commands-body"></div>',
};
const hostSelector = { main: "#content", settings: "#settings-body", commands: "#commands-body" };

const rendered = [];
for (const id of pageIds) {
  const host = hostSelector[kindOf(id)];
  await page.evaluate((next) => { location.hash = next; }, id);
  await page.waitForFunction(
    ([next, sel]) => document.body.dataset.page === next && document.querySelector(sel + " .page-head"),
    [id, host],
  );

  if (id === "analysis") {
    // Capture both projections of the zone graph, 3D hidden, so the toggle in
    // the export is a show/hide rather than a redraw.
    await page.evaluate(() => {
      const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === "Zone graph");
      const buttons = panel.querySelectorAll(".toggle button");
      const host = panel.querySelector("svg").parentElement;
      buttons[1].click();                                   // 3D
      const svg3d = host.querySelector("svg").cloneNode(true);
      buttons[0].click();                                   // back to 2D
      svg3d.setAttribute("hidden", "");
      svg3d.dataset.projection = "3d";
      host.querySelector("svg").dataset.projection = "2d";
      host.appendChild(svg3d);
      buttons[0].dataset.projection = "2d";
      buttons[1].dataset.projection = "3d";
    });
  }

  rendered.push({
    id,
    kind: kindOf(id),
    crumbs: await page.$eval("#crumbs", (el) => el.innerHTML),
    html: await page.$eval(host, (el) => el.innerHTML),
  });
}
await browser.close();
if (errors.length) {
  console.error("The demo page threw while rendering:\n" + errors.join("\n"));
  process.exit(1);
}

// ── Assemble the static document from the source shell ────────────────────
for (const tag of Object.values(HOSTS)) {
  if (!source.includes(tag)) throw new Error("host not found in source: " + tag);
}

const pageDiv = (r) =>
  `<div class="page" data-page-id="${r.id}" data-crumbs="${escapeAttr(r.crumbs)}"${r.id === "home" ? "" : " hidden"}>\n${r.html}\n</div>`;
const bakedInto = (kind) =>
  HOSTS[kind].replace("></div>", ">\n" + rendered.filter((r) => r.kind === kind).map(pageDiv).join("\n") + "\n</div>");

const staticScript = `<script>
// Static export: the content above is baked in. This only shows and hides —
// the same routing as the live page: stage pages in #content, settings as an
// overlay, commands as a sheet lifted over the current stage.
(function () {
  var pages = document.querySelectorAll(".page");
  var crumbs = document.getElementById("crumbs");
  var main = document.getElementById("main"), overlay = document.getElementById("settings-overlay");
  var sheet = document.getElementById("commands-sheet"), scrim = document.getElementById("scrim");
  var cmdToggle = document.getElementById("commands-toggle");
  var stage = "home", lastSettings = "s-general";
  function kindOf(id) { return id.slice(0, 2) === "s-" ? "settings" : id === "commands" ? "commands" : "main"; }
  function show(id) {
    var target = null;
    pages.forEach(function (p) { if (p.dataset.pageId === id) target = p; });
    if (!target) return show("home");
    var kind = kindOf(id);
    if (kind === "main") stage = id; else if (kind === "settings") lastSettings = id;
    // An overlay or sheet sits over the stage, so the stage page stays shown beneath it.
    pages.forEach(function (p) { p.hidden = !(p === target || (kind !== "main" && p.dataset.pageId === stage)); });
    crumbs.innerHTML = target.dataset.crumbs;
    overlay.hidden = kind !== "settings";
    sheet.classList.toggle("open", kind === "commands");
    scrim.hidden = kind !== "commands";
    cmdToggle.setAttribute("aria-expanded", String(kind === "commands"));
    main.dataset.stage = stage;
    document.querySelectorAll("[data-page]").forEach(function (el) {
      el.classList.toggle("active", el.dataset.page === id || (el.classList.contains("nav-section") && el.dataset.page === stage));
    });
    target.parentElement.scrollTop = 0;
    document.body.dataset.page = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  }
  document.querySelectorAll("[data-page]").forEach(function (el) {
    el.addEventListener("click", function () {
      var id = el.dataset.page;
      show(el.hasAttribute("data-toggle") && document.body.dataset.page === id ? stage : id);
    });
  });
  window.addEventListener("hashchange", function () { show(location.hash.slice(1)); });
  document.getElementById("settings-toggle").addEventListener("click", function () { show(lastSettings); });
  document.querySelectorAll("[data-close], #scrim").forEach(function (el) { el.addEventListener("click", function () { show(stage); }); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && kindOf(document.body.dataset.page || "home") !== "main") show(stage);
  });
  document.querySelectorAll(".sec-head").forEach(function (head) {
    head.addEventListener("click", function () { head.parentElement.classList.toggle("collapsed"); });
  });
  document.querySelectorAll(".toggle button[data-projection]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var panel = btn.closest(".panel");
      // setAttribute, not .hidden: SVG elements have no hidden property, so the
      // assignment would create an expando and change nothing on screen.
      panel.querySelectorAll("svg[data-projection]").forEach(function (s) {
        if (s.dataset.projection === btn.dataset.projection) s.removeAttribute("hidden"); else s.setAttribute("hidden", "");
      });
      panel.querySelectorAll(".toggle button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
    });
  });
  document.getElementById("theme").addEventListener("click", function () {
    var root = document.documentElement;
    root.setAttribute("data-theme", root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });
  show(location.hash.slice(1) || "home");
})();
</script>`;

let doc = source;
// Function form: a string replacement would expand "$&"-style sequences in the baked markup.
for (const kind of Object.keys(HOSTS)) doc = doc.replace(HOSTS[kind], () => bakedInto(kind));
doc = doc.replace(/<script>[\s\S]*<\/script>/, staticScript);          // the renderer is no longer needed
doc = doc.replace('  <a href="./">← back to the editor</a>\n', "");   // only means something beside the editor
doc = doc.replace(
  "  Served next to the editor:  ndx start --preview .  →  /option1-demo.html\n",
  "  STATIC EXPORT — every page is baked into this file as plain HTML, so it\n" +
  "  reads in full even where scripts are blocked. Generated by\n" +
  "  scripts/export-preview-demo.mjs from packages/web/src/preview/option1-demo.html.\n",
);
doc = doc.replace(
  "Nothing here is new — only moved.</span>",
  "Nothing here is new — only moved. Static export.</span>",
);

if (/(?:src|href)="https?:/.test(doc) || /fetch\(/.test(doc)) throw new Error("export would reach the network");
writeFileSync(out, doc, "utf-8");
console.log(`${out}  (${(doc.length / 1024).toFixed(0)} KB, ${rendered.length} pages baked in)`);

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
