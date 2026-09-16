import { describe, it, expect, vi } from "vitest";
import { tagBroadcaster, BROADCAST_ALL_WORKSPACES } from "../../../src/server/websocket.js";

describe("tagBroadcaster", () => {
  it("stamps object frames with the workspace and leaves an existing tag alone", () => {
    const sink = vi.fn();
    const tagged = tagBroadcaster(sink, "feature");
    tagged({ type: "rex:prd-changed", timestamp: "t" });
    tagged({ type: "hench:run-changed", workspace: "other" });
    expect(sink).toHaveBeenNthCalledWith(1, { type: "rex:prd-changed", timestamp: "t", workspace: "feature" });
    expect(sink).toHaveBeenNthCalledWith(2, { type: "hench:run-changed", workspace: "other" });
  });

  it("passes non-object frames through untouched", () => {
    const sink = vi.fn();
    tagBroadcaster(sink, "feature")("ping");
    tagBroadcaster(sink, "feature")([1, 2]);
    expect(sink).toHaveBeenNthCalledWith(1, "ping");
    expect(sink).toHaveBeenNthCalledWith(2, [1, 2]);
  });

  it("can tag for every workspace", () => {
    const sink = vi.fn();
    tagBroadcaster(sink, BROADCAST_ALL_WORKSPACES)({ type: "ws:health-status" });
    expect(sink).toHaveBeenCalledWith({ type: "ws:health-status", workspace: "*" });
  });
});
