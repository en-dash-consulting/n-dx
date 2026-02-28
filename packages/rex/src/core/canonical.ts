import type { PRDItem } from "../schema/index.js";
import { PRIORITY_ORDER } from "../schema/index.js";

// Re-export from the shared foundation to eliminate duplication.
// All existing consumers import from this file — the re-export preserves
// their import paths while consolidating the implementation.
export { toCanonicalJSON } from "@n-dx/llm-client";

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
