import { describe, it, expect } from "vitest";
import { guideContent } from "../../../src/viewer/components/guide.js";

describe("Analysis page guide", () => {
  it("names the v2 Inbox capture and placement flow", () => {
    const text = Object.values(guideContent("analysis", "v2")).join(" ");
    expect(text).toContain("Add to Inbox");
    expect(text).toContain("place it before starting work");
    expect(text).not.toContain("Smart Add");
    expect(text).not.toContain("generate proposals");
  });
  it("keeps the v1 Smart Add guide", () => {
    expect(guideContent("analysis", "v1").actions).toContain("Smart Add");
  });
});
