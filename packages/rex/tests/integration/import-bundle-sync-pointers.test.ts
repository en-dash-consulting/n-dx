/**
 * `--replace` replaces content, not the destination's sync relationship.
 *
 * `remoteId` and `lastSyncedAt` say which record in *this* project's remote an
 * item maps to, and when it was last reconciled. A bundle cannot know either —
 * export strips them so one project's pointers never reach another — so their
 * absence from a bundle is silence, not an instruction to clear.
 *
 * Read as an instruction, it cost two things on the same-project
 * export → edit → `--replace` round trip the feature documents. Every item lost
 * `lastSyncedAt`, so `isModifiedSinceSync` went true tree-wide and the next
 * `rex sync` would push everything and win every field conflict against remote
 * edits made since. And `remove-feature.ts` keys its "this item is synced, warn
 * before deleting" prompt on `remoteId`, so `rex remove` silently stopped
 * offering to clean up the remote records.
 *
 * These run through the real import so the whole chain is covered: parseBundle
 * strips whatever the bundle carried, mergeBundle restores the destination's,
 * and the store transaction stamps what changed.
 *
 * @see packages/rex/src/core/prd-bundle.ts — applyDestinationSyncPointers
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdImportBundle } from "../../src/cli/commands/import-bundle.js";
import { resolveStore } from "../../src/store/index.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { isModifiedSinceSync } from "../../src/core/sync.js";
import type { PRDItem } from "../../src/schema/index.js";

const SYNCED_AT = "2026-01-02T00:00:00.000Z";
const MODIFIED_AT = "2026-01-01T00:00:00.000Z";

function epic(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return {
    id,
    title,
    level: "epic",
    status: "pending",
    priority: "medium",
    acceptanceCriteria: [],
    ...extra,
  } as PRDItem;
}

/** An item the destination has already synced to its own remote. */
function syncedEpic(id: string, title: string): PRDItem {
  return epic(id, title, {
    lastModified: MODIFIED_AT,
    lastModifiedBy: "Author <author@example.com>",
    lastSyncedAt: SYNCED_AT,
    remoteId: `notion-${id}`,
  });
}

describe("rex import-bundle --replace and the destination's sync pointers", () => {
  let projectDir: string;
  let bundlePath: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-bundle-sync-"));
    await cmdInit(projectDir, {});

    const store = await resolveStore(join(projectDir, REX_DIR));
    await store.withTransaction(async (doc) => {
      doc.items = [syncedEpic("keep-1", "Unchanged Epic"), syncedEpic("edit-1", "Edited Epic")];
    });

    bundlePath = join(projectDir, "bundle.json");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  /** A bundle as `rex export` would produce it: no remote pointers at all. */
  async function writeBundle(items: PRDItem[]): Promise<void> {
    await writeFile(
      bundlePath,
      JSON.stringify({
        bundle: "rex/prd-bundle",
        bundleVersion: 1,
        schema: SCHEMA_VERSION,
        title: "Round Trip",
        exportedAt: "2026-01-03T00:00:00.000Z",
        items,
      }),
      "utf-8",
    );
  }

  /** The content half of a synced item, as it survives an export. */
  function exported(id: string, title: string): PRDItem {
    return epic(id, title, {
      lastModified: MODIFIED_AT,
      lastModifiedBy: "Author <author@example.com>",
    });
  }

  async function itemsAfterImport(): Promise<Map<string, PRDItem>> {
    const store = await resolveStore(join(projectDir, REX_DIR));
    const doc = await store.loadDocument();
    return new Map(doc.items.map((i) => [i.id, i]));
  }

  it("keeps the destination's remoteId and lastSyncedAt across a replace", async () => {
    await writeBundle([exported("keep-1", "Unchanged Epic"), exported("edit-1", "Edited Epic")]);

    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true", yes: "true" });

    const after = await itemsAfterImport();
    expect(after.get("keep-1")?.remoteId).toBe("notion-keep-1");
    expect(after.get("keep-1")?.lastSyncedAt).toBe(SYNCED_AT);
    expect(after.get("edit-1")?.remoteId).toBe("notion-edit-1");
  });

  it("reports only the genuinely edited item as modified since sync", async () => {
    // The consequence the pointers exist for. With `lastSyncedAt` cleared,
    // every item read as modified and the next sync pushed the whole tree.
    await writeBundle([
      exported("keep-1", "Unchanged Epic"),
      exported("edit-1", "Edited Epic, retitled in the bundle"),
    ]);

    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true", yes: "true" });

    const after = await itemsAfterImport();
    expect(isModifiedSinceSync(after.get("keep-1")!)).toBe(false);
    expect(isModifiedSinceSync(after.get("edit-1")!)).toBe(true);
  });

  it("gives an item the destination has never seen no pointers of its own", async () => {
    await writeBundle([exported("keep-1", "Unchanged Epic"), exported("new-1", "Brand New Epic")]);

    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true", yes: "true" });

    const after = await itemsAfterImport();
    expect(after.get("new-1")?.remoteId).toBeUndefined();
    expect(after.get("new-1")?.lastSyncedAt).toBeUndefined();
  });

  it("refuses to install remote pointers a bundle tried to carry", async () => {
    // The export-side guarantee has to hold at the import boundary too: a
    // hand-authored bundle must not be able to point this project's sync at
    // somebody else's records.
    await writeBundle([
      epic("new-1", "Smuggler", {
        lastSyncedAt: "2030-01-01T00:00:00.000Z",
        remoteId: "someone-elses-page",
      }),
    ]);

    await cmdImportBundle(projectDir, { in: bundlePath, replace: "true", yes: "true" });

    const after = await itemsAfterImport();
    expect(after.get("new-1")?.remoteId).toBeUndefined();
    expect(after.get("new-1")?.lastSyncedAt).toBeUndefined();
  });
});
