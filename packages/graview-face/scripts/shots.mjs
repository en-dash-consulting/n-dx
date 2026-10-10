#!/usr/bin/env node
/**
 * Screenshots of the built site for a look: the home, the changes board, a
 * change, a capability, a zone, a run, the places — at desktop and phone
 * width, light and dark. Writes shots/<name>.png. Needs `pnpm build`.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5189;
const BASE = `http://127.0.0.1:${PORT}`;
const out = join(root, "shots");
mkdirSync(out, { recursive: true });

const snapshot = JSON.parse(readFileSync(join(root, "public", "data", "snapshot.json"), "utf-8"));
const pick = (kind, where = () => true) => snapshot.nodes.filter((n) => n.kind === kind).find(where)?.id;
const degree = new Map();
for (const e of snapshot.edges) degree.set(e.to, (degree.get(e.to) ?? 0) + 1), degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
const busiest = (kind) => snapshot.nodes.filter((n) => n.kind === kind).sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]?.id;
const routes = {
  home: "/pages",
  changes: "/pages/changes",
  attention: "/pages/attention",
  spend: "/pages/spend",
  board: "/pages/places/changes-by-status",
  runs: "/pages/places/runs-by-outcome",
  change: busiest("change") && `/pages/changes/${encodeURIComponent(busiest("change"))}`,
  capability: busiest("capability") && `/pages/capabilities/${encodeURIComponent(busiest("capability"))}`,
  zone: busiest("zone") && `/pages/zones/${encodeURIComponent(busiest("zone"))}`,
  run: pick("run", (r) => r.status === "completed") && `/pages/runs/${encodeURIComponent(pick("run", (r) => r.status === "completed"))}`,
  zones: "/pages/zones",
  scene: "/scene",
};

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
try {
  for (const [scheme, width] of [["light", 1280], ["dark", 1280], ["light", 390]]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    for (const [name, route] of Object.entries(routes)) {
      if (!route) continue;
      await page.goto(`${BASE}${route}?theme=${scheme}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(window.__graviewReady), undefined, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(name === "scene" ? 2500 : 700);
      await page.screenshot({ path: join(out, `${name}-${scheme}-${width}.png`), fullPage: name !== "scene" && width !== 390 });
    }
    await page.close();
  }
} finally {
  await browser.close();
  preview.kill();
}
console.log(`shots: written to ${out}`);
