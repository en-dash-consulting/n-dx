/**
 * The numbers the home, the Inbox, the attention page and the area cards
 * show, over a small seed written for them: an open and a finished change
 * that rex never placed (only the open one waits in the Inbox), and an area
 * whose cards count its capabilities met and the open changes placed on it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeSnapshot } from "@graview/core/snapshot";
import { compileDocumentFiles } from "@graview/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { areaStanding, attention } from "../src/model/work.js";
import { nodesOf } from "../src/model/graph.js";

const DECLARATION = new URL("../../graview/n-dx.graview.json", import.meta.url);

const change = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, kind: "change", title: id, status, ...extra });

const nodes = [
  { id: "a1", kind: "area", title: "Checkout", status: "pending" },
  { id: "cap-met", kind: "capability", title: "Pay by card", status: "pending", intentStatus: "met" },
  { id: "cap-open", kind: "capability", title: "Pay by wallet", status: "pending", intentStatus: "changing" },
  change("c-inbox-open", "pending", { inbox: true, priority: "high" }),
  change("c-inbox-done", "completed", { inbox: true }),
  change("c-inbox-cancelled", "cancelled", { inbox: true }),
  change("c-amends", "in_progress"),
  change("c-touches", "blocked"),
  change("c-done", "completed"),
];
const edges = [
  { kind: "under", from: "cap-met", to: "a1" },
  { kind: "under", from: "cap-open", to: "a1" },
  { kind: "amends", from: "c-amends", to: "cap-open" },
  { kind: "touches", from: "c-touches", to: "a1" },
  { kind: "amends", from: "c-done", to: "cap-met" },
];

let dir: string;
let store: ReturnType<ReturnType<typeof compileDocumentFiles>["store"]>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "graview-face-work-"));
  const seed = join(dir, "snapshot.json");
  writeFileSync(seed, writeSnapshot({ nodes, edges } as Parameters<typeof writeSnapshot>[0], { generatedAt: "2026-10-10T12:00:00.000Z" }));
  const files = compileDocumentFiles(DECLARATION, { seed: pathToFileURL(seed) });
  expect(files.seed?.nodes.length).toBe(nodes.length);
  store = files.store();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("attention", () => {
  it("counts only open changes as waiting in the Inbox, and says the finished ones apart", () => {
    const needs = attention(store);
    expect(needs.inbox.map((c) => c.id)).toEqual(["c-inbox-open"]);
    expect(needs.placedNever.map((c) => c.id).sort()).toEqual(["c-inbox-cancelled", "c-inbox-done"]);
    // The Inbox's one change and the blocked one; a finished unplaced change needs no one.
    expect(needs.total).toBe(2);
  });
});

describe("an area's card", () => {
  it("counts its capabilities, those met, and the open changes placed on it or on them", () => {
    const area = nodesOf(store, "area").find((a) => a.id === "a1")!;
    expect(areaStanding(store, area)).toEqual({ capabilities: 2, met: 1, open: 2 });
  });
});
