/**
 * The plain-language `summary` on v2 changes, tasks and subtasks: the schema
 * takes it as intent, `add_item` / `edit_item` / `get_item` carry it, it
 * survives the v1 projection and a write, and analyze proposals bring it into
 * the changes they create.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "../../src/store/index.js";
import { handleAddItem, handleEditItem, handleGetItem } from "../../src/cli/mcp-tools/index.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { ChangeIntentSchema, SubtaskIntentSchema, TaskIntentSchema } from "../../src/schema/v2.js";
import { changeLayerFromItems, changeLayerItems } from "../../src/core/layer-projection.js";
import { changeInputsFromProposals } from "../../src/recommend/changes-from-proposals.js";
import { parseProposalResponse } from "../../src/analyze/reason.js";
import { copyV2Fixture, FIXTURE_CHANGE } from "../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const SUMMARY = "Shoppers can pay with Apple Pay, so fewer of them give up at checkout.";
const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-summary-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const text = (r: { content: { text: string }[] }) => r.content[0].text;
const add = async (args: Parameters<typeof handleAddItem>[3]) =>
  handleAddItem(await resolveStore(rexDir), tmp, rexDir, args);
const edit = async (args: Parameters<typeof handleEditItem>[2]) =>
  handleEditItem(await resolveStore(rexDir), tmp, args);
const getItem = async (id: string) =>
  JSON.parse(text(await handleGetItem(await resolveStore(rexDir), rexDir, { id }))).item;

async function nodeById(id: string) {
  const model = await loadPrdModel(rexDir, quiet);
  return indexTree(model.tree, { includeTombstones: true }).resolve(id);
}

describe("summary in the v2 schema", () => {
  const base = { id: "x", title: "T", slug: "t" };
  it.each([
    ["change", ChangeIntentSchema],
    ["task", TaskIntentSchema],
    ["subtask", SubtaskIntentSchema],
  ] as const)("a %s accepts a string summary and refuses any other value", (type, schema) => {
    expect(schema.parse({ ...base, type, summary: SUMMARY }).summary).toBe(SUMMARY);
    expect(schema.safeParse({ ...base, type }).success).toBe(true);
    expect(schema.safeParse({ ...base, type, summary: 3 }).success).toBe(false);
  });
});

describe("summary through add_item, get_item and edit_item", () => {
  it("add_item stores a change's summary as frontmatter after the header keys, and get_item returns it", async () => {
    const res = await add({ type: "change", title: "Wallets", summary: SUMMARY, description: "Card-only checkout loses iPhone shoppers.", touches: [CAPABILITY] });
    expect(res.isError).toBeFalsy();
    const { id } = JSON.parse(text(res));
    expect(await getItem(id)).toMatchObject({ id, type: "change", summary: SUMMARY, intent: "Card-only checkout loses iPhone shoppers." });

    const md = await readFile(join(rexDir, "changes", (await nodeById(id))!.slug, "index.md"), "utf-8");
    const keys = md.split("---")[1].split("\n").map((l) => l.split(":")[0]).filter(Boolean);
    expect(keys.indexOf("summary")).toBe(keys.indexOf("slug") + 1);
    expect(keys.indexOf("summary")).toBeLessThan(keys.indexOf("intent"));
  });

  it("add_item stores a task's and a subtask's summary", async () => {
    const task = JSON.parse(text(await add({ type: "task", title: "Test on Safari", parentId: "CH-1", summary: "Checks Apple Pay works in Safari." })));
    const sub = JSON.parse(text(await add({ type: "subtask", title: "iOS 18", parentId: task.id, summary: "Covers the newest iPhones." })));
    expect((await nodeById(task.id))?.summary).toBe("Checks Apple Pay works in Safari.");
    expect((await nodeById(sub.id))?.summary).toBe("Covers the newest iPhones.");
  });

  it("add_item without a summary writes none", async () => {
    const { id } = JSON.parse(text(await add({ type: "change", title: "Plain", touches: [CAPABILITY] })));
    expect(await nodeById(id)).not.toHaveProperty("summary");
  });

  it("edit_item sets a summary and an empty string removes it", async () => {
    const set = await edit({ id: FIXTURE_CHANGE, summary: SUMMARY });
    expect(set.isError).toBeFalsy();
    expect(JSON.parse(text(set)).updatedFields).toEqual(["summary"]);
    expect((await nodeById(FIXTURE_CHANGE))?.summary).toBe(SUMMARY);
    // The rest of the change's intent is untouched.
    expect((await nodeById(FIXTURE_CHANGE))?.intent).toBe("Shoppers on iPhone abandon at the card form.");

    const cleared = await edit({ id: FIXTURE_CHANGE, summary: "" });
    expect(cleared.isError).toBeFalsy();
    expect(await nodeById(FIXTURE_CHANGE)).not.toHaveProperty("summary");
    const md = await readFile(join(rexDir, "changes", "add-apple-pay", "index.md"), "utf-8");
    expect(md).not.toMatch(/^summary:/m);
  });
});

describe("summary through the v1 projection", () => {
  it("survives changeLayerItems and changeLayerFromItems", async () => {
    const model = await loadPrdModel(rexDir, quiet);
    const tree = structuredClone(model.tree);
    indexTree(tree).resolve(FIXTURE_CHANGE)!.summary = SUMMARY;
    const items = changeLayerItems(tree.changes);
    expect(items[0].summary).toBe(SUMMARY);
    const back = changeLayerFromItems(items, tree.changes);
    expect(back.changes[0].summary).toBe(SUMMARY);
  });
});

describe("summary from analyze proposals", () => {
  it("a parsed proposal keeps each task's and feature's summary, and one without it still parses", () => {
    const raw = JSON.stringify([
      {
        epic: { title: "Checkout" },
        features: [
          {
            title: "Wallets",
            summary: "Lets shoppers pay with a phone wallet.",
            tasks: [
              { title: "Add Apple Pay button", summary: SUMMARY, description: "Render the button on Safari." },
              { title: "Add Google Pay button", description: "Render the button on Chrome." },
            ],
          },
        ],
      },
    ]);
    const [proposal] = parseProposalResponse(raw);
    expect(proposal.features[0].summary).toBe("Lets shoppers pay with a phone wallet.");
    expect(proposal.features[0].tasks[0].summary).toBe(SUMMARY);
    expect(proposal.features[0].tasks[1].summary).toBeUndefined();
  });

  it("changeInputsFromProposals carries summary onto the change and its tasks", () => {
    const [input] = changeInputsFromProposals([
      {
        title: "Add Apple Pay button",
        summary: SUMMARY,
        subtasks: [{ title: "Wire the button", summary: "Connects the button to payments." }, { title: "Style it" }],
      },
    ]);
    expect(input).toMatchObject({ type: "change", title: "Add Apple Pay button", summary: SUMMARY });
    expect(input.tasks?.[0]).toMatchObject({ type: "task", summary: "Connects the button to payments." });
    expect(input.tasks?.[1]).not.toHaveProperty("summary");
  });
});

describe("summary from a description add (the dashboard's capture bar)", () => {
  /** Run cmdAddChangesFromDescriptions and return what it printed. */
  async function run(texts: string[], flags: Record<string, string>): Promise<string> {
    const { cmdAddChangesFromDescriptions } = await import("../../src/cli/commands/add-change.js");
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(" ")); });
    try {
      await cmdAddChangesFromDescriptions(tmp, texts, flags);
    } finally {
      spy.mockRestore();
    }
    return out.join("\n");
  }

  it("--summary sets the summary of the change it creates, and shows in the JSON preview", async () => {
    const preview = JSON.parse(await run(["Add Apple Pay at checkout"], { format: "json", summary: `  "${SUMMARY}"  ` }));
    expect(preview.changes[0].summary).toBe(SUMMARY);
    await run(["Add Apple Pay at checkout"], { format: "json", accept: "true", summary: SUMMARY });
    const model = await loadPrdModel(rexDir, quiet);
    const created = indexTree(model.tree).entries.map((e) => e.node).find((n) => n.title === "Add Apple Pay at checkout");
    expect((created as { summary?: string } | undefined)?.summary).toBe(SUMMARY);
  });

  it("drafts with the given completer, cleaned to one line, and skips a failed draft", async () => {
    const { draftSummariesWith, summaryPrompt } = await import("../../src/cli/commands/add-change.js");
    const prompts: string[] = [];
    const drafts = await draftSummariesWith(["first change", "second change"], async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes("second")) throw new Error("model down");
      return "\n  \"Shoppers pay faster.\n It is worth it.\"  ";
    });
    expect(drafts).toEqual(["Shoppers pay faster. It is worth it.", undefined]);
    expect(prompts[0]).toBe(summaryPrompt("first change"));
    expect(prompts[0]).toContain("does not write code");
  });

  it("cleanSummary takes off only a pair of quotes around the whole summary", async () => {
    const { cleanSummary } = await import("../../src/cli/commands/add-change.js");
    expect(cleanSummary('Adds a button labelled "Undo"')).toBe('Adds a button labelled "Undo"');
    expect(cleanSummary("Saves the admins'")).toBe("Saves the admins'");
    expect(cleanSummary("'Wrapped once'")).toBe("Wrapped once");
    expect(cleanSummary(' "“Wrapped twice”" ')).toBe("Wrapped twice");
    expect(cleanSummary('""')).toBeUndefined();
  });

  it("--summary keeps a long summary the user typed whole, and is refused for several changes", async () => {
    const long = "word ".repeat(120).trim();
    const preview = JSON.parse(await run(["Add Apple Pay at checkout"], { format: "json", summary: long }));
    expect(preview.changes[0].summary).toBe(long);
    await expect(run(["Refunds", "Gift cards"], { format: "json", summary: "Shoppers get money back" }))
      .rejects.toThrow(/one change's summary/);
  });

  it("cleanSummary caps a long draft and treats blank as none", async () => {
    const { cleanSummary, SUMMARY_MAX_CHARS } = await import("../../src/cli/commands/add-change.js");
    expect(cleanSummary("   ")).toBeUndefined();
    const long = cleanSummary("word ".repeat(200))!;
    expect(long.length).toBe(SUMMARY_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
});
