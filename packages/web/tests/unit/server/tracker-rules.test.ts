import { describe, expect, it } from "vitest";
import { planTrackerEvent, TRACKER_RULE_KINDS, trackerRequestId } from "../../../src/server/tracker/rules.js";
import { loadServerProfile, TRACKER_EVENTS, type ServerProfile, type TrackerMapping } from "../../../src/server/tracker/server-profiles.js";
import { parseTrackerSync, type TrackerSyncConfig } from "../../../src/server/tracker/sync-config.js";

const mapping = (loadServerProfile("caos") as ServerProfile).tracker as TrackerMapping;

function config(rules: Record<string, unknown> = {}): TrackerSyncConfig {
  const parsed = parseTrackerSync({ connection: "caos", project: "ndx", rules }, "/work/ndx");
  if ("problems" in parsed) throw new Error(parsed.problems.join("; "));
  return parsed;
}

describe("parseTrackerSync", () => {
  it("turns every rule off unless it is set", () => {
    expect(config().rules).toEqual(Object.fromEntries(TRACKER_EVENTS.map((e) => [e, "off"])));
    expect(config({ "pr-merged": "dry-run" }).rules["pr-merged"]).toBe("dry-run");
  });

  it("names every problem instead of guessing", () => {
    expect(parseTrackerSync({ rules: { "pr-merged": "yes", deployed: "on" }, project: "a:b" }, "/work/ndx")).toEqual({
      problems: [
        "trackerSync.connection must name a connection",
        expect.stringContaining("trackerSync.project must match"),
        "trackerSync.rules.pr-merged must be off, dry-run or on",
        "trackerSync.rules names deployed, which is not an ndx event",
      ],
    });
  });
});

describe("planTrackerEvent", () => {
  it("plans nothing for a rule that is off", () => {
    expect(planTrackerEvent({ event: "pr-merged", rexId: "r1", ref: "WM-1" }, config(), mapping)).toEqual({
      action: "skip",
      reason: "the pr-merged rule is off",
    });
  });

  it("makes creation and blocked cards and moves calls once on; dry-run makes each a would-be call", () => {
    const on = config(Object.fromEntries(TRACKER_EVENTS.map((e) => [e, "on"])));
    const dry = config(Object.fromEntries(TRACKER_EVENTS.map((e) => [e, "dry-run"])));
    for (const event of TRACKER_EVENTS) {
      const record = { event, rexId: "r1", ...(event !== "change-captured" && { ref: "WM-1" }) };
      const expected = TRACKER_RULE_KINDS[event] === "move" ? "call" : "card";
      expect(planTrackerEvent(record, on, mapping)).toMatchObject({ action: expected, mode: "on" });
      expect(planTrackerEvent(record, dry, mapping)).toMatchObject({ action: "would", mode: "dry-run" });
    }
  });

  it("fills the request id, item id and status, which no collected value overrides", () => {
    const plan = planTrackerEvent(
      { event: "pr-opened", rexId: "r1", ref: "WM-1", values: { requestId: "mine", toStatus: "done", "review.reviewLink": "https://example.com/pr/1" } },
      config({ "pr-opened": "on" }),
      mapping,
    );
    expect(plan).toEqual({
      action: "call",
      rule: "move",
      mode: "on",
      requestId: "ndx:ndx:r1:pr-opened",
      call: {
        tool: "move_work_item",
        args: { requestId: "ndx:ndx:r1:pr-opened", toStatus: "readyForReview", workItemId: "WM-1", review: { reviewLink: "https://example.com/pr/1" } },
      },
    });
    expect(trackerRequestId("ndx", "r1", "pr-opened")).toBe("ndx:ndx:r1:pr-opened");
  });
});
