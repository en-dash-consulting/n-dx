import { describe, it, expect } from "vitest";
import { formatHubAdmissionHeader, parseHubAdmissionHeader } from "../../../src/shared/index.js";

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
