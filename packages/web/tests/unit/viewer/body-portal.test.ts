// @vitest-environment jsdom
/**
 * Dialogs opened from page chrome or page content render under `<body>`.
 *
 * A fixed dialog's z-index only competes inside its nearest stacking context.
 * The Guide opened inside the top nav (z 20), the FAQ inside the bottom bar
 * (z 41) and the Prepare task modal inside the Work page's "Up next" card
 * (z 1), so whatever sat above those ancestors painted over the dialog.
 *
 * @see src/viewer/components/body-portal.ts
 */

import { describe, it, expect, afterEach } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { useState } from "preact/hooks";
import { BodyPortal } from "../../../src/viewer/components/body-portal.js";
import { Guide } from "../../../src/viewer/components/guide.js";
import { GlobalFAQ } from "../../../src/viewer/components/faq.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

let root: HTMLDivElement | undefined;

afterEach(() => {
  if (root) cleanupRenderedDiv(root);
  root = undefined;
  document.body.innerHTML = "";
});

/** The `<body>` child an element was rendered into. */
function bodyChildOf(el: Element): Element {
  let at = el;
  while (at.parentElement && at.parentElement !== document.body) at = at.parentElement;
  return at;
}

describe("BodyPortal", () => {
  it("renders its children under <body>, not inside the component that owns it", () => {
    root = renderToDiv(h("div", { class: "owner" }, h(BodyPortal, null, h("p", { class: "inside" }, "hi"))));
    const p = document.querySelector(".inside")!;
    expect(root.contains(p)).toBe(false);
    expect(p.parentElement!.parentElement).toBe(document.body);
  });

  it("updates in place when its owner re-renders", () => {
    let setText: (t: string) => void = () => {};
    function Owner() {
      const [text, set] = useState("one");
      setText = set;
      return h(BodyPortal, null, h("p", { class: "inside" }, text));
    }
    root = renderToDiv(h(Owner, null));
    act(() => { setText("two"); });
    const ps = document.querySelectorAll(".inside");
    expect(ps).toHaveLength(1);
    expect(ps[0].textContent).toBe("two");
  });

  it("removes its container when the owner unmounts", () => {
    root = renderToDiv(h(BodyPortal, null, h("p", { class: "inside" }, "hi")));
    expect(document.querySelector(".body-portal")).not.toBeNull();
    cleanupRenderedDiv(root);
    root = undefined;
    expect(document.querySelector(".body-portal")).toBeNull();
    expect(document.querySelector(".inside")).toBeNull();
  });
});

describe("dialogs opened from the nav and bottom bar", () => {
  it("the Guide overlay renders outside the top nav", () => {
    root = renderToDiv(h("header", { class: "topnav" }, h(Guide, { view: "overview" })));
    act(() => { root!.querySelector<HTMLElement>(".guide-btn")!.click(); });
    const overlay = document.querySelector(".guide-overlay")!;
    expect(root.contains(overlay)).toBe(false);
    expect(bodyChildOf(overlay).className).toBe("body-portal");
  });

  it("the FAQ overlay renders outside the bottom bar", () => {
    root = renderToDiv(h("footer", { class: "bottombar" }, h(GlobalFAQ, null)));
    const open = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.getAttribute("aria-label")?.includes("FAQ"));
    act(() => { open!.click(); });
    const overlay = document.querySelector(".faq-overlay")!;
    expect(root.contains(overlay)).toBe(false);
    expect(bodyChildOf(overlay).className).toBe("body-portal");
  });
});
