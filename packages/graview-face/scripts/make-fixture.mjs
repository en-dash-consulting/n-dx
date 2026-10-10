#!/usr/bin/env node
/**
 * A small, honest fixture for the headless tests: the real declaration and a
 * trimmed snapshot — a dozen records per kind, every edge whose ends survive —
 * so `describePlace` draws every place over data shaped like a real project.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "public", "data");
const to = join(root, "tests", "fixtures");
const PER_KIND = Number(process.env.FIXTURE_PER_KIND ?? 12);

const document = JSON.parse(readFileSync(join(from, "document.json"), "utf-8"));
const snapshot = JSON.parse(readFileSync(join(from, "snapshot.json"), "utf-8"));

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
writeFileSync(join(to, "document.json"), `${JSON.stringify(document, null, 2)}\n`);
writeFileSync(join(to, "snapshot.json"), `${JSON.stringify({ nodes: kept, edges }, null, 2)}\n`);
console.log(`make-fixture: ${kept.length} nodes, ${edges.length} edges → tests/fixtures`);
