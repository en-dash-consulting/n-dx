/**
 * The Analysis page's two treatments, drawn: a zone the recommended next
 * steps name carries a "!", a zone only flagged for attention carries a
 * hollow ring and never a "!", and a plain zone carries neither — on a row,
 * on a card, and in the declared blocks every Graview face resolves.
 */
import { placesOf } from "@graview/core/seat";
import { describePlace, resolveFor } from "@graview/core/describe";
import type { Principal } from "@graview/core";
import { compileDocumentFiles, type DocumentFiles } from "@graview/core/testing";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { markOf } from "../src/model/code.js";
import { nodesOf, type Node } from "../src/model/graph.js";
import { Mark, RecordCard, RecordRow, type Ctx } from "../src/ui/kit.js";
import { ZoneScreen } from "../src/ui/screens/zone.js";

const DECLARATION = new URL("../../graview/n-dx.graview.json", import.meta.url);
const SEED = new URL("./fixtures/snapshot.json", import.meta.url);
const SEAT: Principal = { kind: "human", id: "test", name: "Test" } as Principal;

let files: DocumentFiles;
let app: App;
let context: Ctx;
let zone: (id: string) => Node;

beforeAll(() => {
  files = compileDocumentFiles(DECLARATION, { seed: SEED });
  app = files.app as App;
  const store = files.store();
  context = { store, principal: SEAT, brand: app.brand } as unknown as Ctx;
  zone = (id) => nodesOf(store, "zone").find((z) => z.id === id)! as Node;
});

const html = (element: ReactElement): string => renderToStaticMarkup(createElement(MemoryRouter, null, element));

describe("the needs-work mark", () => {
  it("reads the projection's flags, needs-work first", () => {
    expect(markOf(zone("llm-client/src-4"))).toBe("needs-work");
    expect(markOf(zone("tests-e2e"))).toBe("highlighted");
    expect(markOf(zone("hench"))).toBeUndefined();
    // A sub-zone past the thresholds is not flagged: the Analysis page counts top-level zones only.
    expect(markOf(zone("hench/quota"))).toBeUndefined();
    expect(markOf({ kind: "change" })).toBeUndefined();
  });

  it("draws a '!' on a row and a card for a zone that needs work, naming the recommendation", () => {
    for (const element of [createElement(RecordRow, { context, node: zone("llm-client/src-4") }), createElement(RecordCard, { context, node: zone("llm-client/src-4") })]) {
      const out = html(element);
      expect(out).toContain('data-mark="needs-work"');
      expect(out).toMatch(/data-mark="needs-work"[^>]*>!<\/span>/);
      expect(out).toContain("Needs work: Split the loosely related files out of this zone");
      expect(out).not.toContain('data-mark="highlighted"');
    }
  });

  it("draws a ring, not a '!', on a zone only flagged for attention", () => {
    for (const element of [createElement(RecordRow, { context, node: zone("tests-e2e") }), createElement(RecordCard, { context, node: zone("tests-e2e") })]) {
      const out = html(element);
      expect(out).toContain('data-mark="highlighted"');
      expect(out).toContain('aria-label="Flagged for attention"');
      expect(out).not.toContain('data-mark="needs-work"');
      expect(out).not.toContain(">!<");
    }
  });

  it("draws nothing on a plain zone", () => {
    expect(html(createElement(Mark, { node: zone("hench") }))).toBe("");
    expect(html(createElement(RecordRow, { context, node: zone("hench") }))).not.toContain("data-mark");
  });
});

/**
 * What a screen reader names an element: its text, with an `aria-hidden`
 * subtree dropped and a labelled image read by its label. Enough for the
 * flat spans the marks and badges are.
 */
function accessibleName(markup: string): string {
  return markup
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<span[^>]*aria-label="([^"]*)"[^>]*>[^<]*<\/span>/g, " $1 ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the mark inside a badge", () => {
  it("is hidden from a screen reader and carries no name of its own", () => {
    for (const id of ["llm-client/src-4", "tests-e2e"]) {
      const out = html(createElement(Mark, { node: zone(id), decorative: true }));
      expect(out, id).toContain('aria-hidden="true"');
      expect(out, id).not.toContain("aria-label");
      expect(out, id).not.toContain("role=");
      expect(accessibleName(out), id).toBe("");
    }
  });

  it("keeps its name on a row and a card", () => {
    expect(html(createElement(Mark, { node: zone("llm-client/src-4") }))).toContain('aria-label="Needs work: Split the loosely related files out of this zone"');
    expect(html(createElement(RecordRow, { context, node: zone("tests-e2e") }))).toContain('aria-label="Flagged for attention"');
  });

  it("lets the zone page's badge say the needs-work words once", () => {
    const page = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [`/zones/${encodeURIComponent("llm-client/src-4")}`] },
        createElement(Routes, null, createElement(Route, { path: "/zones/:id", element: createElement(ZoneScreen, { context, app }) })),
      ),
    );
    const badge = page.match(/<span class="ndx-badge bad plain">(.*?)<\/span>(?=<span class="ndx-badge|<\/div>)/)?.[1];
    expect(badge).toBeDefined();
    const name = accessibleName(badge!);
    expect(name.match(/Split the loosely related files out of this zone/g)).toHaveLength(1);
    expect(name.match(/needs work/gi)).toHaveLength(1);
  });
});

describe("the declared treatments every face resolves", () => {
  const badges = (node: Node): string[] =>
    JSON.stringify(resolveFor(files.store(), SEAT, node, { app, today: "2026-10-10" }))
      .match(/"t":"badge"[^}]*"text":"[^"]*"|"text":"[^"]*"[^}]*"t":"badge"/g) ?? [];

  it("puts a '!' badge on a needs-work zone's page and a distinct badge on a flagged one", () => {
    expect(badges(zone("llm-client/src-4")).some((b) => b.includes('"text":"!"'))).toBe(true);
    const flagged = badges(zone("tests-e2e"));
    expect(flagged.some((b) => b.includes('"text":"needs attention"'))).toBe(true);
    expect(flagged.some((b) => b.includes('"text":"!"'))).toBe(false);
    expect(badges(zone("hench")).some((b) => b.includes('"text":"!"') || b.includes("needs attention"))).toBe(false);
  });

  it("lists the zones that need work on the home", () => {
    const home = describePlace(files.store(), SEAT, placesOf(app).find((p) => p.slug === "home" || (p.kind === undefined && !p.lens))!, { app, today: "2026-10-10" });
    const text = JSON.stringify(home);
    expect(text).toContain("Needs work");
    expect(text).toContain("llm-client/src-4");
  });
});
