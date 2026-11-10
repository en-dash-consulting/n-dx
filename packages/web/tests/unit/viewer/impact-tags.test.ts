// @vitest-environment jsdom
/**
 * Impact tags and the plain-language title: chip text, the detail panel's
 * Impact section, and a row falling back to the title with no summary.
 *
 * @see src/viewer/components/impact-tags.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ImpactDetail, ImpactTags, displayTitle, kindsText, sizeText, type ItemImpact } from "../../../src/viewer/components/impact-tags.js";

const IMPACT: ItemImpact = {
  basis: "actual",
  files: ["package.json", "src/a.ts", "src/b.ts", "tests/a.test.ts", "src/secrets.ts"],
  fileCount: 14,
  size: "large",
  kinds: { code: 9, test: 3, docs: 1, config: 1 },
  security: ["src/secrets.ts"],
  essential: ["package.json"],
};

let root: HTMLDivElement | undefined;
afterEach(() => { if (root) { render(null, root); root.remove(); root = undefined; } });

function mount(vnode: ReturnType<typeof h>): HTMLDivElement {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(vnode, root!); });
  return root;
}

describe("displayTitle", () => {
  it("uses the summary when there is one, else the title", () => {
    expect(displayTitle({ title: "Refactor x.ts", summary: "  Faster checkout  " })).toBe("Faster checkout");
    expect(displayTitle({ title: "Refactor x.ts", summary: "  " })).toBe("Refactor x.ts");
    expect(displayTitle({ title: "Refactor x.ts" })).toBe("Refactor x.ts");
  });
});

describe("chip text", () => {
  it("says measured sizes plainly and estimates with a tilde", () => {
    expect(sizeText(IMPACT)).toBe("Large · 14 files");
    expect(sizeText({ ...IMPACT, basis: "expected", fileCount: 1, size: "small" })).toBe("Small · ~1 file");
    expect(sizeText({ ...IMPACT, size: null, fileCount: 0 })).toBeNull();
  });

  it("lists file kinds largest first in plain words", () => {
    expect(kindsText(IMPACT.kinds)).toBe("9 code files · 3 tests · 1 config file · 1 doc");
  });
});

describe("ImpactTags", () => {
  it("orders security, essential, size, and kinds only when full", () => {
    const text = (full: boolean) => {
      const el = mount(h(ImpactTags, { impact: IMPACT, full }));
      const out = [...el.querySelectorAll(".impact-tag")].map((t) => t.textContent);
      render(null, el); el.remove(); root = undefined;
      return out;
    };
    expect(text(false)).toEqual(["Security", "Essential", "Large · 14 files"]);
    expect(text(true)).toEqual(["Security", "Essential", "Large · 14 files", "9 code files · 3 tests · 1 config file · 1 doc"]);
  });

  it("renders nothing without an impact", () => {
    expect(mount(h(ImpactTags, { impact: undefined })).innerHTML).toBe("");
  });
});

describe("ImpactDetail", () => {
  it("names its source, the flagged files and folds the full list with a count of the rest", () => {
    const el = mount(h(ImpactDetail, { impact: IMPACT }));
    expect(el.querySelector(".impact-source")?.textContent).toBe("From the files runs on this item changed.");
    const labels = [...el.querySelectorAll(".impact-list-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Touches secrets, keys or credentials", "Files much of the project depends on"]);
    expect(el.querySelector(".impact-all-files summary")?.textContent).toBe("All 14 files");
    expect(el.querySelectorAll(".impact-all-files li")).toHaveLength(5);
    expect(el.textContent).toContain("…and 9 more");
  });
});
