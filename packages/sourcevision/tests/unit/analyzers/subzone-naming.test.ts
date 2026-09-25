import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/analyzers/claude-client.js", async () => {
  const actual = await import("@n-dx/llm-client");
  return { getJudgmentRoute: vi.fn(() => undefined), ClaudeClientError: actual.ClaudeClientError, callClaude: vi.fn(), setClaudeConfig: vi.fn() };
});

import {
  applySubZoneNames,
  flattenSubZones,
  nameSubZones,
  subZoneIdsFollowNames,
} from "../../../src/analyzers/subzone-naming.js";
import { makeZone } from "./zones-helpers.js";

function tree() {
  return [makeZone("utils", ["a.ts", "b.ts", "c.ts", "d.ts"], {
    subZones: [
      makeZone("utils/utils-2", ["a.ts", "b.ts"], { name: "Utils 2", subZones: [makeZone("utils/utils-2/x", ["a.ts"]), makeZone("utils/utils-2/y", ["b.ts"])] }),
      makeZone("utils/utils-3", ["c.ts", "d.ts"], { name: "Utils 3" }),
    ],
  })];
}

describe("sub-zone naming", () => {
  it("flattens sub-zones at every depth", () => {
    expect(flattenSubZones(tree()).map((z) => z.id)).toEqual(["utils/utils-2", "utils/utils-2/x", "utils/utils-2/y", "utils/utils-3"]);
  });

  it("applies names anywhere in the tree and numbered ids follow them, re-prefixing descendants", () => {
    const named = applySubZoneNames(tree(), new Map([["utils/utils-2", "OAuth Sessions"]]));
    expect(named.renamed).toEqual(["utils/utils-2"]);
    const [root] = subZoneIdsFollowNames(named.zones);
    const oauth = root.subZones![0];
    expect(oauth.id).toBe("utils/oauth-sessions");
    expect(oauth.previousIds).toEqual(["utils/utils-2"]);
    expect(oauth.subZones!.map((z) => z.id)).toEqual(["utils/oauth-sessions/x", "utils/oauth-sessions/y"]);
    expect(root.subZones![1].id).toBe("utils/utils-3");
  });

  it("carries a chosen name from the previous run for the same files, without a judgment route", async () => {
    const previous = [makeZone("utils", ["a.ts", "b.ts", "c.ts", "d.ts"], {
      subZones: [makeZone("utils/old", ["c.ts", "d.ts"], { name: "Notion Sync" })],
    })];
    const { zones, pending } = await nameSubZones(tree(), { previous });
    const sub = flattenSubZones(zones).find((z) => z.files.join() === "c.ts,d.ts")!;
    expect(sub.name).toBe("Notion Sync");
    expect(sub.id).toBe("utils/notion-sync");
    expect(pending).toEqual([]);
  });

  it("does not keep a name that echoes the parent or a sibling", async () => {
    const zones = [makeZone("park", ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"], {
      name: "Park",
      subZones: [
        makeZone("park/engine", ["a.ts", "b.ts", "c.ts"], { name: "Park" }),
        makeZone("park/worldgen", ["d.ts", "e.ts"], { name: "Park" }),
      ],
    })];
    const { zones: out } = await nameSubZones(zones);
    expect(flattenSubZones(out).map((z) => z.name)).toEqual(["Engine", "Worldgen"]);
  });
});
