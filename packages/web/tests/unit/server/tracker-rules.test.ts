import { describe, expect, it } from "vitest";
import { planTrackerEvent, TRACKER_RULE_KINDS, trackerRequestId, type TrackerEventRecord } from "../../../src/server/tracker/rules.js";
import { loadServerProfile, TRACKER_EVENTS, type ServerProfile, type TrackerEvent, type TrackerMapping } from "../../../src/server/tracker/server-profiles.js";
import { parseTrackerSync, type TrackerSyncConfig } from "../../../src/server/tracker/sync-config.js";

const mapping = (loadServerProfile("caos") as ServerProfile).tracker as TrackerMapping;

const withReviewer: TrackerMapping = { ...mapping, defaults: { reviewer: "u-default" } };
const FEATURES = { Sidecar: "epic-9" };

/** A record carrying every fact its event's rule needs. */
function complete(event: TrackerEvent): TrackerEventRecord {
  return {
    event,
    rexId: "r1",
    ...(event !== "change-captured" && { ref: "WM-1" }),
    values: { title: "T", estimate: "M" },
    sources: { "pr-url": "https://github.com/x/y/pull/1", release: "1.2.0" },
    diagnosis: { summary: "tests fail", unblock: "Fix the test" },
    feature: { name: "Sidecar" },
  };
}

