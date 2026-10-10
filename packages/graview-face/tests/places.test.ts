/**
 * Headless: the declaration n-dx emits compiles, every titled lens draws as a
 * place over a real-shaped snapshot, and this face's registry builds over it.
 */
import { readFileSync } from "node:fs";
import { createMemoryAdapter, placesOf, type Principal } from "@graview/core";
import { compileDocument } from "@graview/core/check";
import { describePlace } from "@graview/core/describe";
import { openStore, type GraphSnapshot } from "@graview/ship";
import { describe, expect, it, beforeAll } from "vitest";
import type { App } from "../src/app.js";
import { pages } from "../src/ui/pages.js";
import { views } from "../src/ui/views.js";
import { attention, standing } from "../src/model/work.js";
import { spend } from "../src/model/spend.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8")) as unknown;
const SEAT: Principal = { kind: "human", id: "test", name: "Test" } as Principal;

let app: App;
let store: Awaited<ReturnType<typeof openStore>>["store"];

beforeAll(async () => {
  const compiled = compileDocument(fixture("document.json"));
  expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.findings, null, 2)).toBe(true);
  if (!compiled.ok) throw new Error("refused");
  app = compiled.app as App;
  store = (await openStore({ app, adapter: createMemoryAdapter(), seed: fixture("snapshot.json") as GraphSnapshot })).store;
});

describe("the declaration n-dx emits", () => {
  it("names every kind the snapshot carries", () => {
    const kinds = new Set((fixture("snapshot.json") as GraphSnapshot).nodes.map((n) => n.kind));
    for (const kind of kinds) expect(app.schema.kinds as readonly string[]).toContain(kind);
  });

  it("titles its lenses, so each is a place", () => {
    const places = placesOf(app).filter((p) => p.lens);
    expect(places.map((p) => p.lens).sort()).toEqual(["blocks", "blocks", "calendar", "columns", "coverage", "coverage", "timeline"]);
  });

  it("draws every titled place over the snapshot", () => {
    for (const place of placesOf(app).filter((p) => p.lens)) {
      const drawn = describePlace(store, SEAT, place, { app, today: "2026-10-10" });
      const text = JSON.stringify(drawn);
      expect(text.length, place.title).toBeGreaterThan(40);
      expect(text, place.title).not.toMatch(/cannot draw/i);
    }
  });
});

describe("this face", () => {
  it("builds its views and its page registry over the compiled app", () => {
    expect(views(app)).toBeTruthy();
    expect(pages(app)).toBeTruthy();
  });

  it("reads the numbers the home shows from the store", () => {
    const s = standing(store);
    expect(s.open).toBeGreaterThan(0);
    const needs = attention(store);
    expect(needs.total).toBeGreaterThanOrEqual(0);
    const money = spend(store);
    expect(money.runs.length).toBeGreaterThan(0);
    expect(money.total).toBeGreaterThanOrEqual(0);
  });
});
