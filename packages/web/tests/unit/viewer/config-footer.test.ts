// @vitest-environment jsdom
/**
 * The sidebar footer's identity line — which n-dx is running, from where, and
 * which directory it serves.
 *
 * Two things are pinned here: the shortening rules (a `cliPath` is an entry
 * file several directories inside an install, and the install's own name is
 * what identifies it), and that the line renders from the prop alone — a
 * server too old to send one renders no line, and neither case depends on the
 * `/api/ndx-config` fetch, which jsdom has nothing to answer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  ConfigFooter,
  identityLine,
  identityTooltip,
  installRootLabel,
  type ServerIdentity,
} from "../../../src/viewer/components/config-footer.js";

const SERVER: ServerIdentity = {
  version: "0.6.0",
  cliPath: "/Users/dev/code/n-dx/packages/core/cli.js",
  projectDir: "/Users/dev/code/n-dx",
};

describe("installRootLabel", () => {
  it("climbs out of the directories an entry file lives in", () => {
    expect(installRootLabel("/Users/dev/code/n-dx/packages/core/cli.js")).toBe("n-dx");
    expect(installRootLabel("/opt/tools/n-dx-internal/packages/core/cli.js")).toBe("n-dx-internal");
    expect(installRootLabel("/srv/app/node_modules/ndx/dist/cli/index.js")).toBe("ndx");
    expect(installRootLabel("/srv/app/node_modules/ndx/bin/ndx.js")).toBe("ndx");
  });

  it("keeps a package scope — it is the whole difference between two installs", () => {
    expect(installRootLabel("/srv/app/node_modules/@n-dx/core/dist/cli/index.js")).toBe("@n-dx/core");
    expect(installRootLabel("/usr/lib/node_modules/@n-dx/core/cli.js")).toBe("@n-dx/core");
  });

  it("falls back to the containing directory for a shape it does not recognise", () => {
    expect(installRootLabel("/usr/local/bin/ndx")).toBe("local");
    expect(installRootLabel("/Users/dev/scripts/ndx.js")).toBe("scripts");
  });

  it("handles Windows separators, and a doubled or trailing one", () => {
    expect(installRootLabel("C:\\Users\\dev\\n-dx\\packages\\core\\cli.js")).toBe("n-dx");
    expect(installRootLabel("C:\\\\Users\\\\dev\\\\n-dx\\\\packages\\\\core\\\\cli.js")).toBe("n-dx");
    expect(installRootLabel("/Users/dev/code/n-dx//packages//core//cli.js")).toBe("n-dx");
  });

  it("returns null rather than a placeholder when there is nothing to show", () => {
    expect(installRootLabel("")).toBeNull();
    expect(installRootLabel("cli.js")).toBeNull();
  });
});

describe("identityLine", () => {
  it("joins version, install and project with middots", () => {
    expect(identityLine(SERVER)).toBe("n-dx 0.6.0 \u00B7 n-dx \u00B7 n-dx");
    expect(identityLine({ ...SERVER, projectDir: "/Users/dev/code/other-app" }))
      .toBe("n-dx 0.6.0 \u00B7 n-dx \u00B7 other-app");
  });

  it("drops segments it cannot fill instead of leaving empty separators", () => {
    expect(identityLine({ version: "0.6.0", cliPath: "", projectDir: "" })).toBe("n-dx 0.6.0");
    expect(identityLine({ version: "0.6.0", cliPath: "", projectDir: "/srv/app" })).toBe("n-dx 0.6.0 \u00B7 app");
  });

  it("says the version is unknown rather than printing nothing for it", () => {
    expect(identityLine({ ...SERVER, version: "" })).toContain("n-dx unknown");
  });
});

describe("identityTooltip", () => {
  it("carries the full paths the line shortened", () => {
    expect(identityTooltip(SERVER)).toBe(
      "n-dx 0.6.0\nCLI: /Users/dev/code/n-dx/packages/core/cli.js\nProject: /Users/dev/code/n-dx",
    );
  });

  it("omits a path it does not have", () => {
    expect(identityTooltip({ version: "0.6.0", cliPath: "", projectDir: "" })).toBe("n-dx 0.6.0");
  });
});

describe("ConfigFooter", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
  });

  it("renders the identity line from the prop, without waiting for the config fetch", () => {
    act(() => { render(h(ConfigFooter, { server: SERVER }), root); });

    const identity = root.querySelector(".config-footer-identity")!;
    expect(identity).not.toBeNull();
    expect(identity.textContent).toBe("n-dx 0.6.0 \u00B7 n-dx \u00B7 n-dx");
    expect(identity.getAttribute("title")).toContain("/Users/dev/code/n-dx/packages/core/cli.js");
    expect(identity.getAttribute("title")).toContain("Project: /Users/dev/code/n-dx");
    // The footer is a labelled region either way, so screen readers reach it.
    expect(root.querySelector(".config-footer")!.getAttribute("role")).toBe("region");
  });

  it("renders nothing for a server too old to send an identity", () => {
    act(() => { render(h(ConfigFooter, { server: null }), root); });
    expect(root.children.length).toBe(0);

    // The prop being absent entirely is the same case.
    act(() => { render(h(ConfigFooter, {}), root); });
    expect(root.children.length).toBe(0);
  });

  it("shows the project the server reports, not the one the URL implies", () => {
    act(() => { render(h(ConfigFooter, { server: { ...SERVER, projectDir: "/Users/dev/code/n-dx/.wt/feature" } }), root); });
    expect(root.querySelector(".config-footer-identity")!.textContent).toContain("feature");
  });
});
