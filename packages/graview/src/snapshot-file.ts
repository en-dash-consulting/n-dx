/**
 * The snapshot file, in Graview's line format (`@graview/core/snapshot`,
 * format 2): a header line that says when the file was made and what it
 * holds, then one record per line with each kind's together, then the links.
 * A reader learns the projection's age and its counts from the first line,
 * and reads one kind's lines by the byte ranges the header gives, so the face
 * pulls the two kinds it syncs without parsing the other 3 MB.
 *
 * Written here by hand because this package has no runtime `@graview/*`
 * dependency (the binary is a peer tool). The format is on Graview's
 * stored-formats surface, and `tests/unit/snapshot-file.test.ts` holds this
 * writer byte for byte to `writeSnapshot` from `@graview/core/snapshot`.
 */
import { canonical } from "./canonical.js";
import type { GraphSnapshot, SnapshotEdge, SnapshotNode } from "./types.js";

export const SNAPSHOT_FORMAT = 2;

/** One kind's lines in the body (`kind` null: the links), by line and by byte from the body's start. */
export interface SnapshotPart {
  kind: string | null;
  line: number;
  lines: number;
  at: number;
  bytes: number;
}

export interface SnapshotHeader {
  graview: "snapshot";
  format: typeof SNAPSHOT_FORMAT;
  generatedAt: string;
  kinds: Record<string, number>;
  edges: Record<string, number>;
  parts: SnapshotPart[];
}

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

function counted<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

/**
 * The snapshot as a file. Keys are sorted at every depth before any line is
 * written, as `canonicalJson` sorts them, so the body of an unchanged
 * checkout is byte-identical; only the header's `generatedAt` moves.
 */
export function writeSnapshotFile(snapshot: GraphSnapshot, generatedAt: string | Date): string {
  const sorted = canonical(snapshot) as { nodes: SnapshotNode[]; edges: SnapshotEdge[] };
  const byKind = new Map<string, string[]>();
  for (const node of sorted.nodes) {
    const lines = byKind.get(node.kind) ?? [];
    lines.push(JSON.stringify(node));
    byKind.set(node.kind, lines);
  }
  const groups: Array<[string | null, string[]]> = [...byKind, [null, sorted.edges.map((edge) => JSON.stringify(edge))]];
  const parts: SnapshotPart[] = [];
  let line = 0;
  let at = 0;
  for (const [kind, lines] of groups) {
    const bytes = lines.reduce((sum, text) => sum + byteLength(text) + 1, 0);
    parts.push({ kind, line, lines: lines.length, at, bytes });
    line += lines.length;
    at += bytes;
  }
  const header: SnapshotHeader = {
    graview: "snapshot",
    format: SNAPSHOT_FORMAT,
    generatedAt: typeof generatedAt === "string" ? generatedAt : generatedAt.toISOString(),
    kinds: Object.fromEntries([...byKind].map(([kind, lines]) => [kind, lines.length])),
    edges: counted(sorted.edges, (edge) => edge.kind),
    parts,
  };
  return [JSON.stringify(header), ...groups.flatMap(([, lines]) => lines)].join("\n") + "\n";
}
