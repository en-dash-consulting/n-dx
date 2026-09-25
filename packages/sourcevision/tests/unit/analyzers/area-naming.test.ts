import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return { getJudgmentRoute: vi.fn(() => undefined), ClaudeClientError: actual.ClaudeClientError, callClaude: vi.fn(), setClaudeConfig: vi.fn() };
});

import { applyGeneratedAreaNames, nameAreas } from "../../../src/analyzers/area-naming.js";
import type { ZoneArea } from "../../../src/schema/index.js";
import { makeZone } from "./zones-helpers.js";

const template: ZoneArea = { id: "utils-and-e2e", name: "Utils & E2e", zones: ["a", "b"], files: 6, nameSource: "template" };
const zones = [makeZone("a", ["src/a/x.ts", "src/a/y.ts"]), makeZone("b", ["src/b/x.ts"])];

describe("nameAreas", () => {
  it("carries a judged or generated name forward for an identical zone set, asking nothing", async () => {
    const previous: ZoneArea[] = [{ id: "site-core", name: "Site Core", zones: ["a", "b"], files: 6, nameSource: "generated" }];
    const { areas, pending } = await nameAreas([template], zones, { previous });
    expect(areas[0]).toMatchObject({ id: "site-core", name: "Site Core", nameSource: "generated" });
    expect(pending).toEqual([]);
  });

  it("leaves templated names alone without a judgment route", async () => {
    const { areas, pending } = await nameAreas([template], zones);
    expect(areas).toEqual([template]);
    expect(pending).toEqual([]);
  });
});

describe("applyGeneratedAreaNames", () => {
  it("renames areas from area:<id> pseudo-zones and re-derives their ids", () => {
    const { areas: out, renamed } = applyGeneratedAreaNames([template], [makeZone("area:utils-and-e2e", ["x.ts"], { name: "Site Core & Admin" })]);
    expect(renamed).toEqual(["utils-and-e2e"]);
    expect(out[0]).toMatchObject({ id: "site-core-and", name: "Site Core & Admin", nameSource: "generated" });
  });
});
