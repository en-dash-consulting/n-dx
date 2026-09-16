// @vitest-environment jsdom
/**
 * The PRD view's write-target strip: present off the anchor, absent on it.
 *
 * The strip is the only thing telling a reader that an edit made under
 * `/w/<key>/` lands in that worktree's `.rex/prd_tree/` rather than the
 * anchor's, so both halves matter — a missing strip is a silent surprise, a
 * strip on the anchor is noise on the common case.
 */
import { describe, it, expect, afterEach } from "vitest";
import { h } from "preact";
import {
  WorkspaceWriteStrip,
  workspaceWriteNotice,
} from "../../../src/viewer/components/workspace-write-strip.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

afterEach(() => setBasePathForTests(null));

describe("workspaceWriteNotice", () => {
  it("names the workspace and where writes land", () => {
    expect(workspaceWriteNotice("app-feature")).toBe(
      "Workspace app-feature · writes go to this worktree's PRD",
    );
  });

  it("says nothing for the anchor", () => {
    expect(workspaceWriteNotice(null)).toBeNull();
    expect(workspaceWriteNotice("")).toBeNull();
  });
});

describe("WorkspaceWriteStrip", () => {
  it("renders for a non-anchor workspace derived from the base path", () => {
    setBasePathForTests("/w/app-feature");
    const root = renderToDiv(h(WorkspaceWriteStrip, null));
    const strip = root.querySelector(".workspace-write-strip");
    expect(strip).not.toBeNull();
    expect(strip!.textContent).toBe("Workspace app-feature · writes go to this worktree's PRD");
    expect(strip!.getAttribute("role")).toBe("status");
    cleanupRenderedDiv(root);
  });

  it("renders under a hub project prefix too", () => {
    setBasePathForTests("/p/demo/w/app-feature");
    const root = renderToDiv(h(WorkspaceWriteStrip, null));
    expect(root.querySelector(".workspace-write-strip")?.textContent).toContain("app-feature");
    cleanupRenderedDiv(root);
  });

  it("renders nothing on the anchor", () => {
    setBasePathForTests("");
    const root = renderToDiv(h(WorkspaceWriteStrip, null));
    expect(root.querySelector(".workspace-write-strip")).toBeNull();
    expect(root.textContent).toBe("");
    cleanupRenderedDiv(root);
  });

  it("renders nothing under a hub prefix with no workspace slot", () => {
    setBasePathForTests("/p/demo");
    const root = renderToDiv(h(WorkspaceWriteStrip, null));
    expect(root.querySelector(".workspace-write-strip")).toBeNull();
    cleanupRenderedDiv(root);
  });
});
