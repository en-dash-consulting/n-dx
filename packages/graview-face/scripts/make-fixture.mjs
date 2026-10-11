#!/usr/bin/env node
/**
 * A small, honest seed for the headless tests: the real snapshot trimmed to a
 * dozen records per kind and every edge whose ends survive, written in
 * Graview's line format, so `describePlace` draws every place over data
 * shaped like a real project. The declaration is read from where it lives
 * (../graview/n-dx.graview.json) and never copied.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSnapshot, writeSnapshot } from "@graview/core/snapshot";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "public", "data", "snapshot.json");
const to = join(root, "tests", "fixtures");
const PER_KIND = Number(process.env.FIXTURE_PER_KIND ?? 12);

const { snapshot } = readSnapshot(readFileSync(from, "utf-8"));

// Prefer records that are connected, so the trimmed graph still has edges to walk.
const degree = new Map();
for (const e of snapshot.edges) {
  degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
  degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
}
const byKind = new Map();
for (const n of snapshot.nodes) (byKind.get(n.kind) ?? byKind.set(n.kind, []).get(n.kind)).push(n);
const kept = [];
for (const [, nodes] of [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  nodes.sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  kept.push(...nodes.slice(0, PER_KIND));
}
const ids = new Set(kept.map((n) => n.id));
const edges = snapshot.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

mkdirSync(to, { recursive: true });
writeFileSync(join(to, "snapshot.json"), writeSnapshot({ nodes: kept, edges }, { generatedAt: "2026-10-10T12:00:00.000Z" }));
console.log(`make-fixture: ${kept.length} nodes, ${edges.length} edges → tests/fixtures/snapshot.json`);
