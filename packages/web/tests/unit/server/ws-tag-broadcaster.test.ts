import { describe, it, expect, vi } from "vitest";
import { tagBroadcaster, BROADCAST_ALL_WORKSPACES } from "../../../src/server/websocket.js";
import { frameIsForWorkspace } from "../../../src/viewer/messaging/ws-pipeline.js";

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

  // The anchor's viewer is served at `/`, so its own workspace key is null,
  // and `frameIsForWorkspace` accepts an untagged frame only for that viewer.
  // Tagging the anchor's frames with its directory basename therefore made the
  // plain single-worktree dashboard drop every live update it was sent.
  it("leaves the anchor's frames untagged, which is what the anchor viewer accepts", () => {
    const sink = vi.fn();
    tagBroadcaster(sink, null)({ type: "rex:prd-changed", timestamp: "t" });
    expect(sink).toHaveBeenCalledWith({ type: "rex:prd-changed", timestamp: "t" });

    const [frame] = sink.mock.calls[0] as [Record<string, unknown>];
    expect(frameIsForWorkspace(frame, null), "anchor viewer accepts it").toBe(true);
    expect(frameIsForWorkspace(frame, "feature"), "a worktree viewer does not").toBe(false);
  });

  it("a tagged frame reaches its own worktree's viewer and no other", () => {
    const sink = vi.fn();
    tagBroadcaster(sink, "feature")({ type: "hench:run-changed" });
    const [frame] = sink.mock.calls[0] as [Record<string, unknown>];
    expect(frameIsForWorkspace(frame, "feature")).toBe(true);
    expect(frameIsForWorkspace(frame, null), "not the anchor's").toBe(false);
  });
});
