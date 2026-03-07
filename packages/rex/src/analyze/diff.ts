import type { PRDItem } from "../schema/index.js";
import type { Proposal } from "./propose.js";
import { walkTree } from "../core/tree.js";

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

interface DiffLine {
  marker: "+" | "~" | "=";
  level: string;
  title: string;
  suffix: string;
  indent: number;
}

/**
 * Build a set of normalized titles at each level from the existing PRD tree.
 * Returns a map of parent-normalized-title → set of child-normalized-titles,
 * plus a flat set of all existing titles for quick lookup.
 */
function buildExistingIndex(existing: PRDItem[]): {
  allTitles: Set<string>;
  childrenOf: Map<string, Set<string>>;
} {
  const allTitles = new Set<string>();
  const childrenOf = new Map<string, Set<string>>();

  for (const { item, parents } of walkTree(existing)) {
    allTitles.add(normalize(item.title));

    if (parents.length > 0) {
      const parentKey = normalize(parents[parents.length - 1].title);
      if (!childrenOf.has(parentKey)) {
        childrenOf.set(parentKey, new Set());
      }
      childrenOf.get(parentKey)!.add(normalize(item.title));
    }
  }

  return { allTitles, childrenOf };
}

/**
 * Format a diff view comparing proposals against the existing PRD.
 *
 * Markers:
 *   + = will be added (new item)
 *   ~ = exists, will receive new children underneath
 *   = = unchanged (already exists in PRD)
 *
 * Returns a formatted string showing the diff tree and a summary line.
 */
export function formatDiff(
  proposals: Proposal[],
  existing: PRDItem[],
): string {
  if (proposals.length === 0) {
    return "No changes to apply.";
  }

  const { allTitles, childrenOf } = buildExistingIndex(existing);
  const lines: DiffLine[] = [];
  let addCount = 0;
  let unchangedCount = 0;

  for (const p of proposals) {
    const epicKey = normalize(p.epic.title);
    const epicExists = allTitles.has(epicKey);
    const epicChildren = childrenOf.get(epicKey) ?? new Set<string>();

    // Determine if epic has any new descendants
    let epicHasNewContent = false;
    for (const f of p.features) {
      const featureKey = normalize(f.title);
      if (!epicChildren.has(featureKey)) {
        epicHasNewContent = true;
        break;
      }
      const featureChildren = childrenOf.get(featureKey) ?? new Set<string>();
      for (const t of f.tasks) {
        if (!featureChildren.has(normalize(t.title))) {
          epicHasNewContent = true;
          break;
        }
      }
      if (epicHasNewContent) break;
    }

    if (epicExists) {
      if (epicHasNewContent) {
        lines.push({ marker: "~", level: "epic", title: p.epic.title, suffix: "", indent: 0 });
      } else {
        lines.push({ marker: "=", level: "epic", title: p.epic.title, suffix: "", indent: 0 });
        unchangedCount++;
      }
    } else {
      lines.push({ marker: "+", level: "epic", title: p.epic.title, suffix: "", indent: 0 });
      addCount++;
    }

    for (const f of p.features) {
      const featureKey = normalize(f.title);
      const featureExists = epicChildren.has(featureKey);
      const featureChildren = childrenOf.get(featureKey) ?? new Set<string>();

      // Check if feature has new tasks
      let featureHasNewTasks = false;
      for (const t of f.tasks) {
        if (!featureChildren.has(normalize(t.title))) {
          featureHasNewTasks = true;
          break;
        }
      }

      if (featureExists) {
        if (featureHasNewTasks) {
          lines.push({ marker: "~", level: "feature", title: f.title, suffix: "", indent: 1 });
        } else {
          lines.push({ marker: "=", level: "feature", title: f.title, suffix: "", indent: 1 });
          unchangedCount++;
        }
      } else {
        lines.push({ marker: "+", level: "feature", title: f.title, suffix: "", indent: 1 });
        addCount++;
      }

      for (const t of f.tasks) {
        const taskKey = normalize(t.title);
        const taskExists = featureChildren.has(taskKey);
        const pri = t.priority ? ` [${t.priority}]` : "";

        if (t.decomposition) {
          // Show decomposed task with children indented beneath
          const loeLabel = t.loe !== undefined ? `${t.loe}w` : "?";
          const thresholdLabel = `${t.decomposition.thresholdWeeks}w`;
          const decompSuffix = `${pri} ⚡ decomposed (LoE: ${loeLabel} > ${thresholdLabel} threshold)`;
          lines.push({ marker: "+", level: "task", title: t.title, suffix: decompSuffix, indent: 2 });
          addCount++;
          for (const child of t.decomposition.children) {
            const childPri = child.priority ? ` [${child.priority}]` : "";
            const childLoe = child.loe !== undefined ? ` (LoE: ${child.loe}w)` : "";
            lines.push({ marker: "+", level: "child", title: `↳ ${child.title}`, suffix: `${childPri}${childLoe}`, indent: 3 });
            addCount++;
          }
        } else if (taskExists) {
          lines.push({ marker: "=", level: "task", title: t.title, suffix: pri, indent: 2 });
          unchangedCount++;
        } else {
          lines.push({ marker: "+", level: "task", title: t.title, suffix: pri, indent: 2 });
          addCount++;
        }
      }
    }
  }

  const output: string[] = [];

  for (const line of lines) {
    const indent = "  ".repeat(line.indent);
    output.push(`${line.marker} ${indent}[${line.level}] ${line.title}${line.suffix}`);
  }

  output.push("");

  const parts: string[] = [];
  if (addCount > 0) parts.push(`${addCount} to add`);
  if (unchangedCount > 0) parts.push(`${unchangedCount} unchanged`);
  output.push(`Summary: ${parts.join(", ")}`);

  return output.join("\n");
}
