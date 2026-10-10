/**
 * `emitProjection` writes exactly two files under the layout's graview dir,
 * deterministically, and touches nothing else n-dx owns.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveLayout } from "../../src/llm-gateway.js";
import { emitProjection, DOCUMENT_FILENAME, SNAPSHOT_FILENAME } from "../../src/emit.js";
import { makeProject } from "../helpers/project.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Every file under `dir` with its mtime and size, so a write anywhere shows. */
function fingerprint(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const s = statSync(p);
        out.set(relative(dir, p), `${s.size}:${s.mtimeMs}`);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

describe("emitProjection", () => {
  for (const layoutMode of ["legacy", "ndx"] as const) {
    it(`writes document.json and snapshot.json under the ${layoutMode} layout's graview dir and nothing elsewhere`, async () => {
      const root = makeProject({ layout: layoutMode });
      roots.push(root);
      const layout = resolveLayout(root);
      const before = {
        rex: fingerprint(layout.rexDir),
        sv: fingerprint(layout.sourcevisionDir),
        hench: fingerprint(layout.henchDir),
      };

      const result = await emitProjection(root, { warn: () => {} });
      expect(result.graviewDir).toBe(layout.graviewDir);
      expect(result.graviewDir.endsWith(layoutMode === "ndx" ? join(".ndx", "graview") : ".graview")).toBe(true);
      expect(readdirSync(result.graviewDir).sort()).toEqual([DOCUMENT_FILENAME, SNAPSHOT_FILENAME].sort());

      const document = JSON.parse(readFileSync(result.documentPath, "utf-8")) as { format: string; name: string };
      expect(document.format).toBe("graview-document");
      expect(document.name).toBe(relative(join(root, ".."), root));
      const snapshot = JSON.parse(readFileSync(result.snapshotPath, "utf-8")) as { nodes: unknown[]; edges: unknown[] };
      expect(snapshot.nodes.length).toBe(Object.entries(result.counts).filter(([k]) => k !== "edges").reduce((n, [, c]) => n + c, 0));
      expect(snapshot.edges.length).toBe(result.counts.edges);

      expect(fingerprint(layout.rexDir)).toEqual(before.rex);
      expect(fingerprint(layout.sourcevisionDir)).toEqual(before.sv);
      expect(fingerprint(layout.henchDir)).toEqual(before.hench);
    });
  }

  it("writes the same bytes twice for an unchanged checkout", async () => {
    const root = makeProject();
    roots.push(root);
    const first = await emitProjection(root, { warn: () => {} });
    const a = [readFileSync(first.documentPath, "utf-8"), readFileSync(first.snapshotPath, "utf-8")];
    const second = await emitProjection(root, { warn: () => {} });
    const b = [readFileSync(second.documentPath, "utf-8"), readFileSync(second.snapshotPath, "utf-8")];
    expect(b).toEqual(a);
    expect(a[1]!.endsWith("\n")).toBe(true);
  });

  it("takes an explicit project name", async () => {
    const root = makeProject();
    roots.push(root);
    const result = await emitProjection(root, { projectName: "Checkout", warn: () => {} });
    expect((JSON.parse(readFileSync(result.documentPath, "utf-8")) as { name: string }).name).toBe("Checkout");
  });
});
