import { describe, it, expect } from "vitest";
import { MAX_HEADER_QUEUE_ENTRIES, formatHubAdmissionHeader, parseHubAdmissionHeader, type HubAdmissionHeader } from "../../../src/shared/index.js";

describe("hub admission header", () => {
  it("round-trips the counts and the memory fields", () => {
    const admission = { running: 2, maxSessions: 4, queued: 1, availableBytes: 1024, pressure: "critical", memoryPaused: true } as const;
    expect(parseHubAdmissionHeader(formatHubAdmissionHeader(admission))).toEqual(admission);
  });

  it("round-trips an unreadable machine as availableBytes null", () => {
    const admission = { running: 0, maxSessions: 2, queued: 0, availableBytes: null, pressure: "unknown", memoryPaused: false } as const;
    expect(parseHubAdmissionHeader(formatHubAdmissionHeader(admission))).toEqual(admission);
  });

  it("reads a header from a hub that sends only the counts", () => {
    expect(parseHubAdmissionHeader('{"running":1,"maxSessions":3,"queued":0}')).toEqual({ running: 1, maxSessions: 3, queued: 0 });
  });

  it("drops a malformed memory field and keeps the counts", () => {
    expect(
      parseHubAdmissionHeader('{"running":1,"maxSessions":3,"queued":0,"availableBytes":-5,"pressure":"hot","memoryPaused":"yes"}'),
    ).toEqual({ running: 1, maxSessions: 3, queued: 0 });
  });

  it.each([undefined, "", "not json", "[]", '{"running":-1,"maxSessions":3,"queued":0}', '{"running":1}'])(
    "rejects %j",
    (value) => {
      expect(parseHubAdmissionHeader(value)).toBeNull();
    },
  );
});

describe("hub admission header queue", () => {
  const counts = { running: 1, maxSessions: 4, queued: 2 } as const;

  it("round-trips the queued requests beside the counts", () => {
    const admission: HubAdmissionHeader = {
      ...counts,
      queue: [
        { taskId: "task-a", workspace: null, enqueuedAt: "2026-10-14T10:00:00.000Z" },
        { taskId: "task-b", workspace: "side", enqueuedAt: "2026-10-14T10:01:00.000Z", mode: "iterations", iterations: 3 },
      ],
    };
    expect(parseHubAdmissionHeader(formatHubAdmissionHeader(admission))).toEqual(admission);
  });

  it("round-trips an empty queue as empty, not absent — this project has nothing waiting though others may", () => {
    const parsed = parseHubAdmissionHeader(formatHubAdmissionHeader({ ...counts, queue: [] }));
    expect(parsed?.queue).toEqual([]);
  });

  it("leaves the queue absent for a hub too old to send one", () => {
    expect(parseHubAdmissionHeader(formatHubAdmissionHeader(counts))?.queue).toBeUndefined();
  });

  it("caps both sides at MAX_HEADER_QUEUE_ENTRIES so a long queue cannot overflow the header", () => {
    const queue = Array.from({ length: MAX_HEADER_QUEUE_ENTRIES + 5 }, (_, i) => ({
      taskId: `task-${i}`,
      workspace: null,
      enqueuedAt: "2026-10-14T10:00:00.000Z",
    }));
    const formatted = formatHubAdmissionHeader({ ...counts, queue });
    expect(JSON.parse(formatted).queue).toHaveLength(MAX_HEADER_QUEUE_ENTRIES);
    expect(parseHubAdmissionHeader(formatted)?.queue).toHaveLength(MAX_HEADER_QUEUE_ENTRIES);
  });

  it("drops a request missing a task id or a timestamp and keeps the rest", () => {
    const parsed = parseHubAdmissionHeader(
      '{"running":1,"maxSessions":4,"queued":2,"queue":['
      + '{"workspace":null,"enqueuedAt":"2026-10-14T10:00:00.000Z"},'
      + '{"taskId":"task-b"},'
      + '{"taskId":"task-c","workspace":null,"enqueuedAt":"2026-10-14T10:02:00.000Z"}]}',
    );
    expect(parsed?.queue).toEqual([{ taskId: "task-c", workspace: null, enqueuedAt: "2026-10-14T10:02:00.000Z" }]);
  });

  it("drops a malformed mode or iterations without losing the request", () => {
    const parsed = parseHubAdmissionHeader(
      '{"running":1,"maxSessions":4,"queued":1,"queue":['
      + '{"taskId":"task-a","workspace":7,"enqueuedAt":"2026-10-14T10:00:00.000Z","mode":9,"iterations":-2}]}',
    );
    expect(parsed?.queue).toEqual([{ taskId: "task-a", workspace: null, enqueuedAt: "2026-10-14T10:00:00.000Z" }]);
  });

  it("treats a queue that is not an array as absent, keeping the counts", () => {
    const parsed = parseHubAdmissionHeader('{"running":1,"maxSessions":4,"queued":2,"queue":"soon"}');
    expect(parsed).toEqual({ running: 1, maxSessions: 4, queued: 2 });
  });
});