function config(rules: Record<string, unknown> = {}, featureMap: Record<string, string> = {}): TrackerSyncConfig {
  const parsed = parseTrackerSync({ connection: "caos", project: "ndx", rules, featureMap }, "/work/ndx");
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
    const on = config(Object.fromEntries(TRACKER_EVENTS.map((e) => [e, "on"])), FEATURES);
    const dry = config(Object.fromEntries(TRACKER_EVENTS.map((e) => [e, "dry-run"])), FEATURES);
    for (const event of TRACKER_EVENTS) {
      const record = complete(event);
      const expected = TRACKER_RULE_KINDS[event] === "move" ? "call" : "card";
      expect(planTrackerEvent(record, on, withReviewer), event).toMatchObject({ action: expected, mode: "on" });
      expect(planTrackerEvent(record, on, withReviewer)).not.toHaveProperty("missing");
      expect(planTrackerEvent(record, dry, withReviewer), event).toMatchObject({ action: "would", mode: "dry-run" });
    }
  });

  describe("workflow facts", () => {
    const pr = { event: "pr-opened", rexId: "r1", ref: "WM-1", sources: { "pr-url": "https://github.com/x/y/pull/1" } } as const;
    const on = config({ "pr-opened": "on", "release-published": "on", "run-failed-twice": "on" });

    it("carries the profile's default reviewer and the PR link on the PR-opened move", () => {
      expect(planTrackerEvent(pr, on, withReviewer)).toMatchObject({
        action: "call",
        call: { args: { review: { reviewerNotionUserId: "u-default", reviewLink: "https://github.com/x/y/pull/1" } } },
      });
    });

    it("falls back to the CODEOWNERS owner when the profile names no reviewer", () => {
      const plan = planTrackerEvent({ ...pr, sources: { ...pr.sources, codeowners: "@hal" } }, on, mapping);
      expect(plan).toMatchObject({ action: "call", call: { args: { review: { reviewerNotionUserId: "@hal" } } } });
    });

    it("makes the profile default win over CODEOWNERS", () => {
      const plan = planTrackerEvent({ ...pr, sources: { ...pr.sources, codeowners: "@hal" } }, on, withReviewer);
      expect(plan).toMatchObject({ call: { args: { review: { reviewerNotionUserId: "u-default" } } } });
    });

    it("becomes a card naming the reviewer when neither supplies one, in dry-run too", () => {
      for (const mode of ["on", "dry-run"]) {
        const plan = planTrackerEvent(pr, config({ "pr-opened": mode }), mapping);
        expect(plan).toMatchObject({ action: "card", missing: [expect.stringContaining("missing reviewer")] });
        expect(JSON.stringify(plan)).not.toContain("reviewerNotionUserId");
      }
    });

    it("becomes a card naming the review link when the PR URL is unknown", () => {
      const plan = planTrackerEvent({ ...pr, sources: {} }, on, withReviewer);
      expect(plan).toMatchObject({ action: "card", missing: [expect.stringContaining("missing reviewLink")] });
    });

    it("carries the delivery note from the release version", () => {
      const plan = planTrackerEvent({ event: "release-published", rexId: "r1", ref: "WM-1", sources: { release: "1.2.0" } }, on, mapping);
      expect(plan).toMatchObject({ action: "call", call: { args: { toStatus: "done", delivery: { note: "shipped in ndx 1.2.0" } } } });
    });

    it("becomes a card without a release version", () => {
      const plan = planTrackerEvent({ event: "release-published", rexId: "r1", ref: "WM-1" }, on, mapping);
      expect(plan).toMatchObject({ action: "card", missing: [expect.stringContaining("missing deliveryNote")] });
    });

    it("carries the diagnosis summary and who can unblock on the blocked card", () => {
      const record = { event: "run-failed-twice", rexId: "r1", ref: "WM-1", diagnosis: { summary: "tests fail", unblock: "Fix the failing test" } } as const;
      expect(planTrackerEvent(record, on, mapping)).toEqual({
        action: "card",
        rule: "blocked",
        mode: "on",
        requestId: "ndx:ndx:r1:run-failed-twice",
        call: {
          tool: "move_work_item",
          args: {
            requestId: "ndx:ndx:r1:run-failed-twice",
            workItemId: "WM-1",
            toStatus: "blocked",
            stalled: { kind: "blocked", blockedBy: "tests fail", whoCanUnblock: "Fix the failing test" },
          },
        },
      });
    });

    it("names the unknown blocked facts rather than guessing them", () => {
      const plan = planTrackerEvent({ event: "run-failed-twice", rexId: "r1", ref: "WM-1" }, on, mapping);
      expect(plan).toMatchObject({ missing: [expect.stringContaining("blockedBy"), expect.stringContaining("whoCanUnblock")] });
    });
  });

  describe("tracker limits", () => {
    const captured = { event: "change-captured", rexId: "r1", values: { title: "T", estimate: "M" }, feature: { name: "Sidecar", epic: "0.10.0" } } as const;

    it("raises a card naming the feature to create, and no call, when it is not mapped", () => {
      const plan = planTrackerEvent(captured, config({ "change-captured": "on" }), mapping, "CAOS");
      expect(plan).toMatchObject({
        action: "card",
        missing: ["Create feature 'Sidecar' under epic 0.10.0 in CAOS, then map it in trackerSync.featureMap"],
      });
    });

    it("plans the create once the feature is mapped", () => {
      const plan = planTrackerEvent(captured, config({ "change-captured": "on" }, { Sidecar: "epic-9" }), mapping);
      expect(plan).toMatchObject({ action: "card", call: { args: { epicId: "epic-9" } } });
      expect(plan).not.toHaveProperty("missing");
    });

    it("names a plain missing epic when the profile declares no limit", () => {
      const plan = planTrackerEvent(captured, config({ "change-captured": "on" }), { ...mapping, limits: [] });
      expect(plan).toMatchObject({ missing: [expect.stringContaining("missing epic")] });
    });
  });

  it("fills the request id, item id and status, which no collected value overrides", () => {
    const plan = planTrackerEvent(
      { event: "pr-opened", rexId: "r1", ref: "WM-1", values: { requestId: "mine", toStatus: "done", "review.reviewLink": "https://example.com/pr/1" } },
      config({ "pr-opened": "on" }),
      withReviewer,
    );
    expect(plan).toEqual({
      action: "call",
      rule: "move",
      mode: "on",
      requestId: "ndx:ndx:r1:pr-opened",
      call: {
        tool: "move_work_item",
        args: { requestId: "ndx:ndx:r1:pr-opened", toStatus: "readyForReview", workItemId: "WM-1", review: { reviewLink: "https://example.com/pr/1", reviewerNotionUserId: "u-default" } },
      },
    });
    expect(trackerRequestId("ndx", "r1", "pr-opened")).toBe("ndx:ndx:r1:pr-opened");
  });
});
