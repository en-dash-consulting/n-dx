import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Zone, ZoneCrossing } from "../../../src/schema/index.js";
import { ClaudeClientError } from "@n-dx/llm-client";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return {
    callClaude: vi.fn(),
    getJudgmentRoute: vi.fn(() => undefined),
    ClaudeClientError: actual.ClaudeClientError,
    DEFAULT_MODEL: "claude-sonnet-5",
  };
});

import { callClaude, getJudgmentRoute } from "../../../src/analyzers/claude-client.js";
import { narrateZones, buildMultiplexEnvelope } from "../../../src/analyzers/enrich-multiplex.js";

const mockedCallClaude = vi.mocked(callClaude);
const mockedRoute = vi.mocked(getJudgmentRoute);

function zone(id: string, files: string[], extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.5, ...extra };
}
const core = zone("core", Array.from({ length: 30 }, (_, i) => `core/f${i}.ts`), { insights: ["already known"] });
const ui = zone("ui", ["ui/a.ts", "ui/b.ts"]);
const other = zone("other", ["o/x.ts"]);
const crossings: ZoneCrossing[] = [{ from: "ui/a.ts", to: "core/f0.ts", fromZone: "ui", toZone: "core" }];
const opts = { allZones: [core, ui, other], crossings };

beforeEach(() => {
  mockedCallClaude.mockReset();
  mockedRoute.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("narrateZones", () => {
  it("narrates every zone in one call and merges insights, findings and a structure hash per zone", async () => {
    mockedCallClaude.mockResolvedValueOnce({
      text: JSON.stringify({ zones: [
        { id: "core", newInsights: ["core is a hub", "already known"], findings: [{ type: "anti-pattern", scope: "core", text: "Core has no barrel.", severity: "warning" }] },
        { id: "ui", newInsights: [], findings: [] },
      ] }),
      tokenUsage: { input: 5000, output: 400 },
    });

    const res = await narrateZones([core, ui], opts);

    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
    const [prompt, , callOpts] = mockedCallClaude.mock.calls[0];
    expect(callOpts).toEqual({ taskClass: "zone.enrich-deep" });
    expect(prompt).toContain('Zone "core"');
    expect(prompt).toContain('Zone "ui"');
    expect(prompt).toContain('Other zones in this codebase: "other"');
    expect(prompt).toContain("Return one entry per zone, 2 in total");
    expect(res.success).toBe(true);
    expect(res.tokenUsage).toEqual({ calls: 1, input: 5000, output: 400 });
    expect(res.zones.find((z) => z.id === "core")).toMatchObject({ insights: ["already known", "core is a hub"] });
    expect(res.zones.every((z) => typeof z.structureHash === "string")).toBe(true);
    expect(res.newZoneInsights.get("core")).toEqual(["core is a hub", "already known"]);
    expect(res.newFindings).toHaveLength(1);
    expect(res.newFindings[0]).toMatchObject({ pass: 2, scope: "core", text: "Core has no barrel.", severity: "warning" });
  });

  it("retries once with a smaller file sample when the answer does not parse", async () => {
    mockedCallClaude
      .mockResolvedValueOnce({ text: "not json" })
      .mockResolvedValueOnce({ text: JSON.stringify({ zones: [{ id: "core", newInsights: ["x"], findings: [] }] }) });

    const res = await narrateZones([core], opts);

    expect(mockedCallClaude).toHaveBeenCalledTimes(2);
    const first = mockedCallClaude.mock.calls[0][0] as string;
    const second = mockedCallClaude.mock.calls[1][0] as string;
    expect(first).toContain("and 5 more");   // 30 files, 25 shown
    expect(second).toContain("and 20 more"); // 30 files, 10 shown
    expect(res.success).toBe(true);
    expect(res.tokenUsage.calls).toBe(2);
  });

  it("returns the zones untouched on an auth failure or after two unparsable answers", async () => {
    mockedCallClaude.mockRejectedValueOnce(new ClaudeClientError("bad key", "auth", false));
    const input = [core];
    const authRes = await narrateZones(input, opts);
    expect(authRes.success).toBe(false);
    expect(authRes.zones).toBe(input);
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);

    mockedCallClaude.mockReset();
    mockedCallClaude.mockResolvedValue({ text: "{}" });
    const parseRes = await narrateZones([core], opts);
    expect(parseRes.success).toBe(false);
    expect(mockedCallClaude).toHaveBeenCalledTimes(2);
  });

  it("asks for text-only findings when the judgment route is active, and the full contract otherwise", () => {
    const judged = buildMultiplexEnvelope([core], 25, opts, true).sections.find((s) => s.name === "output")!.content;
    const plain = buildMultiplexEnvelope([core], 25, opts, false).sections.find((s) => s.name === "output")!.content;
    expect(judged).not.toContain("Findings: severity");
    expect(judged).not.toContain('"severity"');
    expect(judged).not.toContain("Use finding types");
    expect(plain).toContain("Findings: severity");
    expect(plain).toContain('"severity":"info"');
  });
});
