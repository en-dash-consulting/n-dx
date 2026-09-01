/**
 * A mass removal must be legible as a re-layout, not as data loss.
 *
 * The PRD tree's slug rule changed once, and because every save rewrites the
 * whole tree, a single status edit landed a commit with 762 deletions in it.
 * That read as the PRD being destroyed, and disproving it meant counting items
 * by hand on both sides of the commit (972 before, 972 after). This report
 * exists so that comparison is printed at the moment it is needed.
 */

import { describe, it, expect } from "vitest";
import { reportLayoutChurn } from "../../../src/store/folder-tree-store.js";
import type { SerializeResult } from "../../../src/store/folder-tree-serializer.js";

function result(over: Partial<SerializeResult> = {}): SerializeResult {
  return {
    filesWritten: 0,
    filesSkipped: 0,
    directoriesCreated: 0,
    directoriesRemoved: 0,
    filesRemoved: 0,
    itemsWritten: 0,
    ...over,
  };
}

function capture(r: SerializeResult): string[] {
  const lines: string[] = [];
  reportLayoutChurn(r, (m) => lines.push(m));
  return lines;
}

describe("reportLayoutChurn", () => {
  it("says nothing for an ordinary save", () => {
    // The common case by far: a status edit rewrites one file and removes
    // nothing. A warning here would train people to ignore the warning.
    expect(capture(result({ filesWritten: 1, itemsWritten: 972 }))).toEqual([]);
  });

  it("says nothing when a single item moves", () => {
    // A retitled item removes exactly its old path. Still not newsworthy.
    expect(capture(result({ filesWritten: 1, filesRemoved: 1, itemsWritten: 972 }))).toEqual([]);
  });

  it("reports a migration-scale rewrite", () => {
    const [message] = capture(result({ filesRemoved: 700, directoriesRemoved: 62, itemsWritten: 972 }));

    expect(message).toBeDefined();
    // Both halves of the comparison an operator would otherwise do by hand.
    expect(message).toContain("762");
    expect(message).toContain("972");
    expect(message).toMatch(/not lost items/i);
  });

  it("counts removed FILES, not only directories", () => {
    // The rename migration moved mostly leaf `.md` files. Counting directories
    // alone reported zero for exactly the churn that needed explaining, which
    // is why filesRemoved exists as its own field.
    const [message] = capture(result({ filesRemoved: 800, directoriesRemoved: 0, itemsWritten: 972 }));

    expect(message).toBeDefined();
    expect(message).toContain("800");
  });

  it("stays quiet just below the threshold and speaks at it", () => {
    expect(capture(result({ filesRemoved: 19, itemsWritten: 5 }))).toEqual([]);
    expect(capture(result({ filesRemoved: 20, itemsWritten: 5 }))).toHaveLength(1);
  });
});
