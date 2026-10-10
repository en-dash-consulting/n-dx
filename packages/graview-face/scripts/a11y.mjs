#!/usr/bin/env node
/**
 * axe-core over the built site, in both schemes, at phone and desktop width:
 * the home, a capability, a change and the changes board. Exits 1 on any
 * violation. Needs `pnpm build` first and Playwright's Chromium.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const PORT = 5189;
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(join(root, "build", "index.html"))) {
  console.error("a11y: no build. Run `pnpm build` first.");
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(join(root, "public", "data", "snapshot.json"), "utf-8"));
const first = (kind) => snapshot.nodes.find((n) => n.kind === kind)?.id;
const encode = (s) => encodeURIComponent(s);
const routes = ["/pages", "/pages/changes", "/pages/places/changes-by-status", "/pages/attention", "/pages/spend"];
const capability = first("capability");
const change = first("change");
const zone = first("zone");
const run = first("run");
if (capability) routes.push(`/pages/capabilities/${encode(capability)}`);
if (change) routes.push(`/pages/changes/${encode(change)}`);
if (zone) routes.push(`/pages/zones/${encode(zone)}`);
if (run) routes.push(`/pages/runs/${encode(run)}`);

const preview = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
await new Promise((ok, fail) => {
  const started = Date.now();
  preview.on("exit", (code) => fail(new Error(`preview exited ${code}`)));
  const poll = async () => {
    try {
      const response = await fetch(`${BASE}/pages`);
      if (response.ok) return ok();
    } catch {
      // not yet listening
    }
    if (Date.now() - started > 30_000) return fail(new Error("preview did not start"));
    setTimeout(poll, 250);
  };
  void poll();
});

const browser = await chromium.launch();
let failures = 0;
try {
  for (const scheme of ["light", "dark"]) {
    for (const [width, height] of [[390, 844], [1280, 900]]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
      for (const route of routes) {
        await page.goto(`${BASE}${route}${route.includes("?") ? "&" : "?"}theme=${scheme}`, { waitUntil: "networkidle" });
        await page.waitForFunction(() => Boolean(window.__graviewReady), undefined, { timeout: 20_000 });
        await page.waitForTimeout(400);
        await page.addScriptTag({ path: AXE });
        const results = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } }));
        const violations = results.violations;
        const label = `${scheme} ${width}px ${route}`;
        if (violations.length === 0) {
          console.log(`✓ ${label}`);
          continue;
        }
        failures += violations.length;
        console.log(`✗ ${label}`);
        for (const v of violations) {
          console.log(`  ${v.impact ?? "?"} ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
          for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}`);
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  preview.kill();
}
if (failures > 0) {
  console.error(`a11y: ${failures} violation(s).`);
  process.exit(1);
}
console.log("a11y: clean.");
