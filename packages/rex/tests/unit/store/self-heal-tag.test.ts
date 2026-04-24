import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore, ensureRexDir } from "../../../src/store/file-adapter.js";
import {
  SELF_HEAL_TAG,
  SELF_HEAL_ENV_VAR,
  isSelfHealRun,
  withSelfHealTag,
} from "../../../src/store/self-heal-tag.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

function makeDoc(title: string, items: PRDItem[]): PRDDocument {
  return { schema: SCHEMA_VERSION, title, items };
}

function makeEpic(id: string, title: string, tags?: string[]): PRDItem {
  const item: PRDItem = { id, title, status: "pending", level: "epic" };
  if (tags) item.tags = tags;
  return item;
}

/**
 * Run `fn` with NDX_SELF_HEAL set, restoring the prior value afterwards.
 * Works with parallel suites because mutations are scoped to one call each.
 */
async function withSelfHealEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env[SELF_HEAL_ENV_VAR];
  process.env[SELF_HEAL_ENV_VAR] = "1";
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[SELF_HEAL_ENV_VAR];
    } else {
      process.env[SELF_HEAL_ENV_VAR] = prev;
    }
  }
}

describe("self-heal tag helpers", () => {
  afterEach(() => {
    delete process.env[SELF_HEAL_ENV_VAR];
  });

  it("isSelfHealRun is false when NDX_SELF_HEAL is unset", () => {
    delete process.env[SELF_HEAL_ENV_VAR];
    expect(isSelfHealRun()).toBe(false);
  });

  it("isSelfHealRun is true for '1' and 'true'", () => {
    process.env[SELF_HEAL_ENV_VAR] = "1";
    expect(isSelfHealRun()).toBe(true);
    process.env[SELF_HEAL_ENV_VAR] = "true";
    expect(isSelfHealRun()).toBe(true);
  });

  it("isSelfHealRun is false for other values", () => {
    process.env[SELF_HEAL_ENV_VAR] = "0";
    expect(isSelfHealRun()).toBe(false);
    process.env[SELF_HEAL_ENV_VAR] = "false";
    expect(isSelfHealRun()).toBe(false);
  });

  it("withSelfHealTag returns the input untouched outside a self-heal run", () => {
    delete process.env[SELF_HEAL_ENV_VAR];
    const item = { tags: ["a"] };
    expect(withSelfHealTag(item)).toBe(item);
  });

  it("withSelfHealTag appends the tag inside a self-heal run", async () => {
    await withSelfHealEnv(() => {
      const tagged = withSelfHealTag({ tags: ["a"] });
      expect(tagged.tags).toEqual(["a", SELF_HEAL_TAG]);
    });
  });

  it("withSelfHealTag seeds tags when the item has none", async () => {
    await withSelfHealEnv(() => {
      const tagged = withSelfHealTag<{ tags?: string[] }>({});
      expect(tagged.tags).toEqual([SELF_HEAL_TAG]);
    });
  });

  it("withSelfHealTag does not duplicate an existing tag", async () => {
    await withSelfHealEnv(() => {
      const tagged = withSelfHealTag({ tags: [SELF_HEAL_TAG, "other"] });
      expect(tagged.tags).toEqual([SELF_HEAL_TAG, "other"]);
    });
  });
});

describe("FileStore self-heal tagging", () => {
  let projectDir: string;
  let rexDir: string;
  let store: FileStore;

  async function setup(): Promise<void> {
    projectDir = await mkdtemp(join(tmpdir(), "rex-self-heal-"));
    rexDir = join(projectDir, ".rex");
    await ensureRexDir(rexDir);
    store = new FileStore(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(
      join(rexDir, "prd.json"),
      toCanonicalJSON(makeDoc("Primary", [])),
      "utf-8",
    );
  }

  afterEach(async () => {
    delete process.env[SELF_HEAL_ENV_VAR];
    if (rexDir) await rm(rexDir, { recursive: true, force: true });
  });

  it("tags items created inside a self-heal run", async () => {
    await setup();
    await withSelfHealEnv(async () => {
      await store.addItem(makeEpic("e1", "Healed Epic"));
    });
    const doc = await store.loadDocument();
    expect(doc.items[0].tags).toContain(SELF_HEAL_TAG);
  });

  it("does not tag items created outside a self-heal run", async () => {
    await setup();
    await store.addItem(makeEpic("e1", "Manual Epic"));
    const doc = await store.loadDocument();
    expect(doc.items[0].tags).toBeUndefined();
  });

  it("preserves pre-existing tags when adding the self-heal tag", async () => {
    await setup();
    await withSelfHealEnv(async () => {
      await store.addItem(makeEpic("e1", "Mixed Epic", ["domain"]));
    });
    const doc = await store.loadDocument();
    expect(doc.items[0].tags).toEqual(["domain", SELF_HEAL_TAG]);
  });

  it("does not duplicate the tag when the input already carries it", async () => {
    await setup();
    await withSelfHealEnv(async () => {
      await store.addItem(makeEpic("e1", "Pre-tagged", [SELF_HEAL_TAG]));
    });
    const doc = await store.loadDocument();
    expect(doc.items[0].tags).toEqual([SELF_HEAL_TAG]);
  });

  it("updateItem inside a self-heal run does NOT add the tag to an existing item", async () => {
    await setup();
    // Seed an item outside of self-heal.
    await store.addItem(makeEpic("e1", "Pre-existing"));

    await withSelfHealEnv(async () => {
      await store.updateItem("e1", { status: "in_progress" });
    });
    const doc = await store.loadDocument();
    expect(doc.items[0].status).toBe("in_progress");
    expect(doc.items[0].tags).toBeUndefined();
  });
});
