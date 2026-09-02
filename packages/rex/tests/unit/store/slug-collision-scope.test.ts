/**
 * Tests for the title-only slug rule and the guards that replace the
 * unconditional `-{id6}` suffix it removed.
 *
 * Acceptance criteria:
 *   - `slugify` returns a title-only slug with no id-derived component
 *   - Siblings that collide on a normalised title all take an `-{id6}` suffix
 *   - A slug does not depend on sibling order
 *   - `resolveSiblingSlugs` never maps two siblings onto one path
 *   - `findTreeIdentityFaults` catches the divergent-branch merge case
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveSiblingSlugs,
  serializeFolderTree,
  slugify,
  slugifyTitle,
  findTreeIdentityFaults,
} from "../../../src/store/folder-tree-serializer.js";
import type { PRDItem } from "../../../src/schema/index.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `slug-collision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function item(id: string, title: string, children: PRDItem[] = []): PRDItem {
  return {
    id,
    title,
    level: children.length > 0 ? "epic" : "task",
    status: "pending",
    children,
  } as PRDItem;
}

const ID_A = "aaaaaaaa-0000-0000-0000-000000000000";
const ID_B = "bbbbbbbb-0000-0000-0000-000000000000";
const ID_C = "cccccccc-0000-0000-0000-000000000000";

describe("slugify", () => {
  it("returns a title-only slug with no id-derived component", () => {
    expect(slugify("Web Dashboard")).toBe("web-dashboard");
    expect(slugifyTitle("Web Dashboard")).toBe("web-dashboard");
  });

  it("still normalises separators, accents, and empty titles", () => {
    expect(slugify("Path / Separator \\ Safe!")).toBe("path-separator-safe");
    expect(slugify("Héros & Légendes")).toBe("heros-legendes");
    expect(slugify("日本語タイトル")).toBe("untitled");
  });
});

describe("resolveSiblingSlugs", () => {
  it("leaves a unique title unsuffixed", () => {
    const slugs = resolveSiblingSlugs([item(ID_A, "Rex"), item(ID_B, "Hench")]);
    expect(slugs.get(ID_A)).toBe("rex");
    expect(slugs.get(ID_B)).toBe("hench");
  });

  it("suffixes every member of a colliding set, not just the later ones", () => {
    const slugs = resolveSiblingSlugs([item(ID_A, "Rex"), item(ID_B, "Rex")]);
    // Both, so that adding a sibling never renames an existing path.
    expect(slugs.get(ID_A)).toBe("rex-aaaaaa");
    expect(slugs.get(ID_B)).toBe("rex-bbbbbb");
  });

  it("does not suffix a unique sibling just because another set collides", () => {
    const slugs = resolveSiblingSlugs([
      item(ID_A, "Rex"),
      item(ID_B, "Rex"),
      item(ID_C, "Hench"),
    ]);
    expect(slugs.get(ID_C)).toBe("hench");
  });

  it("produces the same slug regardless of sibling order", () => {
    const forward = resolveSiblingSlugs([item(ID_A, "Rex"), item(ID_B, "Rex")]);
    const reversed = resolveSiblingSlugs([item(ID_B, "Rex"), item(ID_A, "Rex")]);
    expect(forward.get(ID_A)).toBe(reversed.get(ID_A));
    expect(forward.get(ID_B)).toBe(reversed.get(ID_B));
  });

  it("never maps two siblings onto one path", () => {
    const items = [item(ID_A, "Rex"), item(ID_B, "Rex"), item(ID_C, "Rex")];
    const slugs = [...resolveSiblingSlugs(items).values()];
    expect(new Set(slugs).size).toBe(items.length);
  });

  it("writes every same-titled sibling to its own directory", async () => {
    // The mutation path used a per-item slug and lost all but the last.
    const items = [item(ID_A, "Rex"), item(ID_B, "Rex"), item(ID_C, "Rex")];
    await serializeFolderTree(items, testDir);
    const entries = (await readdir(testDir)).filter((e) => e.endsWith(".md"));
    expect(entries).toHaveLength(3);
  });
});

describe("findTreeIdentityFaults", () => {
  it("reports nothing for a well-formed tree", async () => {
    const items = [item(ID_A, "Rex"), item(ID_B, "Hench")];
    await serializeFolderTree(items, testDir);
    expect(await findTreeIdentityFaults(items, testDir)).toEqual([]);
  });

  it("catches two items claiming one id", async () => {
    const items = [item(ID_A, "Rex"), item(ID_A, "Hench")];
    const faults = await findTreeIdentityFaults(items, testDir);
    expect(faults.map((f) => f.kind)).toContain("duplicate-id");
  });

  it("catches the divergent-branch merge landing two items on one path", async () => {
    // Branch A and branch B each add a "Shared Feature" under the same parent.
    // Neither sees a local collision, so each writes the same title-only path.
    // The merge leaves one file where the tree expects the other.
    const branchA = [item(ID_A, "Shared Feature")];
    await serializeFolderTree(branchA, testDir);

    // The tree now believes the item at that path is B's.
    const branchB = [item(ID_B, "Shared Feature")];
    const faults = await findTreeIdentityFaults(branchB, testDir);

    expect(faults).toHaveLength(1);
    expect(faults[0].kind).toBe("path-id-mismatch");
    expect(faults[0].detail).toContain(ID_A);
    expect(faults[0].where).toContain("shared-feature");
  });

  it("ignores an item whose file is simply missing", async () => {
    const faults = await findTreeIdentityFaults([item(ID_A, "Absent")], testDir);
    expect(faults).toEqual([]);
  });
});
