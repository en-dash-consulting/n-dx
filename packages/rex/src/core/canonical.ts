import type { PRDItem } from "../schema/index.js";
import { PRIORITY_ORDER } from "../schema/index.js";

export function toCanonicalJSON(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

export function sortItems(items: PRDItem[]): PRDItem[] {
  const sorted = [...items].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? "medium"];
    const pb = PRIORITY_ORDER[b.priority ?? "medium"];
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
  return sorted.map((item) => {
    if (item.children && item.children.length > 0) {
      return { ...item, children: sortItems(item.children) };
    }
    return item;
  });
}
