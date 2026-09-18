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
 * So this runs the page once in headless Chromium, walks every page in the
 * rail, and writes what the renderer PRODUCED into the markup: all pages
 * present as static HTML, the inactive ones hidden, both zone-graph
 * projections present with one hidden. The exported file's own script is a
 * few lines of show/hide — navigation, section collapse, the 2D/3D toggle,
 * theme — and the numbers no longer depend on it. With scripts disabled the
 * Analysis page still reads in full.
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

// Every destination in the rail, in rail order.
const pageIds = await page.$$eval("[data-page]", (els) => els.map((el) => el.dataset.page));

const rendered = [];
for (const id of pageIds) {
  await page.evaluate((next) => { location.hash = next; }, id);
  await page.waitForFunction((next) => location.hash.slice(1) === next && document.querySelector("#content .page-head"), id);

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
    crumbs: await page.$eval("#crumbs", (el) => el.innerHTML),
    html: await page.$eval("#content", (el) => el.innerHTML),
  });
}
await browser.close();
if (errors.length) {
  console.error("The demo page threw while rendering:\n" + errors.join("\n"));
  process.exit(1);
}

// ── Assemble the static document from the source shell ────────────────────
const contentTag = '<div class="content" id="content"></div>';
if (!source.includes(contentTag)) throw new Error("content host not found in source");

const pagesHtml = rendered.map((r) =>
  `<div class="page" data-page-id="${r.id}" data-crumbs="${escapeAttr(r.crumbs)}"${r.id === "analysis" ? "" : " hidden"}>\n${r.html}\n</div>`,
).join("\n");

const staticScript = `<script>
// Static export: the content above is baked in. This only shows and hides.
(function () {
  var pages = document.querySelectorAll(".page");
  var crumbs = document.getElementById("crumbs");
  function show(id) {
    var found = false;
    pages.forEach(function (p) { var on = p.dataset.pageId === id; p.hidden = !on; if (on) { found = true; crumbs.innerHTML = p.dataset.crumbs; } });
    if (!found) return show("analysis");
    document.querySelectorAll("[data-page]").forEach(function (el) { el.classList.toggle("active", el.dataset.page === id); });
    if (id.slice(0, 2) === "s-") { document.getElementById("settings-items").hidden = false; document.querySelector("#settings-label .caret").textContent = "▾"; }
    document.getElementById("content").scrollTop = 0;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  }
  document.querySelectorAll("[data-page]").forEach(function (el) { el.addEventListener("click", function () { show(el.dataset.page); }); });
  window.addEventListener("hashchange", function () { show(location.hash.slice(1)); });
  document.getElementById("settings-label").addEventListener("click", function () {
    var items = document.getElementById("settings-items"); items.hidden = !items.hidden;
    document.querySelector("#settings-label .caret").textContent = items.hidden ? "▸" : "▾";
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
  show(location.hash.slice(1) || "analysis");
})();
</script>`;

let doc = source;
doc = doc.replace(contentTag, `<div class="content" id="content">\n${pagesHtml}\n</div>`);
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
