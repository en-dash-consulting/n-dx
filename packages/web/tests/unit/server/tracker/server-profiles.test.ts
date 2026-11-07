import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  builtInProfileNames,
  checkServerProfile,
  loadServerProfile,
  resolveServerProfile,
  TRACKER_EVENTS,
  trackerItemIdOfRef,
  trackerItemUrl,
  USER_PROFILES_DIR,
  type ProfileTool,
  type ServerProfile,
} from "../../../../src/server/tracker/server-profiles.js";
import { removeTempDir } from "../../../helpers/temp-dir.js";

let ndxHome: string;

beforeEach(() => {
  ndxHome = mkdtempSync(join(tmpdir(), "ndx-profiles-home-"));
});

afterEach(async () => {
  await removeTempDir(ndxHome);
});

function userProfile(name: string, body: unknown): void {
  const dir = join(ndxHome, USER_PROFILES_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), typeof body === "string" ? body : JSON.stringify(body));
}

const object = (properties: Record<string, unknown>) => ({ type: "object", properties });
const STATUSES = ["backlog", "inProgress", "readyForReview", "pendingDelivery", "done", "blocked"];

/** A small tracker: just enough schema for a mapping to be checked. */
const desk: ProfileTool[] = [
  { tool: "new_ticket", inputSchema: object({ key: {}, title: {}, status: { enum: STATUSES } }) },
  { tool: "set_status", inputSchema: object({ key: {}, ticket: {}, status: { enum: STATUSES }, review: object({ by: {} }) }) },
  { tool: "get_ticket", inputSchema: object({ ticket: {} }) },
  { tool: "list_boards", inputSchema: object({}) },
];

const statusMap = Object.fromEntries(TRACKER_EVENTS.map((event) => [event, "inProgress"]));
const deskProfile = {
  label: "Desk",
  fieldHints: { new_ticket: { title: { optionsFrom: { tool: "list_boards", path: "boards" } } } },
  tracker: {
    createTool: "new_ticket",
    moveTool: "set_status",
    readTool: "get_ticket",
    requestIdProperty: "key",
    itemIdProperty: "ticket",
    createStatusProperty: "status",
    moveStatusProperty: "status",
    statusMap,
    facts: { "pr-opened": [{ fact: "reviewer", property: "review.by", from: ["profile-default", "codeowners"] }] },
    defaults: { reviewer: "ada" },
  },
};

describe("built-in profiles", () => {
  it("ship CAOS first, mapping every ndx event", () => {
    expect(builtInProfileNames()[0]).toBe("caos");
    const caos = loadServerProfile("caos", { ndxHome }) as ServerProfile;
    expect(caos.label).toBe("CAOS");
    expect(Object.keys(caos.tracker!.statusMap).sort()).toEqual([...TRACKER_EVENTS].sort());
    expect(caos.fieldHints.create_work_item.epicId).toEqual({ optionsFrom: { tool: "list_epics", path: "items", arguments: { pageSize: 100 } } });
    expect(caos.tracker!.readStatusProperty).toBe("status");
  });
});

describe("readStatusProperty", () => {
  it("is optional, and refused when it is not a non-empty string", () => {
    userProfile("desk", deskProfile);
    expect((loadServerProfile("desk", { ndxHome }) as ServerProfile).tracker!.readStatusProperty).toBeUndefined();
    userProfile("desk", { ...deskProfile, tracker: { ...deskProfile.tracker, readStatusProperty: 3 } });
    expect(loadServerProfile("desk", { ndxHome })).toEqual({ problems: ["tracker.readStatusProperty must be a non-empty string when set"] });
  });
});

