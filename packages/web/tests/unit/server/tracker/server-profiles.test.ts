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
    expect(caos.fieldHints.create_work_item.epicId).toEqual({ optionsFrom: { tool: "list_epics", path: "items" } });
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

  it("is refused for a malformed shape, naming each problem", () => {
    userProfile("desk", { fieldHints: { new_ticket: { title: "yes" } }, tracker: { ...deskProfile.tracker, facts: { "pr-landed": [] } } });
    const resolution = resolveServerProfile("desk", desk, { ndxHome });
    expect(resolution).toMatchObject({ state: "invalid" });
    expect(resolution.state === "invalid" && resolution.problem).toMatch(/fieldHints\.new_ticket: .*"title".*tracker\.facts names pr-landed/);
  });
});
