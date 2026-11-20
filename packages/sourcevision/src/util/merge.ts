/**
 * Chunk merging for large codebases.
 * When inventory/imports are chunked by top-level directory,
 * this module merges the chunks into a single output.
 */

import type {
  FileEntry,
  Inventory,
  InventorySummary,
  ImportEdge,
  ExternalImport,
  Imports,
  FileRole,
} from "../schema/index.js";
import { sortInventory, sortImports } from "./sort.js";

/** Merge multiple inventory chunks into one */
export function mergeInventories(chunks: Inventory[]): Inventory {
  const allFiles: FileEntry[] = [];
  for (const chunk of chunks) {
    allFiles.push(...chunk.files);
  }

  // Deduplicate by path (last write wins)
  const byPath = new Map<string, FileEntry>();
  for (const f of allFiles) {
    byPath.set(f.path, f);
  }
  const files = Array.from(byPath.values());

  const summary = computeInventorySummary(files);
  return sortInventory({ files, summary });
}

export function computeInventorySummary(files: FileEntry[]): InventorySummary {
  const byLanguage: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalLines = 0;

  for (const f of files) {
    byLanguage[f.language] = (byLanguage[f.language] || 0) + 1;
    byRole[f.role] = (byRole[f.role] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    totalLines += f.lineCount;
  }

  return {
    totalFiles: files.length,
    totalLines,
    byLanguage,
    byRole: byRole as Record<FileRole, number>,
    byCategory,
  };
}

/** Merge multiple import chunks into one */
export function mergeImports(chunks: Imports[]): Imports {
  const edgeSet = new Map<string, ImportEdge>();
  const externalMap = new Map<string, ExternalImport>();

  for (const chunk of chunks) {
    for (const edge of chunk.edges) {
      const key = `${edge.from}\0${edge.to}\0${edge.type}`;
      const existing = edgeSet.get(key);
      if (existing) {
        const symbolSet = new Set([...existing.symbols, ...edge.symbols]);
        edgeSet.set(key, { ...existing, symbols: Array.from(symbolSet) });
      } else {
        edgeSet.set(key, edge);
      }
    }

    for (const ext of chunk.external) {
      const existing = externalMap.get(ext.package);
      if (existing) {
        const importedBy = new Set([...existing.importedBy, ...ext.importedBy]);
        const symbols = new Set([...existing.symbols, ...ext.symbols]);
        externalMap.set(ext.package, {
          package: ext.package,
          importedBy: Array.from(importedBy),
          symbols: Array.from(symbols),
        });
      } else {
        externalMap.set(ext.package, ext);
      }
    }
  }

  const edges = Array.from(edgeSet.values());
  const external = Array.from(externalMap.values());

  // Recompute summary
  const importCounts = new Map<string, number>();
  for (const e of edges) {
    importCounts.set(e.to, (importCounts.get(e.to) || 0) + 1);
  }

  const mostImported = Array.from(importCounts.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const fileSet = new Set<string>();
  for (const e of edges) {
    fileSet.add(e.from);
  }
  const avgImportsPerFile =
    fileSet.size > 0 ? edges.length / fileSet.size : 0;

  // Circular detection: simple DFS
  const circulars = detectCirculars(edges);

  return sortImports({
    edges,
    external,
    summary: {
      totalEdges: edges.length,
      totalExternal: external.length,
      circularCount: circulars.length,
      circulars,
      mostImported,
      avgImportsPerFile: Math.round(avgImportsPerFile * 100) / 100,
    },
  });
}

export function detectCirculars(
  edges: ImportEdge[]
): Array<{ cycle: string[] }> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: Array<{ cycle: string[] }> = [];
  const path: string[] = [];

  function dfs(node: string) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push({ cycle: path.slice(cycleStart) });
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const next of adj.get(node) || []) {
      dfs(next);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const node of adj.keys()) {
    dfs(node);
  }

  return cycles;
}

/** Determine chunk boundaries by top-level directory */
export function chunkByTopDir(
  files: string[]
): Map<string, string[]> {
  const chunks = new Map<string, string[]>();
  for (const f of files) {
    const topDir = f.split("/")[0] || ".";
    if (!chunks.has(topDir)) chunks.set(topDir, []);
    chunks.get(topDir)!.push(f);
  }
  return chunks;
}