describe("user profiles", () => {
  it("load from the ndx home's tracker-profiles/ by bare name and fit their server", () => {
    userProfile("desk", deskProfile);
    const resolution = resolveServerProfile("desk", desk, { ndxHome });
    expect(resolution).toMatchObject({ name: "desk", state: "ok", profile: { label: "Desk" } });
  });

  it("never replace a built-in of the same name unless named user:<name>", () => {
    userProfile("caos", { ...deskProfile, label: "My CAOS" });
    expect((loadServerProfile("caos", { ndxHome }) as ServerProfile).label).toBe("CAOS");
    expect((loadServerProfile("user:caos", { ndxHome }) as ServerProfile).label).toBe("My CAOS");
  });

  it("load by a bare name that is also an Object.prototype member, not the prototype's value", () => {
    userProfile("constructor", { ...deskProfile, label: "Mine" });
    expect((loadServerProfile("constructor", { ndxHome }) as ServerProfile).label).toBe("Mine");
  });

  it("refuse a name that could leave the directory, and name a missing or unreadable file", () => {
    expect(loadServerProfile("user:../secrets", { ndxHome })).toEqual({ problems: [expect.stringContaining("a profile name must match")] });
    expect(loadServerProfile("nope", { ndxHome })).toEqual({ problems: [expect.stringContaining("no profile named nope")] });
    userProfile("broken", "{");
    expect(loadServerProfile("broken", { ndxHome })).toEqual({ problems: [expect.stringContaining("is not valid JSON")] });
  });
});

describe("a profile that does not fit", () => {
  it("is refused when it names a tool the server lacks, naming the tool", () => {
    userProfile("desk", { ...deskProfile, tracker: { ...deskProfile.tracker, moveTool: "move_ticket" } });
    const resolution = resolveServerProfile("desk", desk, { ndxHome });
    expect(resolution.state).toBe("invalid");
    expect(resolution).toMatchObject({ problem: expect.stringContaining("tracker.moveTool names move_ticket, which the server does not list") });
  });

  it("is refused when its status map misses an event, naming the event", () => {
    const { "run-failed-twice": _dropped, ...partial } = statusMap;
    userProfile("desk", { ...deskProfile, tracker: { ...deskProfile.tracker, statusMap: partial } });
    expect(resolveServerProfile("desk", desk, { ndxHome })).toMatchObject({
      state: "invalid",
      problem: expect.stringContaining("tracker.statusMap has no status for run-failed-twice"),
    });
  });

  it("names a hint's read tool, a property or a status the server does not have", () => {
    const profile = {
      name: "desk",
      label: "Desk",
      fieldHints: { new_ticket: { owner: { optionsFrom: { tool: "list_owners", path: "" } } } },
      tracker: {
        ...deskProfile.tracker,
        statusMap: { ...statusMap, "pr-merged": "shipped" },
        facts: { "pr-opened": [{ fact: "reviewer", property: "review.who", from: ["codeowners"] }] },
      },
    } as unknown as ServerProfile;
    expect(checkServerProfile(profile, desk)).toEqual([
      "fieldHints.new_ticket names owner, which new_ticket's input does not declare",
      "fieldHints.new_ticket.owner names list_owners, which the server does not list",
      "tracker.statusMap.pr-merged is shipped, which is not a status the server accepts",
      "tracker.facts.pr-opened (reviewer) names review.who, which set_status's input does not declare",
    ]);
  });

  it("is refused when a hint's argument is not declared by its read tool, naming it", () => {
    const profile = {
      name: "desk",
      label: "Desk",
      fieldHints: { new_ticket: { title: { optionsFrom: { tool: "list_boards", path: "boards", arguments: { pageSize: 100 } } } } },
    } as unknown as ServerProfile;
    expect(checkServerProfile(profile, desk)).toEqual([
      "fieldHints.new_ticket.title.arguments names pageSize, which list_boards's input does not declare",
    ]);
    const declared = [...desk.slice(0, 3), { tool: "list_boards", inputSchema: object({ pageSize: {} }) }];
    expect(checkServerProfile(profile, declared)).toEqual([]);
  });

  it("is refused for a malformed shape, naming each problem", () => {
    userProfile("desk", { fieldHints: { new_ticket: { title: "yes" } }, tracker: { ...deskProfile.tracker, facts: { "pr-landed": [] } } });
    const resolution = resolveServerProfile("desk", desk, { ndxHome });
    expect(resolution).toMatchObject({ state: "invalid" });
    expect(resolution.state === "invalid" && resolution.problem).toMatch(/fieldHints\.new_ticket: .*"title".*tracker\.facts names pr-landed/);
  });

  it("is refused for an item URL template that is no http(s) URL or holds no single placeholder", () => {
    for (const [template, problem] of [
      ["notion://{id}", /must be an http\(s\) URL/],
      ["https://desk.example/items/", /exactly one \{id\} or \{compactId\}/],
      ["https://desk.example/{id}/{compactId}", /exactly one/],
      ["https://desk.example/{id}/{id}", /exactly one/],
      [42, /non-empty string/],
    ] as const) {
      userProfile("desk", { ...deskProfile, tracker: { ...deskProfile.tracker, itemUrlTemplate: template } });
      const resolution = resolveServerProfile("desk", desk, { ndxHome });
      expect(resolution.state === "invalid" && resolution.problem).toMatch(problem);
    }
  });
});

