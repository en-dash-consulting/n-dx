/**
 * Headless: the declaration n-dx emits compiles from where it lives
 * (`compileDocumentFiles` reads ../graview/n-dx.graview.json by path, so
 * there is no copy to drift), every titled lens draws as a place over a
 * real-shaped snapshot, and this face's registry builds over it.
 */
import { placesOf, type Principal } from "@graview/core";
import { describePlace } from "@graview/core/describe";
import { compileDocumentFiles, type DocumentFiles } from "@graview/core/testing";
import { describe, expect, it, beforeAll } from "vitest";
import type { App } from "../src/app.js";
import { pages } from "../src/ui/pages.js";
import { views } from "../src/ui/views.js";
import { attention, standing } from "../src/model/work.js";
import { spend } from "../src/model/spend.js";

export const DECLARATION = new URL("../../graview/n-dx.graview.json", import.meta.url);
export const SEED = new URL("./fixtures/snapshot.json", import.meta.url);
const SEAT: Principal = { kind: "human", id: "test", name: "Test" } as Principal;

let files: DocumentFiles;
let app: App;
let store: ReturnType<DocumentFiles["store"]>;

beforeAll(() => {
  files = compileDocumentFiles(DECLARATION, { seed: SEED });
  app = files.app as App;
  store = files.store();
});

describe("the declaration n-dx emits", () => {
  it("compiles with nothing the checker calls an error", () => {
    expect(files.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("names every kind the snapshot carries", () => {
    const kinds = new Set(files.seed!.nodes.map((n) => n.kind));
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

  it("says whether the map is proposed as a fact of the whole graph, read by every face", () => {
    const home = describePlace(store, SEAT, placesOf(app).find((p) => p.slug === "home" || p.kind === undefined && !p.lens)!, { app, today: "2026-10-10" });
    expect(JSON.stringify(home)).toContain("mapProposed");
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
