import { describe, expect, it } from "vitest";
import { isDenied } from "../../e2e-ui/happy-click/helpers/click-policy.js";

// Names as identify() reads them: the option's text content, icon first.
const STATUS_OPTIONS = ["○ Pending", "◐ In Progress", "● Completed", "⚠ Failing", "⊘ Blocked", "◌ Deferred", "✕ Deleted"];

describe("happy-click policy: PRD status picker", () => {
  it.each(STATUS_OPTIONS)("denies the %s option by name", (name) => {
    expect(isDenied({ name, classes: "" })).toMatch(/^name ~/);
  });

  it("denies the current status, which carries a check mark", () => {
    expect(isDenied({ name: "● Completed ✓", classes: "" })).toMatch(/^name ~/);
  });

  it("denies an option by class whatever its name", () => {
    expect(isDenied({ name: "", classes: "prd-status-picker-option prd-status-completed" })).toMatch(/^class ~/);
  });

  it("leaves status-named filters and tabs clickable", () => {
    for (const name of ["Completed", "Completed (3)", "In Progress", "Show completed"]) {
      expect(isDenied({ name, classes: "" }), name).toBeNull();
    }
  });
});
