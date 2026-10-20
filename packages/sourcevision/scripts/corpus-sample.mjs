/**
 * Shared by the corpus report scripts: a seeded sample for hand checks, so a
 * rerun prints the same facts, and counts by key. Not part of the test run.
 */

/** A small seeded generator (mulberry32), so a sample is the same on every run. */
export function seededRandom(seedText) {
  let seed = [...seedText].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to `n` of `items`, drawn without replacement, in their original order. */
export function sample(items, n, random) {
  const picked = new Set();
  while (picked.size < Math.min(n, items.length)) picked.add(Math.floor(random() * items.length));
  return [...picked].sort((a, b) => a - b).map((i) => items[i]);
}

/** How many of `items` have each `key`, sorted by key. */
export const countBy = (items, key) => {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};
