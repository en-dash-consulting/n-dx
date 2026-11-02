// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { isDenied } from "../../e2e-ui/happy-click/helpers/click-policy.js";
import { InlineStatusPicker } from "../../../src/viewer/components/prd-tree/inline-status-picker.js";

// Names as identify() reads them: the option's text content, icon first. The
// icon, label and check are adjacent spans, so there is no space between them.
const STATUS_OPTIONS = ["○Pending", "◐In Progress", "●Completed", "⚠Failing", "⊘Blocked", "◌Deferred", "✕Deleted"];

/** identify()'s name for an element with no aria-label. */
const nameOf = (el: Element) => (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("happy-click policy: PRD status picker", () => {
  it.each(STATUS_OPTIONS)("denies the %s option by name", (name) => {
    expect(isDenied({ name, classes: "" })).toMatch(/^name ~/);
  });

  it("denies the current status, which carries a check mark", () => {
    expect(isDenied({ name: "●Completed✓", classes: "" })).toMatch(/^name ~/);
  });

  it("denies every option of the rendered picker by name, as identify() reads it", () => {
    const root = document.createElement("div");
    act(() => {
      render(h(InlineStatusPicker, {
        currentStatus: "completed",
        anchorRect: { left: 0, top: 0, bottom: 0 },
        onSelect: () => {},
        onClose: () => {},
      }), root);
    });
    const names = [...root.querySelectorAll(".prd-status-picker-option")].map(nameOf);
    expect(names).toContain("●Completed✓");
    for (const name of names) expect(isDenied({ name, classes: "" }), name).toMatch(/^name ~/);
    act(() => { render(null, root); });
  });

  it("denies an option by class whatever its name", () => {
    expect(isDenied({ name: "", classes: "prd-status-picker-option prd-status-completed" })).toMatch(/^class ~/);
  });

  it("leaves status-named filters, tabs and counts clickable", () => {
    for (const name of ["Completed", "Completed (3)", "In Progress", "Show completed", "1 completed"]) {
      expect(isDenied({ name, classes: "" }), name).toBeNull();
    }
  });
});
