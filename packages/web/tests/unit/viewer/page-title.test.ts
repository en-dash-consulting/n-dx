// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PageTitle } from "../../../src/viewer/components/page-title.js";
import { viewLabel, viewBlurb } from "../../../src/viewer/views/index.js";
import type { ViewId } from "../../../src/viewer/types.js";

let root: HTMLElement | undefined;
const show = (view: ViewId) => {
  root = document.createElement("div");
  act(() => { render(h(PageTitle, { view }), root!); });
  return root;
};

afterEach(() => { if (root) act(() => { render(null, root!); }); });

describe("PageTitle", () => {
  it("names a view's own page with the model's label and blurb", () => {
    const el = show("problems");
    expect(el.querySelector("h1")?.textContent).toBe(viewLabel("problems"));
    expect(el.querySelector(".page-title-blurb")?.textContent).toBe(viewBlurb("problems"));
  });

  it("renders nothing on stage pages, Home, Live pages and unknown views", () => {
    for (const view of ["analyze", "plan", "work", "home", "live", "a-removed-view"] as ViewId[]) {
      expect(show(view).innerHTML, view).toBe("");
    }
  });
});