describe("item URL template", () => {
  const uuid = "3b3a80b7-1924-80f7-b5fc-e8093ba5f7f0";

  it("builds the CAOS item's Notion page URL from its id, and reads the id back from it", () => {
    const caos = (loadServerProfile("caos", { ndxHome }) as ServerProfile).tracker!;
    const url = trackerItemUrl(caos, uuid);
    expect(url).toBe("https://www.notion.so/3b3a80b7192480f7b5fce8093ba5f7f0");
    expect(trackerItemIdOfRef(caos, url!)).toBe(uuid);
  });

  it("reads the id from a URL copied from the browser, ignoring workspace, title slug and query", () => {
    const caos = (loadServerProfile("caos", { ndxHome }) as ServerProfile).tracker!;
    const browser = "https://www.notion.so/ws/Some-Title-3b3a80b7192480f7b5fce8093ba5f7f0?pvs=4";
    expect(trackerItemIdOfRef(caos, browser)).toBe(uuid);
    expect(trackerItemIdOfRef(caos, "https://www.notion.so/ws/3b3a80b7192480f7b5fce8093ba5f7f0#top")).toBe(uuid);
    // No id in the tail: read as before. A foreign site is never touched.
    expect(trackerItemIdOfRef(caos, "https://www.notion.so/ws/Some-Title")).toBe("ws/Some-Title");
    expect(trackerItemIdOfRef(caos, "https://other.example/Some-Title-3b3a80b7192480f7b5fce8093ba5f7f0")).toBe("https://other.example/Some-Title-3b3a80b7192480f7b5fce8093ba5f7f0");
  });

  it("puts {id} in as given, and returns any ref the template did not build unchanged", () => {
    const mapping = { itemUrlTemplate: "https://desk.example/t/{id}/view" };
    expect(trackerItemUrl(mapping, "a b")).toBe("https://desk.example/t/a%20b/view");
    expect(trackerItemIdOfRef(mapping, "https://desk.example/t/a%20b/view")).toBe("a b");
    expect(trackerItemIdOfRef(mapping, "WM-7")).toBe("WM-7");
    expect(trackerItemIdOfRef(mapping, "https://other.example/t/x/view")).toBe("https://other.example/t/x/view");
    // A hand-linked URL with a malformed escape is read as itself, never thrown on.
    expect(trackerItemIdOfRef(mapping, "https://desk.example/t/a%zz/view")).toBe("https://desk.example/t/a%zz/view");
  });

  it("builds nothing and reads every ref as itself without a template", () => {
    expect(trackerItemUrl({}, uuid)).toBeUndefined();
    expect(trackerItemIdOfRef({}, "https://www.notion.so/3b3a80b7192480f7b5fce8093ba5f7f0")).toBe("https://www.notion.so/3b3a80b7192480f7b5fce8093ba5f7f0");
  });
});
